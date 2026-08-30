import { readFile } from 'node:fs/promises';
import type { TranscriptionClient, TranscriptionResult } from '../../application/ports.js';
import { metrics } from '../observability.js';
import { CircuitBreaker, Semaphore } from '../resilience.js';
import { withRetry } from '../retry.js';

export class OpenAICompatibleTranscriptionClient implements TranscriptionClient {
  private readonly breaker = new CircuitBreaker();
  private readonly limiter = new Semaphore(2);

  constructor(
    private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 90_000,
  ) {}

  async transcribe(filePath: string): Promise<TranscriptionResult> {
    if (!this.breaker.available()) throw new Error('ASR_CIRCUIT_OPEN');
    const started = Date.now();
    try {
      const response = await this.limiter.run(() => withRetry(async () => {
        const bytes = await readFile(filePath);
        const form = new FormData();
        form.append('file', new Blob([Uint8Array.from(bytes)], { type: 'audio/ogg' }), 'voice.ogg');
        form.append('model', this.model);
        const result = await fetch(`${this.baseURL.replace(/\/$/, '')}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!result.ok) throw new Error(`ASR_HTTP_${result.status}`);
        return result.json() as Promise<{ text?: string; language?: string }>;
      }, { attempts: 3, retryIf: error => /timeout|429|5\d\d|fetch/i.test(String(error)) }));
      const text = String(response.text ?? '').trim();
      if (!text) throw new Error('ASR_EMPTY_TRANSCRIPT');
      this.breaker.success();
      const latencyMs = Date.now() - started;
      metrics.observe('transcription', latencyMs, true);
      metrics.model('transcription', 'local', this.model);
      return { text, ...(response.language ? { language: response.language } : {}), model: { task: 'transcription', provider: 'local', model: this.model, latencyMs, attempts: 1 } };
    } catch (error) {
      this.breaker.failure();
      metrics.observe('transcription', Date.now() - started, false);
      throw error;
    }
  }
}
