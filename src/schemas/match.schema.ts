import { z } from "zod";

/** Football-Data.org v4 — minimal match payload for sync */
export const footballDataTeamSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
});

export const footballDataCompetitionSchema = z.object({
  id: z.number().optional(),
  name: z.string().optional(),
});

export const footballDataMatchSchema = z.object({
  id: z.number(),
  utcDate: z.string(),
  status: z.string(),
  homeTeam: footballDataTeamSchema,
  awayTeam: footballDataTeamSchema,
  competition: footballDataCompetitionSchema.optional(),
  season: z.unknown().optional(),
});

export const footballDataMatchesResponseSchema = z.object({
  count: z.number().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  resultSet: z.record(z.string(), z.unknown()).optional(),
  matches: z.array(footballDataMatchSchema),
});

export type FootballDataMatch = z.infer<typeof footballDataMatchSchema>;
export type FootballDataMatchesResponse = z.infer<typeof footballDataMatchesResponseSchema>;
