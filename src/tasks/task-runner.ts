import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../core/logger.js";
import { acquireCronLock, releaseCronLock } from "../lib/cron-lock.js";
import { withTimeout } from "../lib/timeout.js";

export async function runCronTask<T>(params: {
  prisma: PrismaClient;
  logger: Logger;
  jobName: string;
  ttlMs: number;
  timeoutMs: number;
  fn: (ctx: { jobId: string; signal: AbortSignal }) => Promise<T>;
}): Promise<void> {
  const jobId = randomUUID();
  const ownerId = `${params.jobName}:${jobId}`;
  const log = params.logger.child({ jobId, jobName: params.jobName });

  const acquired = await acquireCronLock({
    prisma: params.prisma,
    jobName: params.jobName,
    ownerId,
    ttlMs: params.ttlMs,
  });

  if (!acquired) {
    log.warn("Cron task skipped; lock not acquired");
    return;
  }

  const controller = new AbortController();
  try {
    await withTimeout(
      params.fn({ jobId, signal: controller.signal }),
      params.timeoutMs,
      controller.signal,
    );
    log.info("Cron task succeeded");
  } catch (err) {
    log.error({ err }, "Cron task failed");
  } finally {
    await releaseCronLock({
      prisma: params.prisma,
      jobName: params.jobName,
      ownerId,
    });
  }
}
