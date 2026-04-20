import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { ScraperService } from "../modules/scraper/scraper.service.js";
import { runCronTask } from "./task-runner.js";

export async function runFlashscoreScrapeTask(params: {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
}): Promise<void> {
  const ttlMs = params.config.TASK_TIMEOUT_MS_FLASHSCORE_SCRAPE + 30_000;
  await runCronTask({
    prisma: params.prisma,
    logger: params.logger,
    jobName: "flashscore_scrape",
    ttlMs,
    timeoutMs: params.config.TASK_TIMEOUT_MS_FLASHSCORE_SCRAPE,
    fn: async ({ jobId, signal }) => {
      const svc = ScraperService.create(params.prisma, params.config, params.logger);
      await svc.scrapeQueuedMatches({ jobId, signal });
    },
  });
}
