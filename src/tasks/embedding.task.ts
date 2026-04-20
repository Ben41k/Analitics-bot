import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { EmbeddingService } from "../modules/rag/embedding.service.js";
import { VectorService } from "../modules/rag/vector.service.js";
import { runCronTask } from "./task-runner.js";

export async function runEmbeddingTask(params: {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
}): Promise<void> {
  const ttlMs = params.config.TASK_TIMEOUT_MS_EMBEDDING + 30_000;
  await runCronTask({
    prisma: params.prisma,
    logger: params.logger,
    jobName: "embedding",
    ttlMs,
    timeoutMs: params.config.TASK_TIMEOUT_MS_EMBEDDING,
    fn: async ({ jobId, signal }) => {
      const embeddings = new EmbeddingService(params.config, params.logger);
      const vectors = VectorService.create(params.prisma, params.config, params.logger);

      const matches = await params.prisma.match.findMany({
        where: {
          archivedAt: null,
          rawContent: { not: null },
          isEmbedded: false,
        },
        orderBy: { kickoffUtc: "asc" },
        take: params.config.SCRAPER_TAKE_LIMIT,
      });

      for (const m of matches) {
        if (!m.rawContent) {
          continue;
        }
        try {
          const embedding = await embeddings.embedText({
            text: m.rawContent,
            jobId,
            signal,
          });
          await vectors.saveMatchEmbedding({ matchId: m.id, embedding, jobId });
        } catch (err) {
          params.logger
            .child({ jobId })
            .error({ err, matchId: m.id }, "Embedding failed for match; continuing");
        }
      }
    },
  });
}
