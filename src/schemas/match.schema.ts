import { z } from 'zod';

export const MatchSchema = z.object({
  externalId: z.string(),
  sport: z.enum(['football', 'hockey', 'basketball']),
  league: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  date: z.date(),
  odds: z.object({
    home: z.number().optional(),
    draw: z.number().optional(),
    away: z.number().optional(),
  }).optional(),
  rawContent: z.string().optional(),
});

// Ключевое слово export делает файл модулем
export type Match = z.infer<typeof MatchSchema>;