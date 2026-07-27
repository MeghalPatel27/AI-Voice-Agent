import "dotenv/config";
import { prisma } from "../src/db/prisma";

async function tableExists(tableName: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    tableName,
  );
  return Boolean(rows[0]?.exists);
}

async function main() {
  const humeTables = [
    "HumeChatSyncJob",
    "HumeWebhookReceipt",
    "HumeToolCallReceipt",
    "HumeExpressionAnalysis",
  ] as const;

  const [
    tablePresence,
    migrationRows,
    syncJobsByStatus,
    duplicateHumeChatIds,
    duplicateWebhookKeys,
    duplicateToolCallIds,
    orphanSyncJobs,
    callsWithHumeChatId,
    callsByVoiceAgentProvider,
    callsByTelephonyProvider,
    callColumns,
  ] = await Promise.all([
    Promise.all(humeTables.map(async (name) => [name, await tableExists(name)] as const)),
    prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null }>>(
      `SELECT migration_name, finished_at
       FROM _prisma_migrations
       ORDER BY finished_at NULLS LAST`,
    ),
    prisma.$queryRawUnsafe<Array<{ status: string; count: bigint }>>(
      `SELECT status, COUNT(*)::bigint AS count
       FROM "HumeChatSyncJob"
       GROUP BY status
       ORDER BY status`,
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{ humeChatId: string; count: bigint }>>(
      `SELECT "humeChatId", COUNT(*)::bigint AS count
       FROM "Call"
       WHERE "humeChatId" IS NOT NULL
       GROUP BY "humeChatId"
       HAVING COUNT(*) > 1`,
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{ idempotencyKey: string; count: bigint }>>(
      `SELECT "idempotencyKey", COUNT(*)::bigint AS count
       FROM "HumeWebhookReceipt"
       GROUP BY "idempotencyKey"
       HAVING COUNT(*) > 1`,
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{ toolCallId: string; count: bigint }>>(
      `SELECT "toolCallId", COUNT(*)::bigint AS count
       FROM "HumeToolCallReceipt"
       GROUP BY "toolCallId"
       HAVING COUNT(*) > 1`,
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM "HumeChatSyncJob" j
       LEFT JOIN "Call" c ON c.id = j."callId"
       WHERE c.id IS NULL`,
    ).catch(() => [{ count: BigInt(0) }]),
    prisma.call.count({ where: { humeChatId: { not: null } } }).catch(() => -1),
    prisma.$queryRawUnsafe<Array<{ voiceAgentProvider: string | null; count: bigint }>>(
      `SELECT "voiceAgentProvider"::text AS "voiceAgentProvider", COUNT(*)::bigint AS count
       FROM "Call"
       GROUP BY "voiceAgentProvider"
       ORDER BY count DESC`,
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{ telephonyProvider: string | null; count: bigint }>>(
      `SELECT "telephonyProvider"::text AS "telephonyProvider", COUNT(*)::bigint AS count
       FROM "Call"
       GROUP BY "telephonyProvider"
       ORDER BY count DESC`,
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'Call'
         AND column_name IN (
           'humeChatId',
           'telephonyProvider',
           'voiceAgentProvider',
           'transcriptSyncStatus',
           'humeSyncStatus',
           'expressionAnalysisStatus'
         )
       ORDER BY column_name`,
    ).catch(() => []),
  ]);

  console.log(
    JSON.stringify(
      {
        humeTables: Object.fromEntries(tablePresence),
        humeMigrationApplied: migrationRows.some(
          (row) => row.migration_name === "20260727160000_add_hume_evi_runtime" && row.finished_at,
        ),
        migrations: migrationRows.map((row) => ({
          name: row.migration_name,
          finished: Boolean(row.finished_at),
        })),
        callHumeColumns: callColumns.map((row) => row.column_name),
        humeSyncJobsByStatus: syncJobsByStatus.map((row) => ({
          status: row.status,
          count: Number(row.count),
        })),
        duplicateHumeChatIdCount: duplicateHumeChatIds.length,
        duplicateWebhookIdempotencyKeyCount: duplicateWebhookKeys.length,
        duplicateToolCallIdCount: duplicateToolCallIds.length,
        orphanHumeSyncJobCount: Number(orphanSyncJobs[0]?.count ?? 0),
        callsWithHumeChatIdCount: callsWithHumeChatId,
        callsByVoiceAgentProvider: callsByVoiceAgentProvider.map((row) => ({
          provider: row.voiceAgentProvider,
          count: Number(row.count),
        })),
        callsByTelephonyProvider: callsByTelephonyProvider.map((row) => ({
          provider: row.telephonyProvider,
          count: Number(row.count),
        })),
      },
      null,
      2,
    ),
  );
}

void main().finally(async () => {
  await prisma.$disconnect();
});
