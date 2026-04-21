import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Загружаем .env файл
dotenv.config();

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
});

// Парсим и валидируем процесс
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