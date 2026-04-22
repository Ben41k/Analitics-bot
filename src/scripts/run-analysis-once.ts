/**
 * Однократный прогон оркестратора анализа (тот же код, что и у крона).
 * Не требует ENABLE_ANALYSIS_CRON — удобно для ручного/CI запуска.
 */
import { config } from '../core/config';
import prisma from '../core/database';
import { logger } from '../core/logger';
import { AnalyzerService } from '../modules/analyzer/analyzer.service';
import { RagService } from '../modules/rag/rag.service';
import { VectorService } from '../modules/rag/vector.service';
import { MatchAnalyticFlow } from '../pipeline/MatchAnalyticFlow';
import { runAnalysisJob } from '../tasks/analysis.task';

async function main(): Promise<void> {
  if (!config.GOOGLE_AI_API_KEY) {
    logger.error('Задай GOOGLE_AI_API_KEY в .env');
    process.exit(1);
  }

  const vectorService = new VectorService({
    GOOGLE_AI_API_KEY: config.GOOGLE_AI_API_KEY,
    GEMINI_EMBEDDING_MODEL: config.GEMINI_EMBEDDING_MODEL,
    GEMINI_API_BASE_URL: config.GEMINI_API_BASE_URL,
  });
  const rag = new RagService(prisma, vectorService);
  const flow = new MatchAnalyticFlow({
    prisma,
    rag,
    analyzer: new AnalyzerService(config),
  });

  await runAnalysisJob(flow);
  await prisma.$disconnect();
}

main().catch((e) => {
  logger.error(e, 'Ошибка однократного анализа');
  void prisma.$disconnect().finally(() => process.exit(1));
});
