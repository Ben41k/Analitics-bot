import { z } from 'zod';
import { CONFIDENCE_FACTOR_KEYS } from '../core/config';

const factorEntrySchema = z.object({
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1).max(2500),
});

const factorsRecordShape = Object.fromEntries(
  CONFIDENCE_FACTOR_KEYS.map((k) => [k, factorEntrySchema]),
) as Record<(typeof CONFIDENCE_FACTOR_KEYS)[number], typeof factorEntrySchema>;

/** F1–F10 для сохранения в БД (JSON на Match.analysisFactors). */
export const analysisFactorsSchema = z.object(factorsRecordShape);
export type AnalysisFactors = z.infer<typeof analysisFactorsSchema>;

/** Структурированный ответ Gemini: экспертные оценки по факторам + сравнительная уверенность модели. */
export const geminiStructuredAnalysisSchema = z.object({
  factors: analysisFactorsSchema,
  aiConfidence: z.number().min(0).max(100),
  outcome: z.enum(['1', 'X', '2']),
  summary: z.string().min(1).max(3500),
});

export type GeminiStructuredAnalysis = z.infer<typeof geminiStructuredAnalysisSchema>;
