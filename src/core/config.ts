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
  
  // AI Модели (Используем роли, как договаривались в архитектуре)
  PRIMARY_REASONING_MODEL: z.string().default('gpt-4o'), // или claude-3-5-sonnet
  LONG_CONTEXT_MODEL: z.string().default('gpt-4o-mini'),
  
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