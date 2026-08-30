import { readdir,stat,unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function cleanupExpiredAudio(directory:string,retentionDays:number):Promise<number>{let names:string[];try{names=await readdir(resolve(directory));}catch{return 0;}const cutoff=Date.now()-retentionDays*86400000;let removed=0;for(const name of names){if(!name.endsWith('.ogg'))continue;const path=resolve(directory,name);try{if((await stat(path)).mtimeMs<cutoff){await unlink(path);removed++;}}catch{/* another worker may have removed it */}}return removed;}
