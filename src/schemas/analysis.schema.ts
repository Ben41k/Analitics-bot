import { z } from "zod";

const factorScore = z.number().min(0).max(10).describe("Score 0-10 for the analytical factor");

export const matchAnalysisSchema = z.object({
  factors: z.object({
    f1_squad_losses: factorScore,
    f2_recent_form: factorScore,
    f3_h2h: factorScore,
    f4_home_away: factorScore,
    f5_motivation: factorScore,
    f6_schedule_density: factorScore,
    f7_tactical_fit: factorScore,
    f8_dressing_room: factorScore,
    f9_weather: factorScore,
    f10_line_movement: factorScore,
  }),
  /** Sum of F1..F10 (0-100) */
  confidenceTotal: z.number().min(0).max(100),
  summary: z.string().min(1).max(4000),
  notes: z.string().max(8000).optional(),
});

export type MatchAnalysis = z.infer<typeof matchAnalysisSchema>;
