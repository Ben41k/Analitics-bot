import 'dotenv/config';
import { ScraperService } from '../modules/scraper/scraper.service';

async function bootstrap() {
  try {
    const scraper = new ScraperService();
    
    console.log('🚀 Аналитический движок запущен...');
    await scraper.syncUpcomingMatches();
    
    console.log('🏁 Работа завершена успешно.');
  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
  }
}

bootstrap();