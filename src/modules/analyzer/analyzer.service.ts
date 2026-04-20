import { z } from "zod";
import { matchAnalysisSchema, type MatchAnalysis } from "../../schemas/analysis.schema.js";
import { matchAnalysisSystemPrompt } from "./prompts/match-analysis.system.js";
import type { AppConfig } from "../../core/config.js";
import type { Logger } from "../../core/logger.js";

const chatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ),
});

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export class AnalyzerService {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async analyzeMatch(params: {
    jobId: string;
    matchId: string;
    homeTeamName: string;
    awayTeamName: string;
    kickoffUtcIso: string;
    primaryText: string;
    ragContext: string[];
    signal?: AbortSignal;
  }): Promise<MatchAnalysis> {
    const log = this.logger.child({
      jobId: params.jobId,
      module: "AnalyzerService",
      matchId: params.matchId,
    });
    const apiKey = this.config.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const base = this.config.OPENAI_API_BASE_URL.replace(/\/+$/, "");
    const url = `${base}/chat/completions`;

    const userPayload = {
      match: {
        id: params.matchId,
        homeTeam: params.homeTeamName,
        awayTeam: params.awayTeamName,
        kickoffUtc: params.kickoffUtcIso,
      },
      primaryText: params.primaryText,
      ragSnippets: params.ragContext,
    };

    const modelsToTry = [
      this.config.PRIMARY_REASONING_MODEL,
      this.config.LONG_CONTEXT_MODEL,
    ].filter((m, idx, arr) => arr.indexOf(m) === idx);

    let lastErr: unknown;
    for (const model of modelsToTry) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              temperature: 0.2,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: matchAnalysisSystemPrompt },
                {
                  role: "user",
                  content: JSON.stringify(userPayload),
                },
              ],
            }),
            signal: params.signal,
          });

          if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`LLM HTTP ${String(res.status)}: ${body.slice(0, 800)}`);
          }

          // Boundary: LLM JSON is untrusted; narrow with Zod.
          const json: unknown = await res.json();
          const completion = chatCompletionSchema.safeParse(json);
          if (!completion.success) {
            throw new Error("LLM completion failed Zod validation");
          }

          const content = completion.data.choices[0]?.message.content;
          if (!content) {
            throw new Error("LLM completion missing message content");
          }

          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(content) as unknown;
          } catch {
            throw new Error("LLM completion content was not valid JSON");
          }
          const analysis = matchAnalysisSchema.safeParse(parsedJson);
          if (!analysis.success) {
            log.warn(
              { issues: analysis.error.flatten(), model },
              "LLM analysis JSON failed schema validation",
            );
            throw new Error("LLM analysis JSON failed schema validation");
          }

          log.info({ model }, "Match analysis completed");
          return analysis.data;
        } catch (err) {
          lastErr = err;
          const backoffMs = 400 * 2 ** attempt + Math.floor(Math.random() * 250);
          log.warn({ err, attempt, model }, "Analyzer attempt failed; retrying with backoff");
          await sleep(backoffMs);
        }
      }
    }

    log.error({ err: lastErr }, "Analyzer failed after retries and fallbacks");
    throw lastErr instanceof Error ? lastErr : new Error("Analyzer failed");
  }
}
