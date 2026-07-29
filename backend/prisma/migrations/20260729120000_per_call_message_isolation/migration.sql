-- Per-call transcript message isolation: optional callId on Message.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "callId" TEXT;

CREATE INDEX IF NOT EXISTS "Message_callId_idx" ON "Message"("callId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Message_callId_fkey'
  ) THEN
    ALTER TABLE "Message"
      ADD CONSTRAINT "Message_callId_fkey"
      FOREIGN KEY ("callId") REFERENCES "Call"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Idempotent Hume event storage per Call when providerMessageId is present.
CREATE UNIQUE INDEX IF NOT EXISTS "Message_callId_providerMessageId_key"
  ON "Message"("callId", "providerMessageId")
  WHERE "callId" IS NOT NULL AND "providerMessageId" IS NOT NULL;

-- Safe backfill: attach orphan conversation messages to the sole Call when unambiguous.
UPDATE "Message" m
SET "callId" = c."id"
FROM "Call" c
WHERE m."callId" IS NULL
  AND m."conversationId" = c."conversationId"
  AND (
    SELECT COUNT(*)::int FROM "Call" cx WHERE cx."conversationId" = m."conversationId"
  ) = 1;
