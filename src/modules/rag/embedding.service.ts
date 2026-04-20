import { z } from "zod";
import type { AppConfig } from "../../core/config.js";
import type { Logger } from "../../core/logger.js";

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
    }),
  ),
});

export class EmbeddingService {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async embedText(params: {
    text: string;
    jobId: string;
    signal?: AbortSignal;
  }): Promise<number[]> {
    const log = this.logger.child({ jobId: params.jobId, module: "EmbeddingService" });
    const apiKey = this.config.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const base = this.config.OPENAI_API_BASE_URL.replace(/\/+$/, "");
    const url = `${base}/embeddings`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.EMBEDDING_MODEL,
        input: params.text,
      }),
      signal: params.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error({ status: res.status }, "Embedding API request failed");
      throw new Error(`Embedding API error ${String(res.status)}: ${body.slice(0, 500)}`);
    }

    // Boundary: embedding JSON is untrusted; narrow with Zod.
    const json: unknown = await res.json();
    const parsed = embeddingResponseSchema.safeParse(json);
    if (!parsed.success) {
      log.error({ issues: parsed.error.flatten() }, "Embedding response validation failed");
      throw new Error("Embedding response failed Zod validation");
    }

    const embedding = parsed.data.data[0]?.embedding;
    if (!embedding) {
      throw new Error("Embedding response missing embedding vector");
    }

    if (embedding.length !== this.config.EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimensions mismatch: got ${String(embedding.length)}, expected ${String(this.config.EMBEDDING_DIMENSIONS)}`,
      );
    }

    return embedding;
  }
}
