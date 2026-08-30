import 'dotenv/config';
import { loadConfig } from '../src/config/env.js';

const config = loadConfig();
if (!config.TELEGRAM_WEBHOOK_URL || !config.TELEGRAM_WEBHOOK_SECRET) throw new Error('TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET are required');
const endpoint = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/setWebhook`;
const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `${config.TELEGRAM_WEBHOOK_URL.replace(/\/$/, '')}/telegram/webhook`, secret_token: config.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] }) });
if (!response.ok) throw new Error(`Telegram setWebhook failed: ${response.status}`);
const result = await response.json() as { ok: boolean; description?: string };
if (!result.ok) throw new Error(result.description ?? 'Telegram rejected webhook');
console.log('Webhook configured successfully');
