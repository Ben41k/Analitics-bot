import cron from "node-cron";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { runFootballSyncTask } from "../tasks/football-sync.task.js";
import { runFlashscoreScrapeTask } from "../tasks/flashscore-scrape.task.js";
import { runEmbeddingTask } from "../tasks/embedding.task.js";
import { runAnalyzeTask } from "../tasks/analyze.task.js";
import { runRetentionTask } from "../tasks/retention.task.js";

export function registerSchedulers(params: {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
}): void {
  const { prisma, config, logger } = params;
  const tz = config.CRON_TZ;

  cron.schedule(
    "*/30 * * * *",
    () => {
      void runFootballSyncTask({ prisma, config, logger });
    },
    { timezone: tz },
  );

  cron.schedule(
    "*/10 * * * *",
    () => {
      void runFlashscoreScrapeTask({ prisma, config, logger });
    },
    { timezone: tz },
  );

  cron.schedule(
    "*/15 * * * *",
    () => {
      void runEmbeddingTask({ prisma, config, logger });
    },
    { timezone: tz },
  );

  cron.schedule(
    "*/20 * * * *",
    () => {
      void runAnalyzeTask({ prisma, config, logger });
    },
    { timezone: tz },
  );

  cron.schedule(
    "15 4 * * *",
    () => {
      void runRetentionTask({ prisma, config, logger });
    },
    { timezone: tz },
  );

  logger.info({ tz }, "Registered node-cron schedules");
}
