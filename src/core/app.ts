import 'dotenv/config';
import { logger } from './logger';
import { startBot } from './bot';

// Дублируем в stdout: в некоторых терминалах/режимах watch удобнее видеть простую строку.
console.log('[ai-analyst-bot] старт процесса…');
logger.info('Процесс приложения стартовал (ai-analyst-bot)');

startBot().catch((e) => {
  logger.error(e, 'Критическая ошибка при запуске бота');
  process.exit(1);
});
