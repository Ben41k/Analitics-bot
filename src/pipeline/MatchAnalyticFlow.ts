import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { VectorService } from "../modules/rag/vector.service.js";
import { AnalyzerService } from "../modules/analyzer/analyzer.service.js";

/**
 * RAG + LLM analysis for matches that are already embedded.
 * Embedding is handled separately (see `embedding.task.ts`) to keep cron stages isolated.
 */
export class MatchAnalyticFlow {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly vectors: VectorService,
    private readonly analyzer: AnalyzerService,
  ) {}

  static create(prisma: PrismaClient, config: AppConfig, logger: Logger): MatchAnalyticFlow {
    return new MatchAnalyticFlow(
      prisma,
      config,
      logger,
      VectorService.create(prisma, config, logger),
      new AnalyzerService(config, logger),
    );
  }

  async run(params: { jobId: string; signal?: AbortSignal; take?: number }): Promise<{
    attempted: number;
    analyzed: number;
  }> {
    const log = this.logger.child({ jobId: params.jobId, module: "MatchAnalyticFlow" });
    const take = params.take ?? 5;

    const matches = await this.prisma.match.findMany({
      where: {
        archivedAt: null,
        rawContent: { not: null },
        isEmbedded: true,
        isAnalyzed: false,
      },
      orderBy: { kickoffUtc: "asc" },
      take,
    });

    let attempted = 0;
    let analyzed = 0;

    for (const m of matches) {
      if (!m.rawContent) {
        continue;
      }
      attempted += 1;

      try {
        const embedding = await this.vectors.getMatchEmbedding({
          matchId: m.id,
          jobId: params.jobId,
        });

        const neighbors = await this.vectors.findSimilarMatches({
          matchId: m.id,
          embedding,
          jobId: params.jobId,
          topK: this.config.RAG_TOP_K,
        });

        const ragContext = neighbors
          .map((n) => n.rawContent)
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.slice(0, 4000));

        const analysis = await this.analyzer.analyzeMatch({
          jobId: params.jobId,
          matchId: m.id,
          homeTeamName: m.homeTeamName,
          awayTeamName: m.awayTeamName,
          kickoffUtcIso: m.kickoffUtc.toISOString(),
          primaryText: m.rawContent,
          ragContext,
          signal: params.signal,
        });

        await this.prisma.match.update({
          where: { id: m.id },
          data: {
            analysis,
            isAnalyzed: true,
          },
        });

        analyzed += 1;
      } catch (err) {
        log.error({ err, matchId: m.id }, "MatchAnalyticFlow failed for match; continuing batch");
      }
    }

    log.info({ attempted, analyzed }, "MatchAnalyticFlow batch finished");
    return { attempted, analyzed };
  }
}
