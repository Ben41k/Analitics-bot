import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../core/config.js";
import type { Logger } from "../../core/logger.js";

export class RetentionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  static create(prisma: PrismaClient, config: AppConfig, logger: Logger): RetentionService {
    return new RetentionService(prisma, config, logger);
  }

  async archiveOldMatches(params: { jobId: string }): Promise<{ archived: number }> {
    const log = this.logger.child({ jobId: params.jobId, module: "RetentionService" });
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - this.config.RETENTION_DAYS);

    const res = await this.prisma.match.updateMany({
      where: {
        archivedAt: null,
        kickoffUtc: { lt: cutoff },
      },
      data: { archivedAt: new Date() },
    });

    log.info({ archived: res.count, cutoff: cutoff.toISOString() }, "Retention archival completed");
    return { archived: res.count };
  }
}
