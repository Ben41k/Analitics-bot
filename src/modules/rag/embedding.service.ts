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

/** Если в .env не задан список — пробуем OpenAI-совместимую модель на том же OpenRouter-ключе. */
const DEFAULT_EMBEDDING_FALLBACKS = ["openai/text-embedding-3-small"] as const;

export class EmbeddingService {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  private embeddingModelChain(): string[] {
    const fromEnv = this.config.EMBEDDING_MODEL_FALLBACKS;
    const fallbacks = fromEnv.length > 0 ? fromEnv : [...DEFAULT_EMBEDDING_FALLBACKS];
    const chain = [this.config.EMBEDDING_MODEL, ...fallbacks];
    return [...new Set(chain)];
  }

  private embeddingRequestHeaders(): Record<string, string> {
    const base = this.config.OPENAI_API_BASE_URL.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.OPENAI_API_KEY ?? ""}`,
      "Content-Type": "application/json",
    };
    if (base.includes("openrouter.ai")) {
      if (this.config.OPENROUTER_HTTP_REFERER) {
        headers["HTTP-Referer"] = this.config.OPENROUTER_HTTP_REFERER;
      }
      if (this.config.OPENROUTER_APP_TITLE) {
        headers["X-Title"] = this.config.OPENROUTER_APP_TITLE;
      }
    }
    return headers;
  }

  private async fetchEmbeddingForModel(params: {
    text: string;
    jobId: string;
    model: string;
    signal?: AbortSignal;
  }): Promise<number[]> {
    const log = this.logger.child({
      jobId: params.jobId,
      module: "EmbeddingService",
      model: params.model,
    });
    const apiKey = this.config.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const base = this.config.OPENAI_API_BASE_URL.replace(/\/+$/, "");
    const url = `${base}/embeddings`;

    const res = await fetch(url, {
      method: "POST",
      headers: this.embeddingRequestHeaders(),
      body: JSON.stringify({
        model: params.model,
        input: params.text,
        dimensions: this.config.EMBEDDING_DIMENSIONS,
      }),
      signal: params.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error({ status: res.status }, "Embedding API request failed");
      throw new Error(`Embedding API error ${String(res.status)}: ${body.slice(0, 500)}`);
    }

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

  async embedText(params: {
    text: string;
    jobId: string;
    signal?: AbortSignal;
  }): Promise<number[]> {
    const log = this.logger.child({ jobId: params.jobId, module: "EmbeddingService" });
    const models = this.embeddingModelChain();
    let lastErr: unknown;

    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      if (!model) {
        continue;
      }
      try {
        const vec = await this.fetchEmbeddingForModel({
          text: params.text,
          jobId: params.jobId,
          model,
          signal: params.signal,
        });
        if (i > 0) {
          log.info({ model, index: i }, "Embedding succeeded after fallback model");
        }
        return vec;
      } catch (err: unknown) {
        lastErr = err;
        const hasNext = i < models.length - 1;
        if (hasNext) {
          log.warn(
            { err, model, nextModel: models[i + 1] },
            "Embedding model failed; trying fallback",
          );
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error("All embedding models failed");
  }
}
