import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import type { Config } from '../../core/config';
import { logger } from '../../core/logger';

const EMBED_RETRIES = 3;
const EMBED_RETRY_MIN_DELAY_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableEmbedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;
  if (status === 404 || status === 400) return false;
  const t = `${err.name} ${err.message} ${status ?? ''}`.toLowerCase();
  // не используем слово «fetch» в паттерне — оно есть в «Error fetching» у любого HTTP 404
  return /network|econnreset|etimedout|socket|503|502|504|429|aborted|timeout|unavailable/i.test(t);
}

/**
 * Эмбеддинги через тот же Google AI API и baseUrl, что и анализ.
 * Модель — GEMINI_EMBEDDING_MODEL; для gemini-embedding-* задаётся outputDimensionality 768 (колонка в БД).
 */
export class VectorService {
  private readonly model: GenerativeModel;
  private readonly modelName: string;

  constructor(cfg: Pick<Config, 'GOOGLE_AI_API_KEY' | 'GEMINI_EMBEDDING_MODEL' | 'GEMINI_API_BASE_URL'>) {
    const key = cfg.GOOGLE_AI_API_KEY;
    if (!key) {
      throw new Error('GOOGLE_AI_API_KEY is not set; embeddings are disabled');
    }
    const client = new GoogleGenerativeAI(key);
    this.modelName = cfg.GEMINI_EMBEDDING_MODEL;
    this.model = client.getGenerativeModel({ model: this.modelName }, { baseUrl: cfg.GEMINI_API_BASE_URL });
  }

  /** Вектор признаков; в БД vector(768). */
  async embedText(text: string): Promise<number[]> {
    const t = text.trim() || ' ';
    let lastError: unknown;

    const embedPayload: string | { content: { role: 'user'; parts: { text: string }[] }; outputDimensionality: number } =
      /gemini-embedding/i.test(this.modelName)
        ? { content: { role: 'user', parts: [{ text: t }] }, outputDimensionality: 768 }
        : t;

    for (let attempt = 1; attempt <= EMBED_RETRIES; attempt++) {
      try {
        const res = await this.model.embedContent(embedPayload);
        const values = res.embedding?.values;
        if (!values?.length) {
          throw new Error('Gemini embedContent: пустой embedding');
        }
        return values;
      } catch (err) {
        lastError = err;
        const retryable = isRetryableEmbedError(err);
        logger.warn(
          { stage: 'embed_error', attempt, retryable, modelName: this.modelName, err },
          'VectorService: ошибка embedContent',
        );
        if (!retryable || attempt === EMBED_RETRIES) {
          break;
        }
        logger.info(
          { stage: 'embed_retry_wait', attempt, waitMs: EMBED_RETRY_MIN_DELAY_MS, modelName: this.modelName },
          'VectorService: пауза перед повтором embedContent',
        );
        await sleep(EMBED_RETRY_MIN_DELAY_MS);
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(String(lastError));
  }
}
