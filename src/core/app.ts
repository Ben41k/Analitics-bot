import 'dotenv/config';
import { startBot } from './bot';
import { logger } from './logger';

startBot().catch((e) => {
  logger.error(e, 'Критическая ошибка при запуске бота');
  process.exit(1);
});
