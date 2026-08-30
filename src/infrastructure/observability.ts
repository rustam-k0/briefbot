export type MetricStage='text_pipeline'|'voice_pipeline'|'transcription'|'extraction'|'persistence';
class Metrics{
  private durations=new Map<MetricStage,number[]>();private failures=new Map<MetricStage,number>();private calls=new Map<string,number>();
  observe(stage:MetricStage,durationMs:number,success=true){const values=this.durations.get(stage)??[];values.push(durationMs);if(values.length>10000)values.shift();this.durations.set(stage,values);if(!success)this.failures.set(stage,(this.failures.get(stage)??0)+1);}
  model(task:string,provider:string,model:string){const key=`${task}|${provider}|${model}`;this.calls.set(key,(this.calls.get(key)??0)+1);}
  snapshot(){const stages=Object.fromEntries([...this.durations].map(([stage,values])=>[stage,{count:values.length,errors:this.failures.get(stage)??0,p50:percentile(values,.5),p95:percentile(values,.95)}]));return{stages,modelCalls:Object.fromEntries(this.calls)};}
  prometheus(){const lines:string[]=[];for(const[stage,data]of Object.entries(this.snapshot().stages)){lines.push(`briefbot_stage_duration_ms{stage="${stage}",quantile="0.5"} ${data.p50}`,`briefbot_stage_duration_ms{stage="${stage}",quantile="0.95"} ${data.p95}`,`briefbot_stage_total{stage="${stage}"} ${data.count}`,`briefbot_stage_errors_total{stage="${stage}"} ${data.errors}`);}return `${lines.join('\n')}\n`;}
}
function percentile(values:number[],q:number){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))]!;}
export const metrics=new Metrics();
