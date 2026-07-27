-- Additive post-call analysis support for demo voice calls.
-- Preserves existing Call rows; historical calls may have no analysis record.

CREATE TYPE "CallPostAnalysisStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'INSUFFICIENT_DATA'
);

CREATE TYPE "CallIntentLevel" AS ENUM (
  'VERY_HIGH',
  'HIGH',
  'MEDIUM',
  'LOW',
  'NOT_INTERESTED',
  'UNKNOWN'
);

ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "endReason" TEXT;

CREATE TABLE "CallPostAnalysis" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "status" "CallPostAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  "intentLevel" "CallIntentLevel",
  "intentScore" INTEGER,
  "confidence" DOUBLE PRECISION,
  "requirementSummary" TEXT,
  "requirementDetails" JSONB,
  "evidenceSignals" JSONB,
  "promptVersion" TEXT,
  "modelName" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "processingStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "truncatedTranscript" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallPostAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallPostAnalysis_callId_key" ON "CallPostAnalysis"("callId");
CREATE INDEX "CallPostAnalysis_companyId_idx" ON "CallPostAnalysis"("companyId");
CREATE INDEX "CallPostAnalysis_status_nextAttemptAt_idx" ON "CallPostAnalysis"("status", "nextAttemptAt");
CREATE INDEX "CallPostAnalysis_status_processingStartedAt_idx" ON "CallPostAnalysis"("status", "processingStartedAt");
CREATE INDEX "CallPostAnalysis_createdAt_idx" ON "CallPostAnalysis"("createdAt");

ALTER TABLE "CallPostAnalysis"
  ADD CONSTRAINT "CallPostAnalysis_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallPostAnalysis"
  ADD CONSTRAINT "CallPostAnalysis_callId_fkey"
  FOREIGN KEY ("callId") REFERENCES "Call"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
