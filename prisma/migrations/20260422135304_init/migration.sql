-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "MatchInternalStatus" AS ENUM ('PENDING', 'SCRAPED', 'ANALYZED');

-- CreateTable
CREATE TABLE "User" (
    "id" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT NOT NULL,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'football',
    "internalStatus" "MatchInternalStatus" NOT NULL DEFAULT 'PENDING',
    "rawContent" TEXT,
    "embedding" vector(768),
    "confidenceStatus" VARCHAR(32),
    "analyzedAt" TIMESTAMP(3),
    "analysisPrediction" VARCHAR(1),
    "analysisSummary" TEXT,
    "analysisFinalConfidence" INTEGER,
    "analysisAiConfidence" INTEGER,
    "analysisFactors" JSONB,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Match_externalId_key" ON "Match"("externalId");
