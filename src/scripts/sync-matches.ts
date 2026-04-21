import 'dotenv/config';
import { ScraperService } from '../modules/scraper/scraper.service';
import { logger } from '../core/logger';

async function main() {
  const scraper = new ScraperService();
  logger.info('Синхронизация матчей…');
  await scraper.syncUpcomingMatches();
  logger.info('Синхронизация завершена.');
}

main().catch((e) => {
  logger.error(e, 'Ошибка синхронизации');
  process.exit(1);
});
