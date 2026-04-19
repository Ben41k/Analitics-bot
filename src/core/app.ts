import 'dotenv/config';
import { FootballDataProvider } from '../modules/scraper/providers/football-data.provider';

async function bootstrap() {
  const provider = new FootballDataProvider();
  
  console.log('📡 Запрашиваем ближайшие топ-матчи...');
  const matches = await provider.getTopLeaguesMatches();

  if (matches.length > 0) {
    console.log(`✅ Найдено матчей: ${matches.length}`);
    // Выведем первый матч для проверки структуры
    const m = matches[0];
    console.log(`Первый матч: ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.utcDate})`);
  } else {
    console.log('📭 Матчей не найдено или ошибка доступа.');
  }
}

bootstrap();