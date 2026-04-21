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
  if (!e.OPENROUTER_API_KEY?.trim() && e.OPENAI_API_KEY?.trim()) {
    e.OPENROUTER_API_KEY = e.OPENAI_API_KEY;
  }
  if (!e.LLM_BASE_URL?.trim() && e.OPENAI_API_BASE_URL?.trim()) {
    e.LLM_BASE_URL = e.OPENAI_API_BASE_URL;
  }
  if (!e.FOOTBALL_DATA_API_KEY?.trim() && e.FOOTBALL_DATA_API_TOKEN?.trim()) {
    e.FOOTBALL_DATA_API_KEY = e.FOOTBALL_DATA_API_TOKEN;
  }
}

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
  
  // LLM через OpenRouter (OpenAI-совместимый /chat/completions). Слаги моделей: https://openrouter.ai/models
  LLM_BASE_URL: z
    .string()
    .url()
    .default('https://openrouter.ai/api/v1'),
  OPENROUTER_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  /** Сайт приложения (рекомендует OpenRouter для рейтинга/идентификации) */
  OPENROUTER_HTTP_REFERER: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional(),
  ),
  OPENROUTER_APP_TITLE: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  // Роли моделей — значения в формате OpenRouter, напр. openai/gpt-4o, anthropic/claude-3.5-sonnet
  PRIMARY_REASONING_MODEL: z.string().default('openai/gpt-4o'),
  LONG_CONTEXT_MODEL: z.string().default('openai/gpt-4o-mini'),
  
  // Логирование
  LOG_LEVEL: z.enum(['info', 'error', 'debug', 'trace']).default('info'),
  
  // Параметры скрапера
  SCRAPER_HEADLESS: z.preprocess((val) => val === 'true', z.boolean()).default(true),
  
  // API Football Data
  FOOTBALL_DATA_API_KEY: z.string().optional(),

  // Крон: периодический дайджест матчей + один прогноз (если есть LLM и лимит)
  ENABLE_CRON: z.preprocess((val) => val === 'true' || val === '1', z.boolean()).default(false),
  CRON_TZ: z.string().min(1).default('UTC'),
  /** Выражение node-cron (5 полей), напр. "0 9 * * *" — каждый день в 09:00 */
  CRON_DIGEST_SCHEDULE: z.string().min(3).default('0 9 * * *'),
  /** Сколько матчей смотреть вперёд (часы) для дайджеста */
  CRON_DIGEST_LOOKAHEAD_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  /** Макс. вызовов LLM за один запуск крона (по подписчикам) */
  CRON_MAX_DIGEST_LLM: z.coerce.number().int().min(0).max(500).default(10),
  /** Перед дайджестом вызывать синхронизацию матчей (Playwright + API) — тяжёлая операция */
  CRON_RUN_SCRAPE: z.preprocess((val) => val === 'true' || val === '1', z.boolean()).default(false),
});

// Парсим и валидируем процесс
applyEnvAliases();
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