import cron from 'node-cron';
import type { Bot } from 'grammy';
import { config } from '../core/config';
import { logger } from '../core/logger';
import prisma from '../core/database';
import { listDigestSubscriberUserIds } from '../core/user-digest.repository';
import { escapeHtml, truncateTelegramHtml } from '../core/telegram-html';
import { formatMatchConfidenceBadgeHtml } from '../modules/telegram/confidence-visual';
import { ScraperService } from '../modules/scraper/scraper.service';
import { deleteMatchesPastCalendarDay } from './past-matches-cleanup.task';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runDigestJob(bot: Bot): Promise<void> {
  logger.info('Крон: запуск дайджеста матчей');

  await deleteMatchesPastCalendarDay(prisma, { timeZone: config.CRON_TZ });

  if (config.CRON_RUN_SCRAPE) {
    const scraper = new ScraperService();
    try {
      await scraper.syncUpcomingMatches();
      logger.info('Крон: синхронизация матчей завершена');
    } catch (e) {
      logger.error(e, 'Крон: ошибка синхронизации матчей');
    } finally {
      await scraper.closeScraperBrowser();
    }
  }

  const subscriberIds = await listDigestSubscriberUserIds();
  if (subscriberIds.length === 0) {
    logger.info('Крон: подписчиков digest нет (/digest on)');
    return;
  }

  const now = new Date();
  const until = new Date(now.getTime() + config.CRON_DIGEST_LOOKAHEAD_HOURS * 60 * 60 * 1000);
  const matches = await prisma.match.findMany({
    where: { date: { gte: now, lte: until } },
    orderBy: { date: 'asc' },
    take: 20,
  });

  for (const userId of subscriberIds) {
    try {
      if (matches.length === 0) {
        await bot.api.sendMessage(
          Number(userId),
          [
            '<b>Дайджест</b>',
            '',
            `В ближайшие ${config.CRON_DIGEST_LOOKAHEAD_HOURS} ч в базе нет матчей.`,
            'Запусти <code>npm run scrape</code> или дождись следующего окна.',
            '',
            '<i>/digest off — отписаться</i>',
          ].join('\n'),
          { parse_mode: 'HTML' },
        );
        await sleep(120);
        continue;
      }

      const preview = matches.slice(0, 6);
      const lines = preview.map((m, i) => {
        const badge = formatMatchConfidenceBadgeHtml(m);
        return `${i + 1}. ${escapeHtml(m.homeTeam)} — ${escapeHtml(m.awayTeam)}\n   ${escapeHtml(m.league)} · ${m.date.toISOString().slice(0, 16)}Z\n   ${badge}`;
      });

      const body = truncateTelegramHtml(
        [
          '<b>Дайджест матчей</b>',
          '<i>Прогнозы готовятся в фоне — смотри /matches</i>',
          '',
          lines.join('\n\n'),
          '',
          '<i>/digest off — отписаться</i>',
        ].join('\n'),
      );

      await bot.api.sendMessage(Number(userId), body, { parse_mode: 'HTML' });
      await sleep(150);
    } catch (e) {
      logger.error({ err: e, userId: String(userId) }, 'Крон: не удалось отправить дайджест пользователю');
    }
  }

  logger.info({ users: subscriberIds.length }, 'Крон: дайджест завершён');
}

export function startDigestCron(bot: Bot): void {
  if (!config.ENABLE_CRON) {
    logger.info('Крон выключен (ENABLE_CRON=false)');
    return;
  }

  const expr = config.CRON_DIGEST_SCHEDULE;
  if (!cron.validate(expr)) {
    logger.error({ expr }, 'Некорректное CRON_DIGEST_SCHEDULE — дайджест не запланирован');
    return;
  }

  cron.schedule(
    expr,
    () => {
      void runDigestJob(bot).catch((e) => logger.error(e, 'Крон: необработанная ошибка дайджеста'));
    },
    { timezone: config.CRON_TZ },
  );

  logger.info({ expr, tz: config.CRON_TZ, lookaheadHours: config.CRON_DIGEST_LOOKAHEAD_HOURS }, 'Крон дайджеста запланирован');
}
