import { Prisma } from '@prisma/client';
import { config } from '../../core/config';
import prisma from '../../core/database';
import { logger } from '../../core/logger';
import { deleteMatchesPastCalendarDay } from '../../tasks/past-matches-cleanup.task';
import { FootballDataProvider } from './providers/football-data.provider';
import { FlashscoreProvider, teamSearchNeedles } from './providers/flashscore.provider';
import { NO_PREVIEW_PLACEHOLDER, PREVIEW_REJECTED_PLACEHOLDER } from './raw-content-preview';

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
    await deleteMatchesPastCalendarDay(prisma, { timeZone: config.CRON_TZ });
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

    console.log(
      `✅ Импорт из API: upsert для ${createdCount} матчей (метаданные; поле rawContent при update не сбрасывается — превью ниже).`,
    );

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
            { rawContent: NO_PREVIEW_PLACEHOLDER },
          ],
        },
        take: ENRICH_PREVIEW_BATCH_SIZE,
        orderBy: { date: 'asc' },
      });

      if (matchesToEnrich.length === 0) {
        if (!browserStarted) {
          console.log(
            'ℹ️ Нет матчей для превью (null, пусто или «No preview available»; отклонённые превью не переобогащаются) — пропуск.',
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

          let rawContentFinal: string;
          if (trimmed.length === 0) {
            console.warn(`⚠️ Пустой контент для ${match.homeTeam} vs ${match.awayTeam}`);
            rawContentFinal = NO_PREVIEW_PLACEHOLDER;
          } else if (trimmed === NO_PREVIEW_PLACEHOLDER) {
            rawContentFinal = NO_PREVIEW_PLACEHOLDER;
          } else if (!isContentRelevant(trimmed, match.homeTeam, match.awayTeam)) {
            console.log(
              `[REJECT] Текст не про эти команды — сохраняем маркер отказа. Первые 500 симв.:\n${trimmed.slice(0, 500)}`,
            );
            rawContentFinal = PREVIEW_REJECTED_PLACEHOLDER;
          } else {
            rawContentFinal = trimmed;
          }

          try {
            await prisma.match.update({
              where: { id: match.id },
              data: { rawContent: rawContentFinal },
            });
            logger.info(
              {
                matchId: match.id,
                stage: 'scraper_raw_content_saved',
                charLength: rawContentFinal.length,
                kind:
                  rawContentFinal === NO_PREVIEW_PLACEHOLDER
                    ? 'no_preview'
                    : rawContentFinal === PREVIEW_REJECTED_PLACEHOLDER
                      ? 'rejected'
                      : 'article',
              },
              'Скрапер: rawContent записан в БД',
            );
          } catch (err) {
            logPrismaUpdateError(`match.update rawContent (id=${match.id})`, err);
          }
        } catch (err) {
          console.error(`⚠️ Ошибка при обработке матча (браузер не закрываем):`, err);
          try {
            await prisma.match.update({
              where: { id: match.id },
              data: { rawContent: NO_PREVIEW_PLACEHOLDER },
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