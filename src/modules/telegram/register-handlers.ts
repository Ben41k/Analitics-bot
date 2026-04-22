import type { Bot, Context } from 'grammy';
import { z } from 'zod';
import prisma from '../../core/database';
import { logger } from '../../core/logger';
import { escapeHtml, outcomeLabel, truncateTelegramHtml } from '../../core/telegram-html';
import { getUserDigestFlag, upsertUserDigestFlag } from '../../core/user-digest.repository';
import { formatMatchConfidenceBadgeHtml } from './confidence-visual';
import { parseDigestCommandArgs } from './digest-args';
import { ensureUser } from './ensure-user';
import { summarizeIncoming } from './summarize-incoming';

const outcomeSchema = z.enum(['1', 'X', '2']);

export function registerTelegramHandlers(bot: Bot<Context>): void {
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    const summary = summarizeIncoming(ctx);
    console.log(
      `[tg] update #${ctx.update.update_id} chat=${ctx.chat?.id ?? '—'} user=${from?.id ?? '—'} ${summary}`,
    );
    logger.info(
      {
        updateId: ctx.update.update_id,
        userId: from?.id,
        username: from?.username,
        chatId: ctx.chat?.id,
        summary,
      },
      'Входящее обновление Telegram',
    );
    await next();
  });

  bot.command('start', async (ctx) => {
    await ensureUser(ctx);
    await ctx.reply(
      [
        'Привет! Я бот спортивной аналитики.',
        '',
        'Команды:',
        '/matches — матчи с готовым фоновым анализом из базы',
        '/digest on|off — рассылка дайджеста по расписанию (крон на сервере)',
        '/help — справка',
      ].join('\n'),
    );
  });

  bot.command('help', async (ctx) => {
    await ensureUser(ctx);
    await ctx.reply(
      [
        'Как пользоваться:',
        '1) Анализ матчей выполняется в фоне (крон ENABLE_ANALYSIS_CRON + GOOGLE_AI_API_KEY).',
        '2) /matches — список уже проанализированных матчей из БД (исход, уверенность, краткий разбор).',
        '3) /digest on — подписаться на периодический дайджест (ENABLE_CRON, CRON_DIGEST_SCHEDULE, CRON_TZ).',
        '',
        'Матчи в базу: npm run scrape',
      ].join('\n'),
    );
  });

  bot.command('digest', async (ctx) => {
    await ensureUser(ctx);
    const from = ctx.from;
    if (!from) return;

    const parsed = parseDigestCommandArgs(ctx.message?.text);

    if (parsed.kind === 'invalid') {
      await ctx.reply(parsed.message, { parse_mode: 'HTML' });
      return;
    }

    if (parsed.kind === 'on') {
      await upsertUserDigestFlag({
        id: BigInt(from.id),
        username: from.username ?? null,
        firstName: from.first_name ?? 'User',
        digestEnabled: true,
      });
      await ctx.reply(
        [
          'Подписка на дайджест включена.',
          'Расписание на сервере: CRON_DIGEST_SCHEDULE, часовой пояс CRON_TZ.',
          'В дайджесте — ближайшие матчи и метки уверенности по готовым данным из БД.',
          '',
          'Отключить: /digest off',
        ].join('\n'),
      );
      return;
    }

    if (parsed.kind === 'off') {
      await upsertUserDigestFlag({
        id: BigInt(from.id),
        username: from.username ?? null,
        firstName: from.first_name ?? 'User',
        digestEnabled: false,
      });
      await ctx.reply('Подписка на дайджест выключена.');
      return;
    }

    const on = await getUserDigestFlag(BigInt(from.id));
    await ctx.reply(
      [
        'Дайджест по крону: периодическое сообщение со списком ближайших матчей.',
        `Сейчас: ${on ? 'включено' : 'выключено'}.`,
        '',
        'Команды: /digest on | /digest off',
      ].join('\n'),
    );
  });

  bot.command('matches', async (ctx) => {
    await ensureUser(ctx);
    const matches = await prisma.match.findMany({
      where: { analyzedAt: { not: null } },
      orderBy: { analyzedAt: 'desc' },
      take: 35,
    });

    if (matches.length === 0) {
      await ctx.reply(
        'В базе пока нет матчей с завершённым анализом. Дождись фонового крона (ENABLE_ANALYSIS_CRON) или проверь ключ GOOGLE_AI_API_KEY.',
      );
      return;
    }

    const blocks = matches.map((m, i) => {
      const predParsed = outcomeSchema.safeParse(m.analysisPrediction);
      const label =
        predParsed.success && m.analysisPrediction
          ? outcomeLabel(predParsed.data, m.homeTeam, m.awayTeam)
          : '—';
      const badge = formatMatchConfidenceBadgeHtml(m);
      const ai =
        m.analysisAiConfidence != null ? `${Math.round(m.analysisAiConfidence)}%` : '—';
      const summaryShort =
        m.analysisSummary && m.analysisSummary.length > 220
          ? `${escapeHtml(m.analysisSummary.slice(0, 220))}…`
          : escapeHtml(m.analysisSummary ?? '');

      return [
        `<b>${i + 1}.</b> ${escapeHtml(m.homeTeam)} — ${escapeHtml(m.awayTeam)}`,
        `${escapeHtml(m.league)} · ${m.date.toISOString().slice(0, 16)}Z`,
        `${badge} · исход: <b>${escapeHtml(label)}</b> · модель: <i>${escapeHtml(ai)}</i>`,
        summaryShort ? `<blockquote>${summaryShort}</blockquote>` : '',
      ]
        .filter((line) => line.length > 0)
        .join('\n');
    });

    const body = truncateTelegramHtml(
      ['<b>Проанализированные матчи</b>', '<i>Данные из БД (фоновый анализ)</i>', '', ...blocks].join('\n\n'),
    );

    await ctx.reply(body, { parse_mode: 'HTML' });
  });
}
