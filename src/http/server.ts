import Fastify from 'fastify';
import type { Bot } from 'grammy';
import type pg from 'pg';
import type { AppConfig } from '../config/env.js';
import { metrics } from '../infrastructure/observability.js';

export function createHttpServer(config: AppConfig, bot: Bot, pool: pg.Pool) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.x-telegram-bot-api-secret-token', 'body.message.text'] }, bodyLimit: 2_000_000 });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/metrics', async (_request,reply) => reply.type('text/plain; version=0.0.4').send(metrics.prometheus()));
  app.get('/metrics.json', async () => metrics.snapshot());
  app.get('/ready', async (_request, reply) => {
    try { await pool.query('select 1'); return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'not_ready' }); }
  });
  if (config.TELEGRAM_MODE === 'webhook') {
    app.post('/telegram/webhook', async (request, reply) => {
      if (request.headers['x-telegram-bot-api-secret-token'] !== config.TELEGRAM_WEBHOOK_SECRET) return reply.code(401).send({ ok: false });
      void bot.handleUpdate(request.body as any).catch((error)=>request.log.error({error:error instanceof Error?error.message:'unknown'},'Telegram update failed after acknowledgement'));
      return { ok: true };
    });
  }
  return app;
}
