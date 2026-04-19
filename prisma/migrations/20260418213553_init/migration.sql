-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "User" (
    "id" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'football',
    "rawContent" TEXT NOT NULL,
    "embedding" vector(1536),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "result" TEXT NOT NULL,
    "prediction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Match_externalId_key" ON "Match"("externalId");

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
