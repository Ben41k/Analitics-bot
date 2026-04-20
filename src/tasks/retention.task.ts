import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { RetentionService } from "../modules/retention/retention.service.js";
import { runCronTask } from "./task-runner.js";

export async function runRetentionTask(params: {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
}): Promise<void> {
  const ttlMs = params.config.TASK_TIMEOUT_MS_RETENTION + 30_000;
  await runCronTask({
    prisma: params.prisma,
    logger: params.logger,
    jobName: "retention",
    ttlMs,
    timeoutMs: params.config.TASK_TIMEOUT_MS_RETENTION,
    fn: async ({ jobId }) => {
      const svc = RetentionService.create(params.prisma, params.config, params.logger);
      await svc.archiveOldMatches({ jobId });
    },
  });
}
