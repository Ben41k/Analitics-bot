import type { Bot } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../../../core/logger.js";
import { mainMenuKeyboard } from "../keyboard/main-menu.js";
import { replyWithUpcoming } from "../replies/upcoming.reply.js";

export function registerStartHandler(bot: Bot, prisma: PrismaClient, logger: Logger): void {
  bot.command("start", async (ctx) => {
    const from = ctx.from;
    logger.info({ telegramUserId: from?.id }, "Telegram /start");
    await ctx.reply(
      [
        "Привет! Я AI-Analyst Bot.",
        "",
        "Выберите действие кнопками ниже или отправьте /help для списка команд.",
      ].join("\n"),
      { reply_markup: mainMenuKeyboard() },
    );
  });

  bot.command("upcoming", async (ctx) => {
    logger.info({ telegramUserId: ctx.from?.id }, "Telegram /upcoming");
    await replyWithUpcoming(ctx, prisma);
  });
}
