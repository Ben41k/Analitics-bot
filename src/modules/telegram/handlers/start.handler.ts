import type { Bot } from "grammy";
import { MatchStatus, type PrismaClient } from "@prisma/client";
import type { Logger } from "../../../core/logger.js";

export function registerStartHandler(bot: Bot, prisma: PrismaClient, logger: Logger): void {
  bot.command("start", async (ctx) => {
    const from = ctx.from;
    logger.info({ telegramUserId: from?.id }, "Telegram /start");
    await ctx.reply(
      [
        "AI-Analyst Bot",
        "",
        "Commands:",
        "- /upcoming — next scheduled matches from database",
      ].join("\n"),
    );
  });

  bot.command("upcoming", async (ctx) => {
    const matches = await prisma.match.findMany({
      where: { archivedAt: null, status: MatchStatus.SCHEDULED },
      orderBy: { kickoffUtc: "asc" },
      take: 5,
      select: {
        id: true,
        homeTeamName: true,
        awayTeamName: true,
        kickoffUtc: true,
        isAnalyzed: true,
        isScraped: true,
      },
    });

    if (matches.length === 0) {
      await ctx.reply("No upcoming matches in database yet. Run Football-Data sync first.");
      return;
    }

    const lines = matches.map((m) => {
      const flags = `scraped=${String(m.isScraped)} analyzed=${String(m.isAnalyzed)}`;
      return `- ${m.homeTeamName} vs ${m.awayTeamName} @ ${m.kickoffUtc.toISOString()} (${flags}) id=${m.id}`;
    });

    await ctx.reply(["Upcoming (top 5):", "", ...lines].join("\n"));
  });
}
