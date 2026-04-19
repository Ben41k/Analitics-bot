import { z } from 'zod';

// Это Zod-схема. Она нужна, чтобы ПРОВЕРЯТЬ данные в рантайме (когда бот работает)
export const MatchSchema = z.object({
  externalId: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  date: z.coerce.date(), // Автоматически превратит строку из API в объект Date
  league: z.string(),
  sport: z.enum(['football', 'hockey', 'basketball']),
  odds: z.object({
    homeWin: z.number().optional(),
    draw: z.number().optional(),
    awayWin: z.number().optional(),
  }).optional(),
  rawContent: z.string().optional(),
});

// А это тип для TypeScript. Он заменяет твой "interface ScrapedMatch"
// Теперь везде в коде ты будешь использовать тип Match
export type Match = z.infer<typeof MatchSchema>;