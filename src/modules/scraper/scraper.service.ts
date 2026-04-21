import { Prisma } from '@prisma/client';
import { FootballDataProvider } from './providers/football-data.provider';
import { FlashscoreProvider } from './providers/flashscore.provider';
import prisma from '../../core/database';

function logPrismaUpdateError(context: string, err: unknown): void {
  console.error(`[Prisma] ${context}:`, err);
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    console.error('  code:', err.code, '| message:', err.message, '| meta:', JSON.stringify(err.meta));
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    console.error('  validation message:', err.message);
  }
}

/** Мягкая релевантность: только первое слово названия, поиск в lower-тексте. */
export function isContentRelevant(rawText: string, homeTeam: string, awayTeam: string): boolean {
  const lower = rawText.toLowerCase();
  const firstToken = (name: string) => (name.trim().split(/\s+/)[0] ?? '').toLowerCase();
  const label = (name: string) => {
    const w = name.trim().split(/\s+/)[0] ?? '';
    if (!w) return '?';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  };

  const hTok = firstToken(homeTeam);
  const aTok = firstToken(awayTeam);
  const foundH = hTok.length > 0 && lower.includes(hTok);
  const foundA = aTok.length > 0 && lower.includes(aTok);

  console.log(
    `[CHECK] Команда 1 (${label(homeTeam)}): ${foundH ? 'Найдена' : 'Не найдена'} | Команда 2 (${label(awayTeam)}): ${foundA ? 'Найдена' : 'Не найдена'}`,
  );

  return foundH && foundA;
}

export class ScraperService {
  private footballApi = new FootballDataProvider();
  private flashscore = new FlashscoreProvider();

  /** Закрыть браузер скрапера — вызывать один раз в конце `sync-matches.ts`. */
  async closeScraperBrowser(): Promise<void> {
    await this.flashscore.close();
  }

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
        // Единый текст для ИИ (SOURCE + METADATA + ARTICLE) пишем в Match.rawContent.
        const preview = await this.flashscore.getMatchPreview(match.homeTeam, match.awayTeam);
        const trimmed = (preview ?? '').trim();

        if (trimmed.length > 0) {
          const relevant = isContentRelevant(trimmed, match.homeTeam, match.awayTeam);
          if (!relevant) {
            console.log(
              `[REJECT] Первые 500 симв. отклонённого текста:\n${trimmed.slice(0, 500)}`,
            );
          }
        } else {
          console.warn(`⚠️ Пустой контент для ${match.homeTeam} vs ${match.awayTeam}`);
        }

        const rawContentFinal = trimmed.length > 0 ? trimmed : 'No preview available';

        try {
          console.log('DEBUG: Сохраняю в БД для ID:', match.id);
          await prisma.match.update({
            where: { id: match.id },
            data: { rawContent: rawContentFinal },
          });
        } catch (err) {
          logPrismaUpdateError(`match.update rawContent (id=${match.id})`, err);
        }

      } catch (err) {
        console.error(`⚠️ Ошибка при обработке матча (браузер не закрываем):`, err);
      }
    }
  }
}