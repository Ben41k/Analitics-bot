-- Автономный анализ: структура на Match; таблица Analysis больше не используется.
DROP TABLE IF EXISTS "Analysis";

ALTER TABLE "Match" ADD COLUMN "analyzedAt" TIMESTAMP(3);
ALTER TABLE "Match" ADD COLUMN "analysisPrediction" VARCHAR(1);
ALTER TABLE "Match" ADD COLUMN "analysisSummary" TEXT;
ALTER TABLE "Match" ADD COLUMN "analysisFinalConfidence" INTEGER;
ALTER TABLE "Match" ADD COLUMN "analysisAiConfidence" INTEGER;
ALTER TABLE "Match" ADD COLUMN "analysisFactors" JSONB;

CREATE INDEX "Match_analyzedAt_idx" ON "Match" ("analyzedAt");
