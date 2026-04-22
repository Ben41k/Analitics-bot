import http from 'node:http';
import https from 'node:https';
import { Bot, GrammyError, HttpError, type ApiClientOptions, type Context } from 'grammy';
import { config } from './config';
import prisma from './database';
import { logger } from './logger';
import { AnalyzerService } from '../modules/analyzer/analyzer.service';
import { RagService } from '../modules/rag/rag.service';
import { VectorService } from '../modules/rag/vector.service';
import { registerTelegramHandlers } from '../modules/telegram/register-handlers';
import { MatchAnalyticFlow } from '../pipeline/MatchAnalyticFlow';
import { startAnalysisCron } from '../tasks/analysis.task';
import { startDigestCron } from '../tasks/digest-cron.task';

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

export async function startBot(): Promise<void> {
  logger.info(
    {
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
      digestCron: config.ENABLE_CRON,
      analysisCron: config.ENABLE_ANALYSIS_CRON,
    },
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

  const vectorService =
    config.GOOGLE_AI_API_KEY !== undefined
      ? new VectorService({
          GOOGLE_AI_API_KEY: config.GOOGLE_AI_API_KEY,
          GEMINI_EMBEDDING_MODEL: config.GEMINI_EMBEDDING_MODEL,
          GEMINI_API_BASE_URL: config.GEMINI_API_BASE_URL,
        })
      : undefined;
  const rag = new RagService(prisma, vectorService);
  const analyticFlow =
    config.GOOGLE_AI_API_KEY !== undefined
      ? new MatchAnalyticFlow({
          prisma,
          rag,
          analyzer: new AnalyzerService(config),
        })
      : undefined;

  registerTelegramHandlers(bot);

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
      startDigestCron(bot);
      startAnalysisCron(analyticFlow);
    },
  });
}
