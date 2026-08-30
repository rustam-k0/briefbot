export class CircuitBreaker{
  private failures=0;private openUntil=0;constructor(private threshold=5,private cooldownMs=30000){}
  available(){return Date.now()>=this.openUntil;}
  success(){this.failures=0;this.openUntil=0;}
  failure(){this.failures++;if(this.failures>=this.threshold)this.openUntil=Date.now()+this.cooldownMs;}
}
export class Semaphore{
  private active=0;private waiters:Array<()=>void>=[];constructor(private readonly limit:number){}
  async run<T>(task:()=>Promise<T>):Promise<T>{if(this.active>=this.limit)await new Promise<void>(resolve=>this.waiters.push(resolve));this.active++;try{return await task();}finally{this.active--;this.waiters.shift()?.();}}
}
