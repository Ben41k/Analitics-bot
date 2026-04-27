import cron from 'node-cron';
import { config } from '../core/config';
import prisma from '../core/database';
import { logger } from '../core/logger';
import { AnalyzerService } from '../modules/analyzer/analyzer.service';
import type { MatchAnalyticFlow } from '../pipeline/MatchAnalyticFlow';
import { ScraperService } from '../modules/scraper/scraper.service';
import { deleteMatchesPastCalendarDay } from './past-matches-cleanup.task';

export async function runAnalysisJob(analyticFlow: MatchAnalyticFlow | undefined): Promise<void> {
  logger.info({ stage: 'analysis_cron_start' }, 'Крон анализа: старт оркестратора');

  await deleteMatchesPastCalendarDay(prisma, { timeZone: config.CRON_TZ });

  if (!config.GOOGLE_AI_API_KEY || !analyticFlow) {
    logger.info({ stage: 'analysis_cron_skip' }, 'Крон анализа: пропуск (нет GOOGLE_AI_API_KEY или пайплайна)');
    return;
  }

  if (config.CRON_ANALYSIS_RUN_SCRAPE) {
    logger.info({ stage: 'analysis_cron_scrape' }, 'Крон анализа: синхронизация матчей (скрапер)');
    const scraper = new ScraperService();
    try {
      await scraper.syncUpcomingMatches();
      logger.info({ stage: 'analysis_cron_scrape_ok' }, 'Крон анализа: синхронизация завершена');
    } catch (e) {
      logger.error(e, 'Крон анализа: ошибка скрапера');
    } finally {
      await scraper.closeScraperBrowser();
    }
  }

  const now = new Date();
  const pending = await AnalyzerService.findPendingMatchesForCron(prisma, {
    take: config.CRON_ANALYSIS_BATCH,
    now,
  });

  logger.info(
    { stage: 'analysis_queue', count: pending.length, batchLimit: config.CRON_ANALYSIS_BATCH },
    'Крон анализа: очередь матчей без анализа',
  );

  for (const match of pending) {
    logger.info({ matchId: match.id, stage: 'analysis_match_start' }, 'Крон анализа: обработка матча');
    try {
      await analyticFlow.runForMatch(match);
      logger.info({ matchId: match.id, stage: 'analysis_match_ok' }, 'Крон анализа: матч обработан');
    } catch (e) {
      logger.error({ err: e, matchId: match.id }, 'Крон анализа: ошибка на матче');
    }
  }

  logger.info({ stage: 'analysis_cron_done' }, 'Крон анализа: оркестратор завершён');
}

export function startAnalysisCron(analyticFlow: MatchAnalyticFlow | undefined): void {
  if (!config.ENABLE_ANALYSIS_CRON) {
    logger.info('Крон анализа выключен (ENABLE_ANALYSIS_CRON=false)');
    return;
  }

  const expr = config.CRON_ANALYSIS_SCHEDULE;
  if (!cron.validate(expr)) {
    logger.error({ expr }, 'Некорректное CRON_ANALYSIS_SCHEDULE — анализ не запланирован');
    return;
  }

  cron.schedule(
    expr,
    () => {
      void runAnalysisJob(analyticFlow).catch((e) => logger.error(e, 'Крон анализа: необработанная ошибка'));
    },
    { timezone: config.CRON_TZ },
  );

  logger.info(
    {
      expr,
      tz: config.CRON_TZ,
      batch: config.CRON_ANALYSIS_BATCH,
      runScrape: config.CRON_ANALYSIS_RUN_SCRAPE,
    },
    'Крон анализа запланирован',
  );
}
