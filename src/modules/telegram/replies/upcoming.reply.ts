import type { Context } from "grammy";
import type { Prisma, PrismaClient } from "@prisma/client";

/** Соответствует выборке ниже и `Match` в prisma/schema.prisma */
interface UpcomingMatchRow {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffUtc: Date;
  isAnalyzed: boolean;
  isScraped: boolean;
}

const upcomingMatchesQuery = {
  where: { archivedAt: null, status: "SCHEDULED" as const },
  orderBy: { kickoffUtc: "asc" as const },
  take: 5,
  select: {
    id: true,
    homeTeamName: true,
    awayTeamName: true,
    kickoffUtc: true,
    isAnalyzed: true,
    isScraped: true,
  },
};

export async function replyWithUpcoming(ctx: Context, prisma: PrismaClient): Promise<void> {
  const matches = (await prisma.match.findMany(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- нужно, если TS-сервер держит устаревший Prisma Client
    upcomingMatchesQuery as unknown as Prisma.MatchFindManyArgs,
  )) as unknown as UpcomingMatchRow[];

  if (matches.length === 0) {
    await ctx.reply(
      "В базе пока нет запланированных матчей. Сначала выполните синхронизацию Football-Data.",
    );
    return;
  }

  const lines = matches.map((m) => {
    const flags = `scraped=${String(m.isScraped)} analyzed=${String(m.isAnalyzed)}`;
    return `• ${m.homeTeamName} — ${m.awayTeamName}\n  ${m.kickoffUtc.toISOString()} (${flags})\n  id: ${m.id}`;
  });

  await ctx.reply(["Ближайшие матчи (топ-5):", "", ...lines].join("\n"));
}
