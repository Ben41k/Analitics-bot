import { FootballDataProvider } from './providers/football-data.provider';
import prisma from '../../core/database';

export class ScraperService {
  private footballApi = new FootballDataProvider();

  async syncUpcomingMatches() {
    console.log('🔄 Начинаем синхронизацию матчей в БД...');
    const rawMatches = await this.footballApi.getTopLeaguesMatches();

    if (!rawMatches || rawMatches.length === 0) {
      console.log('⚠️ Нет данных для синхронизации.');
      return;
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const raw of rawMatches) {
      // Используем upsert: если матч есть — обновим дату, если нет — создадим
      await prisma.match.upsert({
        where: { externalId: String(raw.id) },
        update: {
          date: new Date(raw.utcDate),
        },
        create: {
          externalId: String(raw.id),
          homeTeam: raw.homeTeam.name,
          awayTeam: raw.awayTeam.name,
          date: new Date(raw.utcDate),
          sport: 'football',
          league: raw.competition.name,
          rawContent: '', // Сюда потом Playwright допишет аналитику с Flashscore
        },
      });
      createdCount++;
    }

    console.log(`✅ Синхронизация завершена! Обработано матчей: ${createdCount}`);
  }
}