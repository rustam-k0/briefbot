import { readFile } from 'node:fs/promises';
import type { TranscriptionClient, TranscriptionResult } from '../../application/ports.js';
import { withRetry } from '../retry.js';
import { metrics } from '../observability.js';
import { CircuitBreaker,Semaphore } from '../resilience.js';

export class QwenTranscriptionClient implements TranscriptionClient {
  private readonly breakers=new Map<string,CircuitBreaker>();private readonly limiter=new Semaphore(4);
  constructor(private readonly baseURL:string,private readonly apiKey:string,private readonly models:string[],private readonly timeoutMs=90000){}
  async transcribe(filePath:string):Promise<TranscriptionResult>{
    const started=Date.now();const bytes=await readFile(filePath);const data=`data:audio/ogg;base64,${bytes.toString('base64')}`;let response:any;let selected='';let last:unknown;
    for(const model of this.models){const breaker=this.breakers.get(model)??new CircuitBreaker();this.breakers.set(model,breaker);if(!breaker.available()){last=new Error('ASR_CIRCUIT_OPEN');continue;}try{response=await this.limiter.run(()=>withRetry(async()=>{const result=await fetch(`${this.baseURL.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:[{type:'input_audio',input_audio:{data}}]}],stream:false,asr_options:{enable_itn:true}}),signal:AbortSignal.timeout(this.timeoutMs)});if(!result.ok)throw new Error(`ASR_HTTP_${result.status}`);return result.json() as Promise<any>;},{attempts:3,retryIf:error=>/timeout|429|5\d\d|fetch/i.test(String(error))}));breaker.success();selected=model;break;}catch(error){breaker.failure();last=error;}}
    if(!response)throw last;
    const text=String(response?.choices?.[0]?.message?.content??'').trim();if(!text){metrics.observe('transcription',Date.now()-started,false);throw new Error('ASR_EMPTY_TRANSCRIPT');}
    metrics.observe('transcription',Date.now()-started,true);metrics.model('transcription','alibaba-model-studio',selected);
    return{text,model:{task:'transcription',provider:'alibaba-model-studio',model:selected,latencyMs:Date.now()-started,attempts:1,...(selected!==this.models[0]?{fallbackReason:'primary ASR unavailable'}:{}),...(response?.usage?.prompt_tokens?{inputTokens:response.usage.prompt_tokens}:{}),...(response?.usage?.completion_tokens?{outputTokens:response.usage.completion_tokens}:{})}};
  }
}
