import { GoogleGenerativeAI } from '@google/generative-ai';
import { Prisma, type Match, type PrismaClient } from '@prisma/client';
import {
  CONFIDENCE_FACTOR_KEYS,
  CONFIDENCE_WEIGHTS,
  type Config,
} from '../../core/config';
import { logger } from '../../core/logger';
import { geminiStructuredAnalysisSchema, type GeminiStructuredAnalysis } from '../../schemas/analysis.schema';
import { geminiAnalysisResponseSchema } from './gemini-response-schema';

export type MatchForAnalysis = Pick<
  Match,
  'id' | 'homeTeam' | 'awayTeam' | 'league' | 'date' | 'sport' | 'rawContent'
>;

const MAX_PREVIEW_CHARS = 14_000;
const GEMINI_RETRIES = 3;
/** Минимальная пауза между попытками (429 / лимиты прокси). */
const GEMINI_RETRY_MIN_DELAY_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;
  if (status === 404 || status === 400) return false;
  const t = `${err.name} ${err.message} ${status ?? ''}`.toLowerCase();
  return /network|econnreset|etimedout|socket|503|502|504|429|aborted|timeout|unavailable/i.test(t);
}

function httpStatusFromGeminiError(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const s = (err as { status?: unknown }).status;
  return typeof s === 'number' ? s : undefined;
}

/** Пауза из google.rpc.RetryInfo (часто у 429), если есть. */
function retryDelayMsFromGoogleRpc(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const details = (err as { errorDetails?: unknown }).errorDetails;
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    if (
      d &&
      typeof d === 'object' &&
      (d as { ['@type']?: string })['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' &&
      typeof (d as { retryDelay?: string }).retryDelay === 'string'
    ) {
      const sec = (d as { retryDelay: string }).retryDelay.match(/^(\d+)s$/);
      if (sec) {
        return Math.min(120_000, Math.max(1000, parseInt(sec[1], 10) * 1000));
      }
    }
  }
  return undefined;
}

/**
 * Пауза перед следующей попыткой: RetryInfo из ответа; иначе при 502/503/504 — дольше и с ростом по attempt
 * (у Google «high demand» часто не даёт RetryInfo, 20s подряд мало).
 */
function retryWaitAfterGeminiFailure(err: unknown, attempt: number, fallbackMs: number): number {
  const fromRpc = retryDelayMsFromGoogleRpc(err);
  if (fromRpc !== undefined) return fromRpc;

  const status = httpStatusFromGeminiError(err);
  if (status === 503 || status === 502 || status === 504) {
    const base = fallbackMs * 2 ** attempt;
    const jitter = Math.floor(Math.random() * 4000);
    return Math.min(120_000, Math.max(28_000, base + jitter));
  }

  return fallbackMs;
}

export class AnalyzerService {
  private readonly client: GoogleGenerativeAI;
  private readonly modelName: string;
  private readonly geminiBaseUrl: string;

  /**
   * Очередь фонового анализа: только матчи со статусом PENDING (без дублей по externalId — синхронизация через upsert).
   */
  static async findPendingMatchesForCron(
    prisma: PrismaClient,
    params: { take: number; now?: Date },
  ): Promise<MatchForAnalysis[]> {
    const now = params.now ?? new Date();
    const where = {
      internalStatus: 'PENDING' as const,
      date: { gte: now },
    } as unknown as Prisma.MatchWhereInput;
    return prisma.match.findMany({
      where,
      orderBy: { date: 'asc' },
      take: params.take,
    });
  }

  constructor(
    cfg: Pick<Config, 'GOOGLE_AI_API_KEY' | 'GEMINI_MODEL' | 'GEMINI_API_BASE_URL'>,
  ) {
    const key = cfg.GOOGLE_AI_API_KEY;
    if (!key) {
      throw new Error('GOOGLE_AI_API_KEY is not set; Gemini requests are disabled');
    }
    this.client = new GoogleGenerativeAI(key);
    this.modelName = cfg.GEMINI_MODEL;
    this.geminiBaseUrl = cfg.GEMINI_API_BASE_URL;
  }

  /**
   * Взвешенное среднее оценок факторов (0–100) по весам из config — итоговая уверенность в %.
   */
  calculateFinalScore(factors: GeminiStructuredAnalysis['factors']): number {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const key of CONFIDENCE_FACTOR_KEYS) {
      const w = CONFIDENCE_WEIGHTS[key];
      weightedSum += factors[key].score * w;
      weightTotal += w;
    }
    if (weightTotal <= 0) {
      return 0;
    }
    const pct = weightedSum / weightTotal;
    return Math.round(Math.min(100, Math.max(0, pct)));
  }

  /**
   * Вызов Gemini с schema-guided JSON: факторы F1–F10, aiConfidence, outcome, summary.
   */
  async generateAnalysis(match: MatchForAnalysis, ragContext: string): Promise<GeminiStructuredAnalysis> {
    const preview =
      match.rawContent && match.rawContent !== 'No preview available'
        ? match.rawContent.slice(0, MAX_PREVIEW_CHARS)
        : null;

    const matchBlock = [
      `Матч: ${match.homeTeam} — ${match.awayTeam}`,
      `Лига: ${match.league}`,
      `Спорт: ${match.sport}`,
      `Дата (UTC): ${match.date.toISOString()}`,
      preview ? `\nПревью / контекст матча:\n${preview}` : '\nПревью недоступно.',
    ].join('\n');

    const systemInstruction = `Ты спортивный аналитик. Оцени матч на 90 минут (без пенальти после матча).
Для КАЖДОГО фактора верни score 0–100 (насколько этот фактор поддерживает надёжный прогноз) и краткое reasoning на русском.
Факторы:
F1 — личные встречи (H2H)
F2 — текущая форма команд
F3 — травмы, дисквалификации, кадровые потери
F4 — домашнее/гостевое преимущество и стабильность на своём/чужом поле
F5 — мотивация и турнирный контекст
F6 — усталость, плотность календаря, ротации
F7 — тактическое соответствие стилей
F8 — оборона и вратарская линия
F9 — погода, покрытие, внешние условия
F10 — достоверность новостей и составов (насколько данные полные/свежие)
Поле aiConfidence — твоя общая уверенность в выбранном исходе (0–100), для сравнения с взвешенной формулой на сервере.
Поле outcome: "1" победа хозяев, "X" ничья, "2" победа гостей.
Поле summary — связный разбор на русском, 3–8 предложений.`;

    const userPrompt = [`${matchBlock}`, '', '=== Контекст RAG (данные из БД) ===', ragContext].join('\n');

    const model = this.client.getGenerativeModel(
      {
        model: this.modelName,
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: geminiAnalysisResponseSchema,
        },
        systemInstruction,
      },
      { baseUrl: this.geminiBaseUrl },
    );

    let lastError: unknown;
    for (let attempt = 1; attempt <= GEMINI_RETRIES; attempt++) {
      try {
        logger.info(
          { matchId: match.id, stage: 'gemini_request', attempt, modelName: this.modelName },
          'Analyzer: запрос к Gemini (structured JSON)',
        );
        const res = await model.generateContent(userPrompt);
        const text = res.response.text();
        const raw: unknown = JSON.parse(text);

        const parsed = geminiStructuredAnalysisSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error(`Модель вернула JSON вне схемы: ${parsed.error.message}`);
        }

        logger.info(
          { matchId: match.id, stage: 'gemini_parse_ok', attempt, modelName: this.modelName },
          'Analyzer: ответ Gemini успешно разобран',
        );
        return parsed.data;
      } catch (err) {
        lastError = err;
        const retryable = isRetryableNetworkError(err);
        logger.warn(
          { matchId: match.id, stage: 'gemini_error', attempt, retryable, err },
          'Analyzer: ошибка вызова Gemini',
        );
        if (!retryable || attempt === GEMINI_RETRIES) {
          break;
        }
        const waitMs = retryWaitAfterGeminiFailure(err, attempt, GEMINI_RETRY_MIN_DELAY_MS);
        logger.info(
          { matchId: match.id, stage: 'gemini_retry_wait', attempt, waitMs },
          'Analyzer: пауза перед повтором запроса к Gemini',
        );
        await sleep(waitMs);
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(String(lastError));
  }
}
