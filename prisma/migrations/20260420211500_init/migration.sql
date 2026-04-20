-- Enable pgvector (required for embedding column)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "footballDataId" INTEGER NOT NULL,
    "homeTeamName" TEXT NOT NULL,
    "awayTeamName" TEXT NOT NULL,
    "kickoffUtc" TIMESTAMP(3) NOT NULL,
    "status" "MatchStatus" NOT NULL,
    "competitionId" INTEGER,
    "competitionName" TEXT,
    "seasonYear" INTEGER,
    "flashscoreUrl" TEXT,
    "rawContent" TEXT,
    "analysis" JSONB,
    "embedding" vector(1536),
    "isScraped" BOOLEAN NOT NULL DEFAULT false,
    "isEmbedded" BOOLEAN NOT NULL DEFAULT false,
    "isAnalyzed" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronJobLock" (
    "jobName" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronJobLock_pkey" PRIMARY KEY ("jobName")
);

-- CreateIndex
CREATE UNIQUE INDEX "Match_footballDataId_key" ON "Match"("footballDataId");

-- CreateIndex
CREATE INDEX "Match_kickoffUtc_idx" ON "Match"("kickoffUtc");

-- CreateIndex
CREATE INDEX "Match_status_isAnalyzed_archivedAt_idx" ON "Match"("status", "isAnalyzed", "archivedAt");
