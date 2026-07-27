import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

/**
 * Supabase direct hosts (`db.<ref>.supabase.co`) are IPv6-only.
 * Prefer the Session pooler URL from the Supabase dashboard when local
 * networks drop IPv6 intermittently (Prisma P1001 / DatabaseNotReachable).
 */
const pool =
  globalForPrisma.pgPool ??
  new Pool({
    connectionString,
    // Fail fast instead of hanging the outbox/API workers.
    connectionTimeoutMillis: Number(
      process.env.PG_CONNECTION_TIMEOUT_MS || 10_000,
    ),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000),
    max: Number(process.env.PG_POOL_MAX || 10),
    keepAlive: true,
    allowExitOnIdle: true,
  } satisfies ConstructorParameters<typeof Pool>[0]);

pool.on("error", (error) => {
  console.error(
    JSON.stringify({
      scope: "db_pool",
      event: "idle_client_error",
      at: new Date().toISOString(),
      message: error.message,
    }),
  );
});

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}