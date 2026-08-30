import { z } from 'zod';
const optionalString=z.string().trim().optional().transform(v=>v||undefined);
const modelList=z.string().transform(value=>value.split(',').map(v=>v.trim()).filter(Boolean)).refine(v=>v.length>0,'at least one model is required');
const chineseTextModels=['qwen3.8-flash','qwen3.7-flash','qwen3.7-plus','qwen3.8-max'] as const;
const chineseAsrModels=['qwen3-asr-flash','qwen3-asr-flash-2026-02-10','qwen-audio-3.0-asr-flash'] as const;
export const envSchema=z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),PORT:z.coerce.number().int().positive().default(3000),DATABASE_URL:z.string().min(1),
  TELEGRAM_BOT_TOKEN:z.string().min(1),TELEGRAM_MODE:z.enum(['polling','webhook']).default('polling'),TELEGRAM_WEBHOOK_URL:optionalString,TELEGRAM_WEBHOOK_SECRET:optionalString,RENDER_EXTERNAL_HOSTNAME:optionalString,DESIGNER_TELEGRAM_CHAT_ID:optionalString,
  OPENCODE_BASE_URL:z.string().url(),OPENCODE_SERVER_USERNAME:z.string().min(1).default('opencode'),OPENCODE_SERVER_PASSWORD:z.string().min(1),
  EXTRACTION_MODELS:modelList.default(['alibaba/qwen3.8-flash','alibaba/qwen3.7-plus']),OPENCODE_TIMEOUT_MS:z.coerce.number().int().positive().default(60000),
  STT_BASE_URL:z.string().url(),STT_API_KEY:z.string().min(1),STT_MODELS:modelList.default(['qwen3-asr-flash','qwen-audio-3.0-asr-flash']),STT_TIMEOUT_MS:z.coerce.number().int().positive().default(90000),
  AUDIO_STORAGE_DIR:z.string().min(1).default('./data/audio'),AUDIO_RETENTION_DAYS:z.coerce.number().int().positive().default(30),
  MAX_VOICE_DURATION_SECONDS:z.coerce.number().int().positive().max(1200).default(300),MAX_TEXT_LENGTH:z.coerce.number().int().positive().max(50000).default(12000),MAX_VOICE_BYTES:z.coerce.number().int().positive().max(10000000).default(7500000),LOG_LEVEL:z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info'),
}).superRefine((env,ctx)=>{
  if(env.TELEGRAM_MODE==='webhook'&&!env.TELEGRAM_WEBHOOK_SECRET)ctx.addIssue({code:'custom',path:['TELEGRAM_WEBHOOK_SECRET'],message:'required in webhook mode'});
  if(env.TELEGRAM_MODE==='webhook'&&!env.TELEGRAM_WEBHOOK_URL&&!env.RENDER_EXTERNAL_HOSTNAME)ctx.addIssue({code:'custom',path:['TELEGRAM_WEBHOOK_URL'],message:'required in webhook mode outside Render'});
  for(const configured of env.EXTRACTION_MODELS){const [provider,id]=configured.split('/');if(provider!=='alibaba'||!chineseTextModels.includes(id as any))ctx.addIssue({code:'custom',path:['EXTRACTION_MODELS'],message:`unapproved provider/model: ${configured}`});}
  for(const model of env.STT_MODELS)if(!chineseAsrModels.includes(model as any))ctx.addIssue({code:'custom',path:['STT_MODELS'],message:`unapproved ASR model: ${model}`});
});
export type AppConfig=z.infer<typeof envSchema>;
export function loadConfig(source:NodeJS.ProcessEnv=process.env):AppConfig{return envSchema.parse(source);}
