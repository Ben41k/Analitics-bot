import { footballDataMatchesResponseSchema } from "../../schemas/match.schema.js";
import type { AppConfig } from "../../core/config.js";
import type { Logger } from "../../core/logger.js";

const BASE_URL = "https://api.football-data.org/v4";

export class FootballDataProvider {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async fetchMatchesForCompetition(params: {
    competitionId: number;
    dateFrom: string;
    dateTo: string;
    signal?: AbortSignal;
  }): Promise<ReturnType<typeof footballDataMatchesResponseSchema.parse>> {
    const token = this.config.FOOTBALL_DATA_API_TOKEN;
    if (!token) {
      throw new Error("FOOTBALL_DATA_API_TOKEN is not configured");
    }

    const url = new URL(`${BASE_URL}/competitions/${String(params.competitionId)}/matches`);
    url.searchParams.set("dateFrom", params.dateFrom);
    url.searchParams.set("dateTo", params.dateTo);

    const res = await fetch(url, {
      method: "GET",
      headers: { "X-Auth-Token": token },
      signal: params.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      this.logger.error(
        { status: res.status, competitionId: params.competitionId },
        "Football-Data API request failed",
      );
      throw new Error(
        `Football-Data API error ${String(res.status)} for competition ${String(params.competitionId)}: ${body.slice(0, 500)}`,
      );
    }

    // Boundary: response JSON is untrusted; narrow with Zod.
    const json: unknown = await res.json();
    const parsed = footballDataMatchesResponseSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.error(
        { issues: parsed.error.flatten() },
        "Football-Data response validation failed",
      );
      throw new Error("Football-Data response failed Zod validation");
    }
    return parsed.data;
  }
}
