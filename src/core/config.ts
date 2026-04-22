import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Загружаем .env из корня репозитория (не зависит от process.cwd при запуске из IDE/вложенных папок)
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

/** Поддержка альтернативных имён переменных из старых шаблонов .env (пишет в process.env — чтобы читали и модули вне config). */
function applyEnvAliases(): void {
  const e = process.env;
  if (!e.BOT_TOKEN?.trim() && e.TELEGRAM_BOT_TOKEN?.trim()) {
    e.BOT_TOKEN = e.TELEGRAM_BOT_TOKEN;
  }
  if (!e.GOOGLE_AI_API_KEY?.trim() && e.GEMINI_API_KEY?.trim()) {
    e.GOOGLE_AI_API_KEY = e.GEMINI_API_KEY;
  }
  if (!e.GEMINI_MODEL?.trim() && e.GEMINI_PRIMARY_MODEL?.trim()) {
    e.GEMINI_MODEL = e.GEMINI_PRIMARY_MODEL;
  }
  if (!e.FOOTBALL_DATA_API_KEY?.trim() && e.FOOTBALL_DATA_API_TOKEN?.trim()) {
    e.FOOTBALL_DATA_API_KEY = e.FOOTBALL_DATA_API_TOKEN;
  }
}

/** В Generative Language API v1beta короткие имена gemini-1.5-flash* часто отвечают 404. */
function rewriteDeprecatedGeminiModels(): void {
  const raw = process.env.GEMINI_MODEL?.trim();
  if (!raw) return;
  const m = raw.toLowerCase();
  if (m === 'gemini-1.5-flash' || m === 'gemini-1.5-flash-latest') {
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  }
}

/** Ключи факторов уверенности F1–F10 (совпадают с полями в structured output Gemini). */
export const CONFIDENCE_FACTOR_KEYS = [
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
] as const;

export type ConfidenceFactorKey = (typeof CONFIDENCE_FACTOR_KEYS)[number];

/**
 * Веса факторов для взвешенного итога уверенности (TS-калькулятор).
 * F1 H2H, F2 форма, F3 травмы/дисквалификации, F4 дом/гости, F5 мотивация,
 * F6 усталость/календарь, F7 тактика, F8 оборона/вратарь, F9 погода/покрытие, F10 достоверность новостей/составов.
 */
export const CONFIDENCE_WEIGHTS: Record<ConfidenceFactorKey, number> = {
  f1: 1.0,
  f2: 1.2,
  f3: 1.5,
  f4: 1.1,
  f5: 1.0,
  f6: 0.9,
  f7: 1.0,
  f8: 1.0,
  f9: 0.5,
  f10: 0.8,
};

/**
 * Схема валидации переменных окружения.
 * Это Single Source of Truth для настроек приложения.
 */
const configSchema = z.object({
  // Окружение
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // База данных
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),

  // Telegram
  BOT_TOKEN: z.string().min(10, 'BOT_TOKEN is required and must be valid'),
  /** Свой Bot API / зеркало без «/» в конце (если api.telegram.org недоступен) */
  TELEGRAM_API_ROOT: z.preprocess((v) => {
    if (typeof v !== 'string' || v.trim() === '') return undefined;
    return v.trim().replace(/\/+$/, '');
  }, z.string().url().optional()),
  /** Вторая попытка getMe, если основной apiRoot не ответил (прокси / CF Worker / VPS с bot-api) */
  TELEGRAM_API_FALLBACK_ROOT: z.preprocess((v) => {
    if (typeof v !== 'string' || v.trim() === '') return undefined;
    return v.trim().replace(/\/+$/, '');
  }, z.string().url().optional()),
  /** Таймаут HTTP-запросов к Telegram (секунды), в т.ч. getMe и long polling */
  TELEGRAM_HTTP_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(120).default(30),

  // Google AI (Gemini) — https://ai.google.dev/
  GOOGLE_AI_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1, 'GOOGLE_AI_API_KEY must be non-empty when set').optional(),
  ),
  /**
   * Модель Gemini для анализа (flash). 1.5-* в v1beta часто 404; стабильная линейка — 2.5 Flash.
   * При квотах/429 подбери модель в консоли Google AI или задай GEMINI_MODEL в .env.
   */
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  /**
   * Модель эмбеддингов (тот же API/ключ). v1beta больше не отдаёт старый embedding-001;
   * gemini-embedding-001 + outputDimensionality 768 — см. VectorService.
   */
  GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
  /**
   * Базовый URL API Gemini (без «/» в конце). По умолчанию — прокси; для прямого вызова Google:
   * https://generativelanguage.googleapis.com
   */
  GEMINI_API_BASE_URL: z.preprocess((v) => {
    if (typeof v !== 'string' || v.trim() === '') {
      return 'https://gemini-proxy.denckik3224.workers.dev';
    }
    return v.trim().replace(/\/+$/, '');
  }, z.string().url()),

  // Логирование
  LOG_LEVEL: z.enum(['info', 'error', 'debug', 'trace']).default('info'),

  // Параметры скрапера
  SCRAPER_HEADLESS: z.preprocess((val) => val === 'true', z.boolean()).default(true),

  // API Football Data
  FOOTBALL_DATA_API_KEY: z.string().optional(),

  // Крон: периодический дайджест матчей (данные из БД)
  ENABLE_CRON: z.preprocess((val) => val === 'true' || val === '1', z.boolean()).default(false),
  CRON_TZ: z.string().min(1).default('UTC'),
  /** Выражение node-cron (5 полей), напр. "0 9 * * *" — каждый день в 09:00 */
  CRON_DIGEST_SCHEDULE: z.string().min(3).default('0 9 * * *'),
  /** Сколько матчей смотреть вперёд (часы) для дайджеста */
  CRON_DIGEST_LOOKAHEAD_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  /** Перед дайджестом вызывать синхронизацию матчей (Playwright + API) — тяжёлая операция */
  CRON_RUN_SCRAPE: z.preprocess((val) => val === 'true' || val === '1', z.boolean()).default(false),

  /** Крон фонового анализа матчей (оркестратор: скрапер → RAG → Gemini → запись в Match) */
  ENABLE_ANALYSIS_CRON: z.preprocess((val) => val === 'true' || val === '1', z.boolean()).default(false),
  /** Расписание node-cron (5 полей). Пример каждые 6 ч: минуты 30, часы «каждые 6» — см. CRON_ANALYSIS_SCHEDULE в .env.example */
  CRON_ANALYSIS_SCHEDULE: z.string().min(3).default('30 */6 * * *'),
  /** Сколько матчей без анализа обработать за один запуск */
  CRON_ANALYSIS_BATCH: z.coerce.number().int().min(1).max(200).default(8),
  /** Перед анализом вызвать syncUpcomingMatches (Playwright) */
  CRON_ANALYSIS_RUN_SCRAPE: z.preprocess((val) => val === 'true' || val === '1', z.boolean()).default(false),
});

// Парсим и валидируем процесс
applyEnvAliases();
rewriteDeprecatedGeminiModels();
const parsedConfig = configSchema.safeParse(process.env);

if (!parsedConfig.success) {
  console.error('❌ Invalid environment variables:', parsedConfig.error.format());
  process.exit(1);
}

export const config = parsedConfig.data;

/**
 * Типизация для использования во всем приложении
 * import { Config } from './core/config';
 */
export type Config = z.infer<typeof configSchema>;
