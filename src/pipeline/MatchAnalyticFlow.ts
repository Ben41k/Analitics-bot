import type { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../core/logger';

const LLM_AFTER_RAG_COOLDOWN_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
import { AnalyzerService, type MatchForAnalysis } from '../modules/analyzer/analyzer.service';
import { RagService } from '../modules/rag/rag.service';
import { analysisFactorsSchema, type GeminiStructuredAnalysis } from '../schemas/analysis.schema';

export type MatchAnalyticFlowResult = {
  outcome: '1' | 'X' | '2';
  summary: string;
  finalConfidence: number;
  aiConfidence: number;
  confidenceStatus: string | null;
};

export type MatchAnalyticFlowDeps = {
  prisma: PrismaClient;
  rag: RagService;
  analyzer: AnalyzerService;
};

/**
 * Сбор данных → RAG → Gemini (структурированный JSON) → взвешенный скор → поля Match.
 */
export class MatchAnalyticFlow {
  constructor(private readonly deps: MatchAnalyticFlowDeps) {}

  /**
   * Полный цикл для фонового задания: без пользователя Telegram, результат только в Match.
   */
  async runForMatch(match: MatchForAnalysis): Promise<MatchAnalyticFlowResult> {
    const { prisma, rag, analyzer } = this.deps;

    logger.info({ matchId: match.id, stage: 'pipeline_start' }, 'Pipeline: старт анализа матча');

    const ragContext = await rag.buildContextForMatch(match);
    logger.info({ matchId: match.id, stage: 'rag_complete' }, 'Pipeline: этап RAG завершён');

    logger.info(
      { matchId: match.id, stage: 'pipeline_cooldown', ms: LLM_AFTER_RAG_COOLDOWN_MS },
      'Pipeline: пауза перед LLM после RAG/эмбеддинга (снижение 429)',
    );
    await sleep(LLM_AFTER_RAG_COOLDOWN_MS);

    const structured = await analyzer.generateAnalysis(match, ragContext);
    logger.info({ matchId: match.id, stage: 'llm_structured_ok' }, 'Pipeline: структурированный ответ получен');

    const finalConfidence = analyzer.calculateFinalScore(structured.factors);
    const confidenceStatus = finalConfidence > 75 ? 'High Confidence' : null;

    logger.info(
      {
        matchId: match.id,
        stage: 'confidence_computed',
        finalConfidence,
        aiConfidence: structured.aiConfidence,
        confidenceStatus: confidenceStatus ?? 'standard',
      },
      'Pipeline: итоговая уверенность рассчитана',
    );

    analysisFactorsSchema.parse(structured.factors);

    await this.persistMatchAnalysis(prisma, match.id, structured, finalConfidence, confidenceStatus);

    logger.info({ matchId: match.id, stage: 'persisted' }, 'Pipeline: анализ сохранён в Match');

    return {
      outcome: structured.outcome,
      summary: structured.summary,
      finalConfidence,
      aiConfidence: structured.aiConfidence,
      confidenceStatus,
    };
  }

  private async persistMatchAnalysis(
    prisma: PrismaClient,
    matchId: string,
    structured: GeminiStructuredAnalysis,
    finalConfidence: number,
    confidenceStatus: string | null,
  ): Promise<void> {
    const factorsJson = structured.factors as unknown as Prisma.InputJsonValue;

    await prisma.match.update({
      where: { id: matchId },
      data: {
        analyzedAt: new Date(),
        analysisPrediction: structured.outcome,
        analysisSummary: structured.summary,
        analysisFinalConfidence: Math.min(100, Math.max(0, Math.round(finalConfidence))),
        analysisAiConfidence: Math.min(100, Math.max(0, Math.round(structured.aiConfidence))),
        analysisFactors: factorsJson,
        confidenceStatus,
      },
    });
  }
}
