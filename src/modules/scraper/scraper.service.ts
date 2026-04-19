import { FootballDataProvider } from './providers/football-data.provider';
import { FlashscoreProvider } from './providers/flashscore.provider'; // 1. Добавили импорт
import prisma from '../../core/database';

export class ScraperService {
  private footballApi = new FootballDataProvider();
  private flashscore = new FlashscoreProvider(); // 2. Инициализировали провайдер

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
    // 1. Ищем матчи в базе
    const matchesToEnrich = await prisma.match.findMany({
      where: {
        OR: [
          { rawContent: null },
          { rawContent: '' }
        ]
      },
      take: 5,
      orderBy: { date: 'asc' }
    });

    console.log(`📊 Найдено матчей для обогащения: ${matchesToEnrich.length}`);

    if (matchesToEnrich.length === 0) {
      console.log('✅ Все матчи уже имеют превью.');
      return;
    }

    // 2. Запускаем браузер один раз для всей пачки
    await this.flashscore.init();

    // 3. ЦИКЛ: перебираем найденные матчи
    for (const match of matchesToEnrich) {
      console.log(`🔎 Ищем превью для: ${match.homeTeam} vs ${match.awayTeam}`);
      
      try {
        const preview = await this.flashscore.getMatchPreview(match.homeTeam, match.awayTeam);
        
        if (preview && preview.length > 20) {
          console.log(`✨ Текст получен (${preview.length} симв.). Записываем в БД...`);
          await prisma.match.update({
            where: { id: match.id },
            data: { rawContent: preview }
          });
          console.log(`✅ База обновлена для: ${match.homeTeam}`);
        } else {
          console.log(`❌ Текст для ${match.homeTeam} не найден или слишком короткий.`);
          // Помечаем, чтобы не пытаться парсить этот же матч в следующем цикле
          await prisma.match.update({
            where: { id: match.id },
            data: { rawContent: 'No preview available' }
          });
        }
      } catch (err) {
        console.error(`⚠️ Ошибка при обработке ${match.homeTeam}:`, err);
      }
    }

    // 4. Закрываем браузер после всех матчей
    await this.flashscore.close();
  }
}