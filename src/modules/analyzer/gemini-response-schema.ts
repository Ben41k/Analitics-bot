import { SchemaType, type ObjectSchema } from '@google/generative-ai';
import { CONFIDENCE_FACTOR_KEYS } from '../../core/config';

const factorPropertySchema: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    score: { type: SchemaType.NUMBER, description: 'Оценка надёжности сигнала по фактору, 0–100' },
    reasoning: { type: SchemaType.STRING, description: 'Краткое обоснование на русском' },
  },
  required: ['score', 'reasoning'],
};

const factorsProperties = Object.fromEntries(
  CONFIDENCE_FACTOR_KEYS.map((k) => [k, factorPropertySchema]),
) as Record<(typeof CONFIDENCE_FACTOR_KEYS)[number], ObjectSchema>;

/** Schema-guided JSON для Gemini (application/json). */
export const geminiAnalysisResponseSchema: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    factors: {
      type: SchemaType.OBJECT,
      properties: factorsProperties,
      required: [...CONFIDENCE_FACTOR_KEYS],
    },
    aiConfidence: {
      type: SchemaType.NUMBER,
      description: 'Субъективная уверенность модели в прогнозе целиком, 0–100 (для сравнения с взвешенным скором)',
    },
    outcome: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['1', 'X', '2'],
      description: 'Прогноз на 90 мин: 1 — хозяева, X — ничья, 2 — гости',
    },
    summary: {
      type: SchemaType.STRING,
      description: 'Краткий разбор на русском, 3–8 предложений',
    },
  },
  required: ['factors', 'aiConfidence', 'outcome', 'summary'],
};
