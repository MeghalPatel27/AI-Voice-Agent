-- AlterTable
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "responseRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "businessStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "deliveryAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "executionStartedAt" TIMESTAMP(3);
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "executionCompletedAt" TIMESTAMP(3);
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "responseSendStartedAt" TIMESTAMP(3);
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "responseAcceptedAt" TIMESTAMP(3);
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "responsePayload" JSONB;
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "errorCategory" TEXT;
ALTER TABLE "HumeToolCallReceipt" ADD COLUMN IF NOT EXISTS "lastDeliveryError" TEXT;

CREATE INDEX IF NOT EXISTS "HumeToolCallReceipt_deliveryStatus_idx" ON "HumeToolCallReceipt"("deliveryStatus");
CREATE INDEX IF NOT EXISTS "HumeToolCallReceipt_businessStatus_idx" ON "HumeToolCallReceipt"("businessStatus");

-- CreateTable
CREATE TABLE IF NOT EXISTS "HumeCallContextCache" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chatId" TEXT,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumeCallContextCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HumeCallContextCache_companyId_callId_key" ON "HumeCallContextCache"("companyId", "callId");
CREATE INDEX IF NOT EXISTS "HumeCallContextCache_chatId_idx" ON "HumeCallContextCache"("chatId");
CREATE INDEX IF NOT EXISTS "HumeCallContextCache_expiresAt_idx" ON "HumeCallContextCache"("expiresAt");
CREATE INDEX IF NOT EXISTS "HumeCallContextCache_companyId_idx" ON "HumeCallContextCache"("companyId");
