import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { MatchAnalyticFlow } from "../pipeline/MatchAnalyticFlow.js";
import { runCronTask } from "./task-runner.js";

export async function runAnalyzeTask(params: {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
}): Promise<void> {
  const ttlMs = params.config.TASK_TIMEOUT_MS_ANALYZE + 30_000;
  await runCronTask({
    prisma: params.prisma,
    logger: params.logger,
    jobName: "analyze",
    ttlMs,
    timeoutMs: params.config.TASK_TIMEOUT_MS_ANALYZE,
    fn: async ({ jobId, signal }) => {
      const flow = MatchAnalyticFlow.create(params.prisma, params.config, params.logger);
      await flow.run({ jobId, signal, take: params.config.SCRAPER_TAKE_LIMIT });
    },
  });
}
