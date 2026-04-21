import http from 'node:http';
import https from 'node:https';
import { Bot, GrammyError, HttpError, InlineKeyboard, type ApiClientOptions, type Context } from 'grammy';
import { config } from './config';
import prisma from './database';
import { createLlmClient } from './llm.client';
import { logger } from './logger';
import { escapeHtml, outcomeLabel, truncateTelegramHtml } from './telegram-html';
import { AnalyzerService } from '../modules/analyzer/analyzer.service';
import { startDigestCron } from '../tasks/digest-cron.task';
import { getUserDigestFlag, upsertUserDigestFlag } from './user-digest.repository';

/** Уникальные базовые URL Bot API в порядке перебора (без хвостового «/»). */
function telegramApiRootCandidates(primary: string, fallback?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [primary, fallback]) {
    if (!raw?.trim()) continue;
    const u = raw.trim().replace(/\/+$/, '');
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

const OFFICIAL_TELEGRAM_API_ROOT = 'https://api.telegram.org';

/**
 * Для прокси / Cloudflare Worker: отключаем keep-alive на HTTPS-агенте.
 * Иначе grammY по умолчанию кэширует Agent(apiRoot) с keepAlive: true — после
 * долгого long polling getUpdates повторное использование сокета к Worker часто
 * даёт обрыв/таймаут на следующих вызовах (sendMessage и т.д.).
 */
function grammyApiClientOptions(apiRoot: string): ApiClientOptions {
  const timeoutSeconds = config.TELEGRAM_HTTP_TIMEOUT_SECONDS;
  if (apiRoot === OFFICIAL_TELEGRAM_API_ROOT) {
    return { timeoutSeconds, apiRoot };
  }
  if (apiRoot.startsWith('https:')) {
    return {
      timeoutSeconds,
      apiRoot,
      baseFetchConfig: { agent: new https.Agent({ keepAlive: false }) },
    };
  }
  if (apiRoot.startsWith('http:')) {
    return {
      timeoutSeconds,
      apiRoot,
      baseFetchConfig: { agent: new http.Agent({ keepAlive: false }) },
    };
  }
  return { timeoutSeconds, apiRoot };
}

function summarizeIncoming(ctx: Context): string {
  const u = ctx.update;
  if (u.message?.text) {
    const t = u.message.text;
    return `message text=${JSON.stringify(t.length > 160 ? `${t.slice(0, 160)}…` : t)}`;
  }
  if (u.callback_query?.data) return `callback data=${u.callback_query.data}`;
  if (u.message) return 'message (non-text)';
  if (u.edited_message) return 'edited_message';
  if (u.inline_query) return 'inline_query';
  return `update keys=${Object.keys(u).join(',')}`;
}

function shortButtonLabel(home: string, away: string): string {
  const raw = `${home} — ${away}`;
  if (raw.length <= 64) return raw;
  return `${raw.slice(0, 30)}… — …${raw.slice(-28)}`;
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

export async function startBot(): Promise<void> {
  logger.info(
    { nodeEnv: config.NODE_ENV, logLevel: config.LOG_LEVEL, cron: config.ENABLE_CRON },
    'Инициализация Telegram-бота',
  );

  try {
    await prisma.$connect();
    logger.info('База данных: подключение Prisma установлено');
  } catch (e) {
    logger.error(e, 'База данных: не удалось подключиться (DATABASE_URL / миграции)');
    throw e;
  }

  const primaryApiRoot = config.TELEGRAM_API_ROOT ?? 'https://api.telegram.org';
  const apiRoots = telegramApiRootCandidates(primaryApiRoot, config.TELEGRAM_API_FALLBACK_ROOT);

  let bot: Bot<Context> | undefined;
  let lastInitError: unknown;
  for (let i = 0; i < apiRoots.length; i++) {
    const apiRoot = apiRoots[i]!;
    console.log(
      `[ai-analyst-bot] getMe → ${apiRoot} (HTTP-таймаут ${config.TELEGRAM_HTTP_TIMEOUT_SECONDS} с; grammY ретраит при сбоях)…`,
    );
    logger.info(
      { apiRoot, httpTimeoutSec: config.TELEGRAM_HTTP_TIMEOUT_SECONDS, attemptIndex: i + 1, attempts: apiRoots.length },
      'Запрос getMe к Telegram API',
    );
    const attempt = new Bot(config.BOT_TOKEN, {
      client: grammyApiClientOptions(apiRoot),
    });
    try {
      await attempt.init();
      bot = attempt;
      console.log(`[ai-analyst-bot] getMe OK @${attempt.botInfo.username} (id=${attempt.botInfo.id}) через ${apiRoot}`);
      logger.info(
        { botUsername: attempt.botInfo.username, botId: attempt.botInfo.id, apiRoot },
        'getMe успешно',
      );
      break;
    } catch (e) {
      lastInitError = e;
      const hint =
        apiRoots.length > 1 && apiRoot === apiRoots[0]
          ? 'getMe через этот apiRoot не прошёл, пробуем TELEGRAM_API_FALLBACK_ROOT…'
          : 'getMe не прошёл для этого apiRoot.';
      console.error('[ai-analyst-bot]', hint, e);
      logger.warn({ apiRoot, err: e }, hint);
    }
  }

  if (!bot) {
    const hint =
      'getMe ни через один apiRoot не прошёл: BOT_TOKEN, сеть/VPN. Если блокируют api.telegram.org — задай TELEGRAM_API_ROOT или TELEGRAM_API_FALLBACK_ROOT (HTTPS-прокси к Bot API, например свой Cloudflare Worker).';
    console.error('[ai-analyst-bot]', hint, lastInitError);
    logger.error(lastInitError, hint);
    throw lastInitError ?? new Error('getMe failed');
  }

  const llm = createLlmClient(config);
  const analyzer = new AnalyzerService(llm);

  bot.use(async (ctx, next) => {
    const from = ctx.from;
    const summary = summarizeIncoming(ctx);
    // console — надёжно в Git Bash / Cursor; pino может буферизоваться
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
        '/matches — ближайшие матчи из базы',
        '/history — последние сохранённые прогнозы',
        '/digest on|off — рассылка дайджеста по расписанию (крон)',
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
        '4) /digest on — подписаться на периодический дайджест в чат (см. ENABLE_CRON и CRON_DIGEST_SCHEDULE в .env).',
        '',
        'Нужны переменные окружения: DATABASE_URL, BOT_TOKEN, OPENROUTER_API_KEY (для прогнозов).',
        'Матчи в базу попадают через синхронизацию: npm run scrape',
      ].join('\n'),
    );
  });

  bot.command('digest', async (ctx) => {
    await ensureUser(ctx);
    const from = ctx.from;
    if (!from) return;

    const arg = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase();

    if (arg === 'on') {
      await upsertUserDigestFlag({
        id: BigInt(from.id),
        username: from.username ?? null,
        firstName: from.first_name ?? 'User',
        digestEnabled: true,
      });
      await ctx.reply(
        [
          'Подписка на дайджест включена.',
          `Расписание задаётся на сервере (CRON_DIGEST_SCHEDULE, часовой пояс CRON_TZ).`,
          'В дайджесте — список матчей и при возможности один авто-прогноз (лимит CRON_MAX_DIGEST_LLM).',
          '',
          'Отключить: /digest off',
        ].join('\n'),
      );
      return;
    }

    if (arg === 'off') {
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
      const inner = e.error;
      const innerMsg = inner instanceof Error ? inner.message : String(inner);
      const innerCause =
        inner instanceof Error && 'cause' in inner && (inner as Error & { cause?: unknown }).cause !== undefined
          ? String((inner as Error & { cause: unknown }).cause)
          : undefined;
      logger.error(
        { err: String(e), inner: innerMsg, innerCause, innerStack: inner instanceof Error ? inner.stack : undefined },
        'Telegram HTTP',
      );
    } else {
      const stack = e instanceof Error ? e.stack : undefined;
      logger.error({ err: e, stack, update: err.ctx.update }, 'Ошибка в обработчике бота');
    }
  });

  await bot.start({
    drop_pending_updates: true,
    onStart: (me) => {
      console.log(`[ai-analyst-bot] long polling запущен @${me.username}`);
      logger.info({ id: me.id, username: me.username }, 'Telegram-бот запущен (long polling)');
      startDigestCron(bot, analyzer);
    },
  });
}
