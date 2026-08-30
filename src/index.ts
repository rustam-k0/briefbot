import 'dotenv/config';
import pino from 'pino';
import { loadConfig } from './config/env.js';
import { createDatabase } from './infrastructure/db/client.js';
import { PostgresBriefRepository } from './infrastructure/db/repository.js';
import { OpenCodeLLMClient } from './infrastructure/opencode/client.js';
import { OpenAICompatibleTranscriptionClient } from './infrastructure/stt/openai-compatible-stt.js';
import { InterviewService } from './application/interview-service.js';
import { createBot } from './bot/bot.js';
import { createHttpServer } from './http/server.js';
import { cleanupExpiredAudio } from './infrastructure/audio-retention.js';
import { escapeHtml } from './domain/markdown.js';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, redact: ['token', 'password', 'apiKey', '*.text', '*.transcript'] });
const { db, pool } = createDatabase(config.DATABASE_URL);
const repository = new PostgresBriefRepository(db);
const llm = new OpenCodeLLMClient({ baseUrl: config.OPENCODE_BASE_URL, username: config.OPENCODE_SERVER_USERNAME, password: config.OPENCODE_SERVER_PASSWORD, models: config.EXTRACTION_MODELS, timeoutMs: config.OPENCODE_TIMEOUT_MS });
const stt = new OpenAICompatibleTranscriptionClient(config.STT_BASE_URL, config.STT_API_KEY, config.STT_MODEL, config.STT_TIMEOUT_MS);
const service = new InterviewService(repository, llm, event => logger.info(event, 'Pipeline stage'));
const bot = createBot(config, service, repository, stt);
const app = createHttpServer(config, bot, pool);

await app.listen({ host: '0.0.0.0', port: config.PORT });
if (config.TELEGRAM_MODE === 'polling') {
  void bot.start({ drop_pending_updates: false, onStart: () => logger.info('Telegram long polling started') });
} else {
  const publicBaseUrl = config.TELEGRAM_WEBHOOK_URL!;
  await bot.api.setWebhook(`${publicBaseUrl.replace(/\/$/, '')}/telegram/webhook`, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET!,
    allowed_updates: ['message', 'callback_query'],
  });
  logger.info('Telegram webhook configured');
}
logger.info({ port: config.PORT, mode: config.TELEGRAM_MODE }, 'Briefbot started');
void recoverFailedMessages();
const recoveryTimer=setInterval(()=>void recoverFailedMessages(),30000);recoveryTimer.unref();
void cleanupExpiredAudio(config.AUDIO_STORAGE_DIR,config.AUDIO_RETENTION_DAYS).then(removed=>removed&&logger.info({removed},'Expired audio removed'));

async function recoverFailedMessages(){for(const message of await repository.recoverableMessages(10)){const result=await service.retry(message.id,stt);logger.info({requestId:message.id,updateId:message.updateId,briefId:message.briefId,stage:result.recoverable?'failed':'completed'},'Recovery attempt');if(!result.recoverable)await bot.api.sendMessage(message.chatId,escapeHtml(result.reply),{parse_mode:'HTML'}).catch(error=>logger.warn({requestId:message.id,error:error instanceof Error?error.message:'unknown'},'Recovery result delivery failed'));}}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Graceful shutdown');
  bot.stop();
  clearInterval(recoveryTimer);
  await app.close();
  await pool.end();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
