import type { Match } from '@prisma/client';
import type { LlmClient } from '../../core/llm.client';
import { llmAnalysisResponseSchema } from '../../schemas/analysis.schema';

export type MatchForAnalysis = Pick<
  Match,
  'id' | 'homeTeam' | 'awayTeam' | 'league' | 'date' | 'sport' | 'rawContent'
>;

export type AnalysisOutcome = {
  outcome: '1' | 'X' | '2';
  confidence: number;
  summary: string;
};

const MAX_PREVIEW_CHARS = 12_000;

function stripCodeFence(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(t);
  return m ? m[1].trim() : t;
}

function parseLlmJson(raw: string): unknown {
  return JSON.parse(stripCodeFence(raw)) as unknown;
}

export class AnalyzerService {
  constructor(private readonly llm: LlmClient) {}

  async analyzeMatch(match: MatchForAnalysis): Promise<AnalysisOutcome> {
    const preview =
      match.rawContent && match.rawContent !== 'No preview available'
        ? match.rawContent.slice(0, MAX_PREVIEW_CHARS)
        : null;

    const matchBlock = [
      `Матч: ${match.homeTeam} — ${match.awayTeam}`,
      `Лига: ${match.league}`,
      `Спорт: ${match.sport}`,
      `Дата (UTC): ${match.date.toISOString()}`,
      preview ? `\nПревью / контекст:\n${preview}` : '\nПревью недоступно — опирайся на общие знания о силах команд и форме, явно укажи нехватку данных.',
    ].join('\n');

    const system = `Ты спортивный аналитик. По данным матча дай прогноз исхода на 90 минут (без учёта пенальти после матча).
Верни ТОЛЬКО валидный JSON без пояснений до или после, одним объектом:
{"outcome":"1"|"X"|"2","confidence":число0до100,"summary":"краткий разбор на русском, 3-8 предложений"}
Где outcome: "1" — победа хозяев, "X" — ничья, "2" — победа гостей.
confidence — твоя субъективная уверенность в прогнозе в процентах (целое или дробное).`;

    const raw = await this.llm.chatCompletion({
      modelRole: preview && preview.length > 4000 ? 'longContext' : 'primary',
      temperature: 0.35,
      maxTokens: 900,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: matchBlock },
      ],
    });

    const parsed = llmAnalysisResponseSchema.safeParse(parseLlmJson(raw));
    if (!parsed.success) {
      throw new Error(`Модель вернула неверный JSON: ${parsed.error.message}`);
    }

    return parsed.data;
  }
}
