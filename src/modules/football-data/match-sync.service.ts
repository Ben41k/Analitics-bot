import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../core/config.js";
import type { Logger } from "../../core/logger.js";
import { FootballDataProvider } from "./football-data.provider.js";
import { mapFootballDataStatus } from "./football-data-status.js";
import { extractSeasonYear } from "./season.js";

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class MatchSyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly provider: FootballDataProvider,
  ) {}

  static create(prisma: PrismaClient, config: AppConfig, logger: Logger): MatchSyncService {
    return new MatchSyncService(prisma, config, logger, new FootballDataProvider(config, logger));
  }

  async syncMatches(params: {
    jobId: string;
    signal?: AbortSignal;
  }): Promise<{ upserted: number }> {
    const log = this.logger.child({ jobId: params.jobId, module: "MatchSyncService" });
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - this.config.FOOTBALL_SYNC_DAYS_PAST);
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + this.config.FOOTBALL_SYNC_DAYS_AHEAD);

    const dateFrom = toIsoDate(from);
    const dateTo = toIsoDate(to);

    let upserted = 0;
    for (const competitionId of this.config.FOOTBALL_DATA_COMPETITION_IDS) {
      try {
        const data = await this.provider.fetchMatchesForCompetition({
          competitionId,
          dateFrom,
          dateTo,
          signal: params.signal,
        });

        for (const m of data.matches) {
          try {
            const status = mapFootballDataStatus(m.status);
            const kickoffUtc = new Date(m.utcDate);
            if (Number.isNaN(kickoffUtc.getTime())) {
              log.warn({ footballDataId: m.id }, "Skipping match with invalid utcDate");
              continue;
            }

            await this.prisma.match.upsert({
              where: { footballDataId: m.id },
              create: {
                footballDataId: m.id,
                homeTeamName: m.homeTeam.name,
                awayTeamName: m.awayTeam.name,
                kickoffUtc,
                status,
                competitionId: m.competition?.id ?? competitionId,
                competitionName: m.competition?.name ?? null,
                seasonYear: extractSeasonYear(m.season),
              },
              update: {
                homeTeamName: m.homeTeam.name,
                awayTeamName: m.awayTeam.name,
                kickoffUtc,
                status,
                competitionId: m.competition?.id ?? competitionId,
                competitionName: m.competition?.name ?? null,
                seasonYear: extractSeasonYear(m.season),
              },
            });
            upserted += 1;
          } catch (err) {
            log.error(
              { err, footballDataId: m.id },
              "Failed to upsert single match from Football-Data; continuing batch",
            );
          }
        }
      } catch (err) {
        log.error({ err, competitionId }, "Failed to sync competition; continuing");
      }
    }

    log.info({ upserted, dateFrom, dateTo }, "Football-Data match sync finished");
    return { upserted };
  }
}
