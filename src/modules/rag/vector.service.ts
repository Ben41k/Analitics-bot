import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../core/config.js";
import type { Logger } from "../../core/logger.js";

export interface SimilarMatch {
  id: string;
  distance: number;
  rawContent: string | null;
}

export class VectorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  static create(prisma: PrismaClient, config: AppConfig, logger: Logger): VectorService {
    return new VectorService(prisma, config, logger);
  }

  async getMatchEmbedding(params: { matchId: string; jobId: string }): Promise<number[]> {
    const log = this.logger.child({ jobId: params.jobId, module: "VectorService" });
    const rows = await this.prisma.$queryRaw<{ embeddingText: string | null }[]>(
      Prisma.sql`
        SELECT m.embedding::text AS "embeddingText"
        FROM "Match" m
        WHERE m.id = ${params.matchId}::uuid
        LIMIT 1
      `,
    );

    const text = rows[0]?.embeddingText;
    if (!text) {
      throw new Error("Missing embedding vector for match");
    }

    const parsed = parsePgVectorText(text);
    if (parsed.length !== this.config.EMBEDDING_DIMENSIONS) {
      throw new Error("Stored embedding dimensions mismatch");
    }

    log.info({ matchId: params.matchId }, "Loaded match embedding from database");
    return parsed;
  }

  async saveMatchEmbedding(params: {
    matchId: string;
    embedding: number[];
    jobId: string;
  }): Promise<void> {
    const log = this.logger.child({ jobId: params.jobId, module: "VectorService" });
    if (params.embedding.length !== this.config.EMBEDDING_DIMENSIONS) {
      throw new Error("Embedding vector length does not match configured dimensions");
    }

    const vectorLiteral = `[${params.embedding.map((n) => n.toFixed(8)).join(",")}]`;

    await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE "Match"
        SET embedding = ${vectorLiteral}::vector,
            "isEmbedded" = true,
            "updatedAt" = now()
        WHERE id = ${params.matchId}::uuid
      `,
    );

    log.info({ matchId: params.matchId }, "Saved match embedding");
  }

  async findSimilarMatches(params: {
    matchId: string;
    embedding: number[];
    jobId: string;
    topK?: number;
  }): Promise<SimilarMatch[]> {
    const log = this.logger.child({ jobId: params.jobId, module: "VectorService" });
    const topK = params.topK ?? this.config.RAG_TOP_K;

    const vectorLiteral = `[${params.embedding.map((n) => n.toFixed(8)).join(",")}]`;

    const rows = await this.prisma.$queryRaw<SimilarMatch[]>(
      Prisma.sql`
        SELECT
          m.id AS id,
          (m.embedding <=> ${vectorLiteral}::vector)::float8 AS distance,
          m."rawContent" AS "rawContent"
        FROM "Match" m
        WHERE m.id <> ${params.matchId}::uuid
          AND m.embedding IS NOT NULL
          AND m."archivedAt" IS NULL
          AND m."rawContent" IS NOT NULL
        ORDER BY m.embedding <=> ${vectorLiteral}::vector
        LIMIT ${topK}
      `,
    );

    log.info(
      { matchId: params.matchId, neighbors: rows.length },
      "Vector similarity search completed",
    );
    return rows;
  }
}

function parsePgVectorText(text: string): number[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const arr: unknown = JSON.parse(trimmed);
    if (!Array.isArray(arr) || !arr.every((n) => typeof n === "number")) {
      throw new Error("Unexpected embedding JSON shape");
    }
    return arr;
  }

  // Fallback for some pgvector text representations: "(1,2,3)"
  const inner = trimmed.replace(/^\(/, "").replace(/\)$/, "");
  if (inner.length === 0) {
    return [];
  }
  return inner.split(",").map((p) => Number.parseFloat(p.trim()));
}
