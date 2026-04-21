import { Bot, GrammyError, HttpError, InlineKeyboard, type Context } from 'grammy';
import { config } from './config';
import prisma from './database';
import { createLlmClient } from './llm.client';
import { logger } from './logger';
import { AnalyzerService } from '../modules/analyzer/analyzer.service';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function outcomeLabel(outcome: '1' | 'X' | '2', homeTeam: string, awayTeam: string): string {
  if (outcome === '1') return `П1 — ${homeTeam}`;
  if (outcome === '2') return `П2 — ${awayTeam}`;
  return 'X — ничья';
}

function truncateTelegramHtml(html: string, max = 3900): string {
  if (html.length <= max) return html;
  return `${html.slice(0, max - 20)}… <i>(обрезано)</i>`;
}

async function ensureUser(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  await prisma.user.upsert({
    where: { id: BigInt(from.id) },
    create: {
      id: BigInt(from.id),
      username: from.username ?? null,
      firstName: from.first_name ?? 'User',
    },
    update: {
      username: from.username ?? null,
      firstName: from.first_name ?? 'User',
    },
  });
}

function shortButtonLabel(home: string, away: string): string {
  const raw = `${home} — ${away}`;
  if (raw.length <= 64) return raw;
  return `${raw.slice(0, 30)}… — …${raw.slice(-28)}`;
}

export async function startBot(): Promise<void> {
  const bot = new Bot(config.BOT_TOKEN);
  const llm = createLlmClient(config);
  const analyzer = new AnalyzerService(llm);

  bot.command('start', async (ctx) => {
    await ensureUser(ctx);
    await ctx.reply(
      [
        'Привет! Я бот спортивной аналитики.',
        '',
        'Команды:',
        '/matches — ближайшие матчи из базы',
        '/history — последние сохранённые прогнозы',
        '/help — справка',
      ].join('\n'),
    );
  });

  bot.command('help', async (ctx) => {
    await ensureUser(ctx);
    await ctx.reply(
      [
        'Как пользоваться:',
        '1) /matches — список матчей с кнопками.',
        '2) Нажми кнопку с названием матча — получишь разбор и исход (П1 / X / П2) с оценкой уверенности.',
        '3) /history — кратко последние прогнозы.',
        '',
        'Нужны переменные окружения: DATABASE_URL, BOT_TOKEN, OPENROUTER_API_KEY.',
        'Матчи в базу попадают через синхронизацию: npm run scrape',
      ].join('\n'),
    );
  });

  bot.command('matches', async (ctx) => {
    await ensureUser(ctx);
    const now = new Date();
    const matches = await prisma.match.findMany({
      where: { date: { gte: now } },
      orderBy: { date: 'asc' },
      take: 20,
    });

    if (matches.length === 0) {
      await ctx.reply('В базе нет предстоящих матчей. Запусти синхронизацию: npm run scrape');
      return;
    }

    const lines = matches.map(
      (m, i) =>
        `${i + 1}. ${escapeHtml(m.homeTeam)} — ${escapeHtml(m.awayTeam)}\n   ${escapeHtml(m.league)} · ${m.date.toISOString().slice(0, 16)}Z`,
    );

    const keyboard = new InlineKeyboard();
    for (const m of matches) {
      keyboard.text(shortButtonLabel(m.homeTeam, m.awayTeam), `predict:${m.id}`).row();
    }

    await ctx.reply(
      `<b>Ближайшие матчи</b>\n\n${lines.join('\n\n')}\n\nНажми кнопку под матчем для прогноза.`,
      { reply_markup: keyboard, parse_mode: 'HTML' },
    );
  });

  bot.callbackQuery(/^predict:([0-9a-f-]{36})$/i, async (ctx) => {
    await ensureUser(ctx);
    const matchId = ctx.match![1];

    if (!config.OPENROUTER_API_KEY) {
      await ctx.answerCallbackQuery({ text: 'Не задан OPENROUTER_API_KEY', show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery({ text: 'Считаю прогноз…' });

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) {
      await ctx.reply('Матч не найден. Обнови список: /matches');
      return;
    }

    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (chatId) await ctx.api.sendChatAction(chatId, 'typing');

    try {
      const outcome = await analyzer.analyzeMatch(match);

      const label = outcomeLabel(outcome.outcome, match.homeTeam, match.awayTeam);
      const summaryHtml = escapeHtml(outcome.summary).replace(/\r\n/g, '\n').replace(/\n/g, '<br/>');

      const body = [
        `<b>${escapeHtml(match.homeTeam)} — ${escapeHtml(match.awayTeam)}</b>`,
        `<b>Прогноз:</b> ${escapeHtml(label)}`,
        `<b>Уверенность:</b> ${Math.round(outcome.confidence)}%`,
        '',
        `<b>Разбор</b>`,
        summaryHtml,
      ].join('\n');

      const plainForDb = [
        `${match.homeTeam} — ${match.awayTeam}`,
        `Прогноз: ${label}`,
        `Уверенность: ${Math.round(outcome.confidence)}%`,
        '',
        outcome.summary,
      ].join('\n');

      await prisma.analysis.create({
        data: {
          matchId: match.id,
          userId: BigInt(ctx.from!.id),
          prediction: outcome.outcome,
          confidence: Math.min(100, Math.max(0, Math.round(outcome.confidence))),
          result: plainForDb,
        },
      });

      await ctx.reply(truncateTelegramHtml(body), { parse_mode: 'HTML' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error({ err: msg, matchId }, 'Ошибка прогноза');
      await ctx.reply(`Не удалось получить прогноз: ${escapeHtml(msg)}`, { parse_mode: 'HTML' });
    }
  });

  bot.command('history', async (ctx) => {
    await ensureUser(ctx);
    const rows = await prisma.analysis.findMany({
      where: { userId: BigInt(ctx.from!.id) },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { match: true },
    });
    if (rows.length === 0) {
      await ctx.reply('Пока нет сохранённых прогнозов.');
      return;
    }
    const text = rows
      .map((a) => {
        const m = a.match;
        const when = a.createdAt.toISOString().slice(0, 16);
        return `${when}Z · ${m.homeTeam} — ${m.awayTeam}: ${a.prediction ?? '?'} (${a.confidence ?? '—'}%)`;
      })
      .join('\n');
    await ctx.reply(`<b>Последние прогнозы</b>\n\n${escapeHtml(text)}`, { parse_mode: 'HTML' });
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) {
      logger.error({ description: e.description }, 'Grammy API');
    } else if (e instanceof HttpError) {
      logger.error({ err: String(e) }, 'Telegram HTTP');
    } else {
      logger.error({ err: e, update: err.ctx.update }, 'Ошибка в обработчике бота');
    }
  });

  await bot.start({
    onStart: (me) => {
      logger.info({ id: me.id, username: me.username }, 'Telegram-бот запущен (long polling)');
    },
  });
}
