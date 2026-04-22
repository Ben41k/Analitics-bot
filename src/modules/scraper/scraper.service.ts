import { Prisma } from '@prisma/client';
import { FootballDataProvider } from './providers/football-data.provider';
import { FlashscoreProvider, teamSearchNeedles } from './providers/flashscore.provider';
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

/** Релевантность: те же гибкие «иглы», что в скрапере (без «1.», FC/SC и т.д.). */
export function isContentRelevant(rawText: string, homeTeam: string, awayTeam: string): boolean {
  const lower = rawText.toLowerCase();
  const label = (name: string) => {
    const w = name.trim().split(/\s+/)[0] ?? '';
    if (!w) return '?';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  };

  const hits = (team: string) =>
    teamSearchNeedles(team).some((needle) => needle.length >= 2 && lower.includes(needle));

  const foundH = hits(homeTeam);
  const foundA = hits(awayTeam);

  console.log(
    `[CHECK] Команда 1 (${label(homeTeam)}): ${foundH ? 'Найдена' : 'Не найдена'} | Команда 2 (${label(awayTeam)}): ${foundA ? 'Найдена' : 'Не найдена'}`,
  );

  return foundH && foundA;
}

/** Сколько матчей без превью обрабатываем за один проход к БД (цикл повторяется, пока очередь не пуста). */
const ENRICH_PREVIEW_BATCH_SIZE = 20;

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
          homeTeam: raw.homeTeam.name,
          awayTeam: raw.awayTeam.name,
          league: raw.competition.name,
          date: new Date(raw.utcDate),
        },
        create: {
          externalId: String(raw.id),
          homeTeam: raw.homeTeam.name,
          awayTeam: raw.awayTeam.name,
          date: new Date(raw.utcDate),
          sport: 'football',
          league: raw.competition.name,
          rawContent: null,
        },
      });
      createdCount++;
    }

    console.log(`✅ Импорт из API: upsert для ${createdCount} матчей (записи в БД обновлены/созданы).`);

    // 3. Обогащение превью — все матчи с пустым rawContent, порциями без жёсткого «только 5»
    await this.enrichMatchesWithPreview();
  }

  private async enrichMatchesWithPreview() {
    let browserStarted = false;
    let totalPreviewRuns = 0;

    for (;;) {
      const matchesToEnrich = await prisma.match.findMany({
        where: {
          OR: [
            { rawContent: null },
            { rawContent: '' },
            { rawContent: { contains: 'No preview available' } },
          ],
        },
        take: ENRICH_PREVIEW_BATCH_SIZE,
        orderBy: { date: 'asc' },
      });

      if (matchesToEnrich.length === 0) {
        if (!browserStarted) {
          console.log(
            'ℹ️ Нет матчей для превью (null, пусто или плейсхолдер «No preview available») — пропуск.',
          );
        }
        break;
      }

      if (!browserStarted) {
        await this.flashscore.init();
        browserStarted = true;
      }

      console.log(
        `📥 Превью: порция из ${matchesToEnrich.length} матчей (батч до ${ENRICH_PREVIEW_BATCH_SIZE})…`,
      );

      for (const match of matchesToEnrich) {
        console.log(`🔎 Ищем превью для: ${match.homeTeam} vs ${match.awayTeam}`);

        try {
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
          try {
            await prisma.match.update({
              where: { id: match.id },
              data: { rawContent: 'No preview available' },
            });
          } catch (e2) {
            logPrismaUpdateError(`match.update после ошибки скрапа (id=${match.id})`, e2);
          }
        }

        totalPreviewRuns++;
      }
    }

    if (browserStarted && totalPreviewRuns > 0) {
      console.log(`✅ Обогащение превью: обработано попыток — ${totalPreviewRuns}`);
    }
  }
}