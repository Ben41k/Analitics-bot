import { z } from 'zod';

/** Ответ модели при прогнозе (строгий JSON в теле ответа). */
export const llmAnalysisResponseSchema = z.object({
  outcome: z.enum(['1', 'X', '2']),
  confidence: z.number().min(0).max(100),
  summary: z.string().min(1).max(3500),
});

export type LlmAnalysisResponse = z.infer<typeof llmAnalysisResponseSchema>;
