import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),

  FOOTBALL_DATA_API_TOKEN: z.string().min(1).optional(),
  FOOTBALL_DATA_COMPETITION_IDS: z
    .string()
    .default("2021")
    .transform((s) => {
      const ids = s
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => Number.parseInt(id, 10))
        .filter((n) => !Number.isNaN(n));
      return ids.length > 0 ? ids : [2021];
    }),

  OPENAI_API_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().optional(),

  /** OpenRouter рекомендует Referer; только если задаёте — уйдёт в заголовок при запросах к openrouter.ai */
  OPENROUTER_HTTP_REFERER: z.string().url().optional(),
  OPENROUTER_APP_TITLE: z.string().max(128).optional(),

  PRIMARY_REASONING_MODEL: z.string().min(1).default("gpt-4o-mini"),
  LONG_CONTEXT_MODEL: z.string().min(1).default("gpt-4o-mini"),
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  /** Доп. модели embeddings через запятую (после EMBEDDING_MODEL). Пусто — в коде fallback openai/text-embedding-3-small для OpenRouter-стека */
  EMBEDDING_MODEL_FALLBACKS: z
    .string()
    .optional()
    .transform((s) => {
      if (s === undefined || s.trim() === "") {
        return [] as string[];
      }
      return s
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    }),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET_PATH: z.string().min(8).default("change-me-please"),

  ENABLE_CRON: z.preprocess((val: unknown) => {
    if (val === undefined || val === null || val === "") {
      return false;
    }
    if (typeof val === "boolean") {
      return val;
    }
    if (typeof val === "string") {
      const s = val.toLowerCase();
      return s === "true" || s === "1";
    }
    if (typeof val === "number") {
      return val === 1;
    }
    return false;
  }, z.boolean()),
  CRON_TZ: z.string().default("UTC"),

  SCRAPER_TAKE_LIMIT: z.coerce.number().int().positive().default(5),
  MIN_RAW_CONTENT_LENGTH: z.coerce.number().int().positive().default(150),
  SCRAPER_NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  FOOTBALL_SYNC_DAYS_AHEAD: z.coerce.number().int().nonnegative().default(14),
  FOOTBALL_SYNC_DAYS_PAST: z.coerce.number().int().nonnegative().default(7),

  RETENTION_DAYS: z.coerce.number().int().positive().default(120),

  TASK_TIMEOUT_MS_FOOTBALL_SYNC: z.coerce.number().int().positive().default(120_000),
  TASK_TIMEOUT_MS_FLASHSCORE_SCRAPE: z.coerce.number().int().positive().default(300_000),
  TASK_TIMEOUT_MS_EMBEDDING: z.coerce.number().int().positive().default(300_000),
  TASK_TIMEOUT_MS_ANALYZE: z.coerce.number().int().positive().default(600_000),
  TASK_TIMEOUT_MS_RETENTION: z.coerce.number().int().positive().default(60_000),

  RAG_TOP_K: z.coerce.number().int().positive().default(5),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(msg)}`);
  }
  return parsed.data;
}
