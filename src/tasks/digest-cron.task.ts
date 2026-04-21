import cron from 'node-cron';
import type { Bot } from 'grammy';
import type { Match } from '@prisma/client';
import { config } from '../core/config';
import { logger } from '../core/logger';
import prisma from '../core/database';
import { listDigestSubscriberUserIds } from '../core/user-digest.repository';
import { escapeHtml, outcomeLabel, truncateTelegramHtml } from '../core/telegram-html';
import type { AnalyzerService } from '../modules/analyzer/analyzer.service';
import { ScraperService } from '../modules/scraper/scraper.service';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function pickMatchForDigest(userId: bigint, matches: Match[]): Promise<Match | null> {
  const recentWindow = new Date(Date.now() - 20 * 60 * 60 * 1000);
  for (const m of matches) {
    const recent = await prisma.analysis.findFirst({
      where: { userId, matchId: m.id, createdAt: { gte: recentWindow } },
    });
    if (!recent) return m;
  }
  return null;
}

export async function runDigestJob(bot: Bot, analyzer: AnalyzerService): Promise<void> {
  logger.info('Крон: запуск дайджеста матчей');

  if (config.CRON_RUN_SCRAPE) {
    try {
      const scraper = new ScraperService();
      await scraper.syncUpcomingMatches();
      logger.info('Крон: синхронизация матчей завершена');
    } catch (e) {
      logger.error(e, 'Крон: ошибка синхронизации матчей');
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

  let llmBudget = config.CRON_MAX_DIGEST_LLM;

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
      const lines = preview.map(
        (m, i) =>
          `${i + 1}. ${escapeHtml(m.homeTeam)} — ${escapeHtml(m.awayTeam)}\n   ${escapeHtml(m.league)} · ${m.date.toISOString().slice(0, 16)}Z`,
      );

      let analysisBlock = '';
      if (config.OPENROUTER_API_KEY && llmBudget > 0) {
        const match = await pickMatchForDigest(userId, matches);
        if (match) {
          try {
            const outcome = await analyzer.analyzeMatch(match);
            llmBudget -= 1;

            const label = outcomeLabel(outcome.outcome, match.homeTeam, match.awayTeam);
            const summaryHtml = escapeHtml(outcome.summary).replace(/\r\n/g, '\n').replace(/\n/g, '<br/>');

            const plainForDb = [
              `${match.homeTeam} — ${match.awayTeam}`,
              `Прогноз: ${label}`,
              `Уверенность: ${Math.round(outcome.confidence)}%`,
              '',
              outcome.summary,
              '',
              '(авто-дайджест по расписанию)',
            ].join('\n');

            await prisma.analysis.create({
              data: {
                matchId: match.id,
                userId,
                prediction: outcome.outcome,
                confidence: Math.min(100, Math.max(0, Math.round(outcome.confidence))),
                result: plainForDb,
              },
            });

            analysisBlock = [
              '',
              `<b>Авто-прогноз</b> (${escapeHtml(match.homeTeam)} — ${escapeHtml(match.awayTeam)})`,
              `<b>Исход:</b> ${escapeHtml(label)}`,
              `<b>Уверенность:</b> ${Math.round(outcome.confidence)}%`,
              '',
              summaryHtml,
            ].join('\n');
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error({ err: msg, userId: String(userId) }, 'Крон: ошибка LLM в дайджесте');
            analysisBlock = `\n\n<i>Авто-прогноз не удался: ${escapeHtml(msg)}</i>`;
          }
        }
      } else if (!config.OPENROUTER_API_KEY) {
        analysisBlock = `\n\n<i>LLM не настроен — задай OPENROUTER_API_KEY для прогноза в дайджесте.</i>`;
      }

      const body = truncateTelegramHtml(
        [
          '<b>Дайджест матчей</b>',
          '',
          lines.join('\n\n'),
          analysisBlock,
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

  logger.info({ users: subscriberIds.length, llmLeft: llmBudget }, 'Крон: дайджест завершён');
}

export function startDigestCron(bot: Bot, analyzer: AnalyzerService): void {
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
      void runDigestJob(bot, analyzer).catch((e) => logger.error(e, 'Крон: необработанная ошибка дайджеста'));
    },
    { timezone: config.CRON_TZ },
  );

  logger.info({ expr, tz: config.CRON_TZ, lookaheadHours: config.CRON_DIGEST_LOOKAHEAD_HOURS }, 'Крон дайджеста запланирован');
}
