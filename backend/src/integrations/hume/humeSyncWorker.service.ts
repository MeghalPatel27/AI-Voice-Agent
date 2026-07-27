import { Prisma } from "@prisma/client";
import { runHumeSyncWorkerOnce } from "./humeChatSync.service";

export type HumeSyncWorkerState = {
  enabled: boolean;
  running: boolean;
  paused: boolean;
  healthy: boolean;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
  nextRetryAt: string | null;
};

let workerTimer: ReturnType<typeof setInterval> | null = null;
let isWorkerRunning = false;
let workerPaused = false;
let consecutiveFailures = 0;
let nextRetryAt: Date | null = null;
let lastStartedAt: Date | null = null;
let lastSucceededAt: Date | null = null;
let lastFailedAt: Date | null = null;
let lastErrorCode: string | null = null;

function workerLog(event: string, data: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      scope: "hume_sync_worker",
      event,
      at: new Date().toISOString(),
      ...data,
    }),
  );
}

export function parseStrictBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return defaultValue;
}

export function getHumeSyncWorkerEnabled() {
  return parseStrictBoolean(process.env.HUME_SYNC_WORKER_ENABLED, true);
}

function getIntervalMs() {
  const raw = Number(process.env.HUME_SYNC_WORKER_INTERVAL_MS || 5000);
  if (!Number.isFinite(raw)) return 5000;
  return Math.max(2000, raw);
}

function getBatchLimit() {
  const raw = Number(process.env.HUME_SYNC_WORKER_BATCH_LIMIT || 4);
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

function getMaxTransientFailuresBeforePause() {
  const raw = Number(process.env.HUME_SYNC_WORKER_MAX_TRANSIENT_FAILURES || 8);
  if (!Number.isFinite(raw)) return 8;
  return Math.max(3, Math.floor(raw));
}

function retryDelayMs(failureCount: number) {
  const base = Number(process.env.HUME_SYNC_WORKER_RETRY_MS || 5000);
  const safeBase = Number.isFinite(base) ? Math.max(2000, base) : 5000;
  const cappedExponent = Math.min(6, Math.max(0, failureCount - 1));
  return Math.min(safeBase * 2 ** cappedExponent, 120_000);
}

function isSchemaMismatchError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  return error.code === "P2021" || error.code === "P2022";
}

function classifyWorkerError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021" || error.code === "P2022") {
      return error.code;
    }
    if (error.code === "P1001" || error.code === "P1002" || error.code === "P1008") {
      return error.code;
    }
    return `prisma_${error.code.toLowerCase()}`;
  }

  const message = error instanceof Error ? error.message : String(error || "unknown");
  if (message.toLowerCase().includes("timeout")) return "db_timeout";
  if (message.toLowerCase().includes("econnrefused")) return "db_connection_refused";
  if (message.toLowerCase().includes("enotfound")) return "db_host_unresolved";
  return "worker_iteration_failed";
}

function schemaMismatchDetail(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return "unknown_schema_target";
  }

  const meta = error.meta as Record<string, unknown> | undefined;
  const table = typeof meta?.table === "string" ? meta.table : null;
  const modelName = typeof meta?.modelName === "string" ? meta.modelName : null;
  const column = typeof meta?.column === "string" ? meta.column : null;

  if (table) return table;
  if (modelName) return modelName;
  if (column) return column;
  return "hume_sync_schema";
}

function recordWorkerFailure(error: unknown) {
  const errorCode = classifyWorkerError(error);
  lastFailedAt = new Date();
  lastErrorCode = errorCode;
  consecutiveFailures += 1;

  if (isSchemaMismatchError(error)) {
    workerPaused = true;
    nextRetryAt = null;
    workerLog("schema_mismatch", {
      errorCode,
      target: schemaMismatchDetail(error),
      action: "worker_paused",
    });
    return { errorCode, paused: true as const };
  }

  nextRetryAt = new Date(Date.now() + retryDelayMs(consecutiveFailures));
  workerLog("iteration_failed", {
    errorCode,
    consecutiveFailures,
    nextRetryAt: nextRetryAt.toISOString(),
  });

  if (consecutiveFailures >= getMaxTransientFailuresBeforePause()) {
    workerPaused = true;
    workerLog("transient_failures_paused", {
      consecutiveFailures,
      action: "worker_paused",
    });
  }

  return { errorCode, paused: workerPaused };
}

function recordWorkerSuccess() {
  lastSucceededAt = new Date();
  lastErrorCode = null;
  consecutiveFailures = 0;
  nextRetryAt = null;
  workerPaused = false;
}

export function getHumeSyncWorkerState(): HumeSyncWorkerState {
  const enabled = getHumeSyncWorkerEnabled();
  const healthy = enabled && !workerPaused && consecutiveFailures === 0;

  return {
    enabled,
    running: isWorkerRunning,
    paused: workerPaused,
    healthy,
    lastStartedAt: lastStartedAt?.toISOString() ?? null,
    lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
    lastFailedAt: lastFailedAt?.toISOString() ?? null,
    lastErrorCode,
    consecutiveFailures,
    nextRetryAt: nextRetryAt?.toISOString() ?? null,
  };
}

export async function runHumeSyncWorkerTick() {
  if (!getHumeSyncWorkerEnabled()) {
    return { skipped: true as const, reason: "disabled" as const };
  }

  if (isWorkerRunning) {
    return { skipped: true as const, reason: "already_running" as const };
  }

  if (workerPaused) {
    return { skipped: true as const, reason: "paused" as const };
  }

  if (nextRetryAt && nextRetryAt.getTime() > Date.now()) {
    return { skipped: true as const, reason: "backoff" as const };
  }

  isWorkerRunning = true;
  lastStartedAt = new Date();

  try {
    const result = await runHumeSyncWorkerOnce(getBatchLimit());
    recordWorkerSuccess();
    if (result.processed > 0) {
      workerLog("worker_tick", result);
    }
    return { skipped: false as const, ...result };
  } catch (error) {
    const failure = recordWorkerFailure(error);
    return {
      skipped: false as const,
      processed: 0,
      completed: 0,
      failed: 1,
      retried: 0,
      errorCode: failure.errorCode,
      paused: failure.paused,
    };
  } finally {
    isWorkerRunning = false;
  }
}

export function startHumeSyncWorker() {
  if (!getHumeSyncWorkerEnabled()) {
    console.log("[Hume Sync Worker] Disabled");
    return;
  }

  if (workerTimer) {
    console.log("[Hume Sync Worker] Already running");
    return;
  }

  const intervalMs = getIntervalMs();
  console.log(`[Hume Sync Worker] Started. Interval: ${intervalMs}ms`);

  workerTimer = setInterval(() => {
    void runHumeSyncWorkerTick();
  }, intervalMs);

  if (typeof workerTimer === "object" && "unref" in workerTimer) {
    workerTimer.unref();
  }

  void runHumeSyncWorkerTick();
}

export function stopHumeSyncWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
  console.log("[Hume Sync Worker] Stopped");
}

export function resetHumeSyncWorkerStateForTests() {
  stopHumeSyncWorker();
  isWorkerRunning = false;
  workerPaused = false;
  consecutiveFailures = 0;
  nextRetryAt = null;
  lastStartedAt = null;
  lastSucceededAt = null;
  lastFailedAt = null;
  lastErrorCode = null;
}
