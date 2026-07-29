-- CreateEnum
CREATE TYPE "CallTerminationReason" AS ENUM ('MEETING_SCHEDULED');

-- CreateEnum
CREATE TYPE "CallTerminationSource" AS ENUM ('HUME_MEETING_TOOL', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "CallTerminationIntentState" AS ENUM ('ARMED', 'SATISFIED', 'CANCELED', 'FAILED');

-- CreateTable
CREATE TABLE "CallTerminationIntent" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "bookingId" TEXT,
    "toolCallId" TEXT,
    "reason" "CallTerminationReason" NOT NULL,
    "source" "CallTerminationSource" NOT NULL,
    "state" "CallTerminationIntentState" NOT NULL DEFAULT 'ARMED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graceDeadlineAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastProviderState" TEXT,
    "lastErrorCategory" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallTerminationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallTerminationIntent_callId_reason_key" ON "CallTerminationIntent"("callId", "reason");

-- CreateIndex
CREATE INDEX "CallTerminationIntent_state_graceDeadlineAt_idx" ON "CallTerminationIntent"("state", "graceDeadlineAt");

-- CreateIndex
CREATE INDEX "CallTerminationIntent_toolCallId_idx" ON "CallTerminationIntent"("toolCallId");

-- CreateIndex
CREATE INDEX "CallTerminationIntent_bookingId_idx" ON "CallTerminationIntent"("bookingId");

-- CreateIndex
CREATE INDEX "CallTerminationIntent_requestedAt_idx" ON "CallTerminationIntent"("requestedAt");

-- AddForeignKey
ALTER TABLE "CallTerminationIntent" ADD CONSTRAINT "CallTerminationIntent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallTerminationIntent" ADD CONSTRAINT "CallTerminationIntent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
