import { describe, expect, it } from "vitest";
import { matchAnalysisSchema } from "../../src/schemas/analysis.schema.js";

describe("matchAnalysisSchema", () => {
  it("accepts a valid analysis payload", () => {
    const parsed = matchAnalysisSchema.safeParse({
      factors: {
        f1_squad_losses: 5,
        f2_recent_form: 6,
        f3_h2h: 4,
        f4_home_away: 5,
        f5_motivation: 6,
        f6_schedule_density: 5,
        f7_tactical_fit: 5,
        f8_dressing_room: 4,
        f9_weather: 3,
        f10_line_movement: 4,
      },
      confidenceTotal: 52,
      summary: "Even matchup with moderate risks on both sides.",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects out-of-range factor scores", () => {
    const parsed = matchAnalysisSchema.safeParse({
      factors: {
        f1_squad_losses: 11,
        f2_recent_form: 0,
        f3_h2h: 0,
        f4_home_away: 0,
        f5_motivation: 0,
        f6_schedule_density: 0,
        f7_tactical_fit: 0,
        f8_dressing_room: 0,
        f9_weather: 0,
        f10_line_movement: 0,
      },
      confidenceTotal: 11,
      summary: "x",
    });
    expect(parsed.success).toBe(false);
  });
});
