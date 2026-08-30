import { afterEach,describe,expect,it,vi } from 'vitest';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAICompatibleTranscriptionClient } from '../src/infrastructure/stt/openai-compatible-stt.js';
import { CircuitBreaker,Semaphore } from '../src/infrastructure/resilience.js';
afterEach(()=>vi.unstubAllGlobals());
describe('local ASR contract and resilience',()=>{
  it('sends Telegram OGG to the local OpenAI-compatible endpoint',async()=>{const dir=await mkdtemp(join(tmpdir(),'briefbot-test-'));const file=join(dir,'voice.ogg');await writeFile(file,Buffer.from('OggSfake'));let url='';let body:FormData|undefined;vi.stubGlobal('fetch',vi.fn(async(input,options:any)=>{url=String(input);body=options.body;return new Response(JSON.stringify({text:'Привет',language:'ru'}),{status:200});}));try{const result=await new OpenAICompatibleTranscriptionClient('http://stt:8000/v1','dummy','Systran/faster-whisper-small').transcribe(file);expect(result.text).toBe('Привет');expect(url).toBe('http://stt:8000/v1/audio/transcriptions');expect(body?.get('model')).toBe('Systran/faster-whisper-small');expect(result.model?.provider).toBe('local');}finally{await rm(dir,{recursive:true,force:true});}});
  it('opens a circuit after the configured failure threshold',()=>{const breaker=new CircuitBreaker(2,10000);expect(breaker.available()).toBe(true);breaker.failure();breaker.failure();expect(breaker.available()).toBe(false);breaker.success();expect(breaker.available()).toBe(true);});
  it('limits concurrent provider work',async()=>{const semaphore=new Semaphore(2);let active=0,max=0;await Promise.all(Array.from({length:6},()=>semaphore.run(async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;})));expect(max).toBe(2);});
});
