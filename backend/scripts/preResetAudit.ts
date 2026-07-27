import "dotenv/config";
import { prisma } from "../src/db/prisma";

function redactDatabaseUrl(url?: string) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const projectRef =
      parsed.hostname.match(/db\.([a-z0-9]+)\.supabase/)?.[1] ??
      parsed.hostname.match(/([a-z0-9]{20})\.supabase/)?.[1] ??
      null;

    return {
      hostname: parsed.hostname,
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, "") || "postgres",
      projectRef,
    };
  } catch {
    return { parseError: true };
  }
}

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

async function countTable(tableName: string) {
  if (!(await tableExists(tableName))) {
    return null;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${tableName}"`,
  );

  return Number(rows[0]?.count ?? 0);
}

async function main() {
  const applicationTables = [
    "Company",
    "CompanySettings",
    "User",
    "Customer",
    "Conversation",
    "Message",
    "Call",
    "CallPostAnalysis",
    "Task",
    "AiAgent",
    "Booking",
    "OutboundMessage",
    "KnowledgeItem",
    "CrmStage",
    "HandoffRule",
    "NotificationRule",
    "AuditLog",
    "IntegrationConnection",
    "HumeWebhookReceipt",
    "HumeToolCallReceipt",
    "HumeChatSyncJob",
    "HumeExpressionAnalysis",
  ];

  const [
    publicTables,
    migrations,
    enums,
    interestColumns,
    rowCounts,
  ] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    ),
    prisma.$queryRawUnsafe<
      Array<{
        migration_name: string;
        checksum: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }>
    >(
      `SELECT migration_name, checksum, finished_at, rolled_back_at
       FROM _prisma_migrations
       ORDER BY finished_at NULLS LAST`,
    ),
    prisma.$queryRawUnsafe<Array<{ typname: string }>>(
      `SELECT typname
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype = 'e'
       ORDER BY typname`,
    ),
    prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           column_name ILIKE '%interest%'
           OR column_name = 'voiceAffect'
         )
       ORDER BY table_name, column_name`,
    ),
    Promise.all(
      applicationTables.map(async (tableName) => [
        tableName,
        await countTable(tableName),
      ] as const),
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        inspectedAt: new Date().toISOString(),
        nodeEnv: process.env.NODE_ENV ?? null,
        database: redactDatabaseUrl(process.env.DATABASE_URL),
        direct: redactDatabaseUrl(process.env.DIRECT_URL),
        publicTableCount: publicTables.length,
        publicTables: publicTables.map((row) => row.table_name),
        enums: enums.map((row) => row.typname),
        migrations: migrations.map((row) => ({
          name: row.migration_name,
          finished: Boolean(row.finished_at),
          rolledBack: Boolean(row.rolled_back_at),
          checksumPrefix: row.checksum.slice(0, 12),
        })),
        interestDriftColumns: interestColumns,
        rowCounts: Object.fromEntries(rowCounts),
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
