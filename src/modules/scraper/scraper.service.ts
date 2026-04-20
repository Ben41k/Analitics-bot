import { FootballDataProvider } from './providers/football-data.provider';
import { FlashscoreProvider } from './providers/flashscore.provider';
import prisma from '../../core/database';
// --- ВСТАВЛЯЕМ ИМПОРТ СХЕМЫ ЗДЕСЬ ---
import { MatchSchema } from '../../schemas/match.schema';

export class ScraperService {
  private footballApi = new FootballDataProvider();
  private flashscore = new FlashscoreProvider();

  async syncUpcomingMatches() {
    console.log('🔄 Начинаем синхронизацию матчей в БД...');
    const rawMatches = await this.footballApi.getTopLeaguesMatches();

    if (!rawMatches || rawMatches.length === 0) {
      console.log('⚠️ Нет данных для синхронизации.');
      return;
    }

    let createdCount = 0;

    for (const raw of rawMatches) {
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
          rawContent: null, // Оставляем null по умолчанию
        },
      });
      createdCount++;
    }

    console.log(`✅ Синхронизация завершена! Обработано матчей: ${createdCount}`);

    // 3. ЗАПУСКАЕМ ПАРСИНГ ТЕКСТА
    await this.enrichMatchesWithPreview();
  }

  private async enrichMatchesWithPreview() {
    const matchesToEnrich = await prisma.match.findMany({
      where: {
        OR: [{ rawContent: null }, { rawContent: '' }]
      },
      take: 5,
      orderBy: { date: 'asc' }
    });

    if (matchesToEnrich.length === 0) return;

    await this.flashscore.init();

    for (const match of matchesToEnrich) {
      console.log(`🔎 Ищем превью для: ${match.homeTeam} vs ${match.awayTeam}`);
      
      try {
        const preview = await this.flashscore.getMatchPreview(match.homeTeam, match.awayTeam);
        
        // --- ЛОГИКА ВАЛИДАЦИИ ВСТАВЛЯЕТСЯ ТУТ ---
        const validationResult = MatchSchema.safeParse({
          externalId: match.externalId,
          rawContent: preview,
          provider: 'flashscore'
        });

        if (validationResult.success && validationResult.data.rawContent) {
          await prisma.match.update({
            where: { id: match.id },
            data: { rawContent: validationResult.data.rawContent } 
          });
        } else {
          // Если success: false ИЛИ rawContent пустой
          console.warn(`⚠️ Ошибка валидации или пустой контент для ${match.homeTeam}`);
          
          await prisma.match.update({
            where: { id: match.id },
            data: { rawContent: 'No preview available' }
          });
        }
        // ----------------------------------------

      } catch (err) {
        console.error(`⚠️ Ошибка при обработке ${match.homeTeam}:`, err);
      }
    }

    await this.flashscore.close();
  }
}