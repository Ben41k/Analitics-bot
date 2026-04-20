import pino from 'pino';
import { config } from './config';

/**
 * Конфигурация логгера Pino
 * В production выводит чистый JSON для систем сбора логов.
 * В development можно добавить pino-pretty для читаемости в консоли.
 */
export const logger = pino({
  level: config.LOG_LEVEL || 'info',
  // Настройки для удобного отображения в консоли при разработке
  transport: config.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'HH:MM:ss Z',
    },
  } : undefined,
  
  // Базовые поля для каждого лога
  base: {
    env: config.NODE_ENV,
    service: 'ai-analyst-bot',
  },
});