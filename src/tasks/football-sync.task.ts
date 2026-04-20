import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { MatchSyncService } from "../modules/football-data/match-sync.service.js";
import { runCronTask } from "./task-runner.js";

export async function runFootballSyncTask(params: {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
}): Promise<void> {
  const ttlMs = params.config.TASK_TIMEOUT_MS_FOOTBALL_SYNC + 30_000;
  await runCronTask({
    prisma: params.prisma,
    logger: params.logger,
    jobName: "football_sync",
    ttlMs,
    timeoutMs: params.config.TASK_TIMEOUT_MS_FOOTBALL_SYNC,
    fn: async ({ jobId, signal }) => {
      const svc = MatchSyncService.create(params.prisma, params.config, params.logger);
      await svc.syncMatches({ jobId, signal });
    },
  });
}
