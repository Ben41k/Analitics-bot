import type { Bot, Context } from "grammy";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "../../../core/logger.js";
import { matchAnalysisSchema } from "../../../schemas/analysis.schema.js";
import { mainMenuKeyboard, MENU_CALLBACK } from "../keyboard/main-menu.js";
import { replyWithUpcoming } from "../replies/upcoming.reply.js";

const TELEGRAM_MAX_MESSAGE = 4096;

const ANALYSIS_WITH_UUID = /^\/analysis(?:@\S+)?\s+([0-9a-fA-F-]{36})\s*$/i;

/** Узкий тип строки для /analysis; соответствует prisma/schema.prisma (Match). */
interface AnalysisMatchForTelegram {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffUtc: Date;
  analysis: unknown;
  isAnalyzed: boolean;
}

function matchWhere(conditions: Record<string, unknown>): Prisma.MatchWhereInput {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- нужно, если TS-сервер держит устаревший Prisma Client
  return conditions as unknown as Prisma.MatchWhereInput;
}

function truncateForTelegram(text: string, max = TELEGRAM_MAX_MESSAGE): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 20)}\n… (обрезано)`;
}

async function replyWithAnalysisByMatchId(
  ctx: Context,
  prisma: PrismaClient,
  logger: Logger,
  matchId: string,
): Promise<void> {
  logger.info({ telegramUserId: ctx.from?.id, matchId }, "Telegram /analysis");

  const analysisSelectQuery = {
    where: { id: matchId, archivedAt: null },
    select: {
      id: true,
      homeTeamName: true,
      awayTeamName: true,
      kickoffUtc: true,
      analysis: true,
      isAnalyzed: true,
    },
  };

  const m = (await prisma.match.findFirst(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- см. upcoming.reply.ts (рассинхрон Prisma Client)
    analysisSelectQuery as unknown as Prisma.MatchFindFirstArgs,
  )) as unknown as AnalysisMatchForTelegram | null;

  if (!m) {
    await ctx.reply("Матч с таким id не найден (или архивирован).");
    return;
  }

  if (!m.isAnalyzed || m.analysis == null) {
    await ctx.reply(
      `Матч ${m.homeTeamName} — ${m.awayTeamName} ещё не проанализирован (isAnalyzed=false или нет JSON анализа).`,
    );
    return;
  }

  const parsed = matchAnalysisSchema.safeParse(m.analysis);
  if (!parsed.success) {
    await ctx.reply(
      "Анализ в базе есть, но формат JSON не совпадает со схемой. Проверьте данные вручную.",
    );
    return;
  }

  const a = parsed.data;
  const factorLines = Object.entries(a.factors).map(([k, v]) => `  ${k}: ${String(v)}/10`);

  const body = [
    `${m.homeTeamName} — ${m.awayTeamName}`,
    `Старт (UTC): ${m.kickoffUtc.toISOString()}`,
    `Уверенность (сумма факторов): ${String(a.confidenceTotal)}/100`,
    "",
    "Факторы:",
    ...factorLines,
    "",
    "Кратко:",
    a.summary,
  ];

  if (a.notes?.trim()) {
    body.push("", "Заметки:", a.notes);
  }

  await ctx.reply(truncateForTelegram(body.join("\n")));
}

async function sendStatusMessage(ctx: Context, prisma: PrismaClient): Promise<void> {
  const base = { archivedAt: null };

  const [scheduled, live, finished, scraped, embedded, analyzed, withRaw] = await Promise.all([
    prisma.match.count({ where: matchWhere({ ...base, status: "SCHEDULED" }) }),
    prisma.match.count({ where: matchWhere({ ...base, status: "LIVE" }) }),
    prisma.match.count({ where: matchWhere({ ...base, status: "FINISHED" }) }),
    prisma.match.count({ where: matchWhere({ ...base, isScraped: true }) }),
    prisma.match.count({ where: matchWhere({ ...base, isEmbedded: true }) }),
    prisma.match.count({ where: matchWhere({ ...base, isAnalyzed: true }) }),
    prisma.match.count({ where: matchWhere({ ...base, rawContent: { not: null } }) }),
  ]);

  const text = [
    "Статус данных в базе:",
    "",
    `Запланировано: ${String(scheduled)}`,
    `В игре: ${String(live)}`,
    `Завершено: ${String(finished)}`,
    "",
    `Со скрапом (raw): ${String(withRaw)}`,
    `Скрап флаг: ${String(scraped)}`,
    `Эмбеддинги: ${String(embedded)}`,
    `Проанализировано: ${String(analyzed)}`,
  ].join("\n");

  await ctx.reply(text);
}

function helpText(): string {
  return [
    "AI-Analyst Bot — команды:",
    "",
    "/start — приветствие и кнопки меню",
    "/help — этот список",
    "/upcoming — ближайшие запланированные матчи",
    "/status — сводка по данным в БД",
    "/analysis <uuid> — краткий вывод анализа по id матча",
    "",
    "Подсказка: id матча показан в ответе на «Ближайшие матчи».",
  ].join("\n");
}

export function registerInteractionHandlers(bot: Bot, prisma: PrismaClient, logger: Logger): void {
  bot.command("help", async (ctx) => {
    logger.info({ telegramUserId: ctx.from?.id }, "Telegram /help");
    await ctx.reply(helpText(), { reply_markup: mainMenuKeyboard() });
  });

  bot.command("status", async (ctx) => {
    logger.info({ telegramUserId: ctx.from?.id }, "Telegram /status");
    await sendStatusMessage(ctx, prisma);
  });

  bot.command("analysis", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const withUuid = ANALYSIS_WITH_UUID.exec(text);
    const matchId = withUuid?.[1];
    if (matchId) {
      await replyWithAnalysisByMatchId(ctx, prisma, logger, matchId);
      return;
    }
    logger.info({ telegramUserId: ctx.from?.id }, "Telegram /analysis (usage)");
    await ctx.reply(
      "Использование: /analysis <uuid-матча>\nПример: /analysis 550e8400-e29b-41d4-a716-446655440000",
    );
  });

  bot.callbackQuery(MENU_CALLBACK.upcoming, async (ctx) => {
    await ctx.answerCallbackQuery();
    logger.info({ telegramUserId: ctx.from.id }, "Telegram callback upcoming");
    await replyWithUpcoming(ctx, prisma);
  });

  bot.callbackQuery(MENU_CALLBACK.status, async (ctx) => {
    await ctx.answerCallbackQuery();
    logger.info({ telegramUserId: ctx.from.id }, "Telegram callback status");
    await sendStatusMessage(ctx, prisma);
  });

  bot.callbackQuery(MENU_CALLBACK.help, async (ctx) => {
    await ctx.answerCallbackQuery();
    logger.info({ telegramUserId: ctx.from.id }, "Telegram callback help");
    await ctx.reply(helpText(), { reply_markup: mainMenuKeyboard() });
  });
}
