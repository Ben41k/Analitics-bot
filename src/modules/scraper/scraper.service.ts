import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../core/config.js";
import type { Logger } from "../../core/logger.js";
import { FlashscoreProvider } from "./providers/flashscore.provider.js";

export class ScraperService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly flashscore: FlashscoreProvider,
  ) {}

  static create(prisma: PrismaClient, config: AppConfig, logger: Logger): ScraperService {
    return new ScraperService(prisma, config, logger, new FlashscoreProvider(config, logger));
  }

  async scrapeQueuedMatches(params: { jobId: string; signal?: AbortSignal }): Promise<{
    attempted: number;
    updated: number;
  }> {
    const log = this.logger.child({ jobId: params.jobId, module: "ScraperService" });

    const matches = await this.prisma.match.findMany({
      where: {
        archivedAt: null,
        flashscoreUrl: { not: null },
        rawContent: null,
      },
      take: this.config.SCRAPER_TAKE_LIMIT,
      orderBy: { kickoffUtc: "asc" },
    });

    let attempted = 0;
    let updated = 0;

    for (const m of matches) {
      attempted += 1;
      if (!m.flashscoreUrl) {
        continue;
      }
      try {
        const page = await this.flashscore.fetchPageText({
          url: m.flashscoreUrl,
          jobId: params.jobId,
          signal: params.signal,
        });

        if (page.text.length < this.config.MIN_RAW_CONTENT_LENGTH) {
          log.warn(
            { matchId: m.id, chars: page.text.length, min: this.config.MIN_RAW_CONTENT_LENGTH },
            "Flashscore text below quality threshold; skipping DB update",
          );
          continue;
        }

        await this.prisma.match.update({
          where: { id: m.id },
          data: {
            rawContent: page.text,
            isScraped: true,
            isEmbedded: false,
            isAnalyzed: false,
          },
        });
        updated += 1;
      } catch (err) {
        log.error(
          { err, matchId: m.id, url: m.flashscoreUrl },
          "Failed to scrape Flashscore for match; continuing batch",
        );
      }
    }

    log.info({ attempted, updated }, "Flashscore scraping batch finished");
    return { attempted, updated };
  }
}
