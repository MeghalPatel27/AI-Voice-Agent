import { runAiScheduledCallWorkerOnce } from "./aiScheduledCall.service";
import { deliverPendingOutboundMessages } from "./outboundDelivery.service";

let workerTimer: ReturnType<typeof setInterval> | null = null;
let isWorkerRunning = false;

function getWorkerEnabled() {
  return process.env.OUTBOX_WORKER_ENABLED !== "false";
}

function getIntervalMs() {
  const raw = Number(process.env.OUTBOX_WORKER_INTERVAL_MS || 30000);

  if (!Number.isFinite(raw)) return 30000;

  return Math.max(10000, raw);
}

function getBatchLimit() {
  const raw = Number(process.env.OUTBOX_WORKER_BATCH_LIMIT || 20);

  if (!Number.isFinite(raw)) return 20;

  return Math.max(1, Math.min(100, Math.floor(raw)));
}

export async function runOutboxWorkerOnce() {
  if (isWorkerRunning) {
    return {
      skipped: true,
      reason: "Worker is already running",
    };
  }

  isWorkerRunning = true;

  try {
    const [outboundResult, aiCallResult] = await Promise.all([
      deliverPendingOutboundMessages({
        channel: "WHATSAPP",
        limit: getBatchLimit(),
      }),
      runAiScheduledCallWorkerOnce(10),
    ]);

    if (outboundResult.totalPicked > 0) {
      console.log(
        `[Outbox Worker] WhatsApp picked ${outboundResult.totalPicked}, sent ${outboundResult.sent}, failed ${outboundResult.failed}, skipped ${outboundResult.skipped}`
      );
    }

    if (aiCallResult.totalPicked > 0) {
      console.log(
        `[AI Scheduled Call Worker] Picked ${aiCallResult.totalPicked}, started ${aiCallResult.started}, failed ${aiCallResult.failed}, skipped ${aiCallResult.skipped}`
      );
    }

    return {
      ...outboundResult,
      workerSkipped: false,
      aiScheduledCalls: aiCallResult,
    };
  } catch (error) {
    console.error("[Outbox Worker] Failed:", error);

    return {
      skipped: false,
      totalPicked: 0,
      sent: 0,
      failed: 0,
      skippedCount: 0,
      aiScheduledCalls: {
        totalPicked: 0,
        started: 0,
        failed: 0,
        skipped: 0,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    isWorkerRunning = false;
  }
}

export function startOutboxWorker() {
  if (!getWorkerEnabled()) {
    console.log("[Outbox Worker] Disabled");
    return;
  }

  if (workerTimer) {
    console.log("[Outbox Worker] Already running");
    return;
  }

  const intervalMs = getIntervalMs();

  console.log(`[Outbox Worker] Started. Interval: ${intervalMs}ms`);

  workerTimer = setInterval(() => {
    runOutboxWorkerOnce();
  }, intervalMs);

  runOutboxWorkerOnce();
}

export function stopOutboxWorker() {
  if (!workerTimer) return;

  clearInterval(workerTimer);
  workerTimer = null;

  console.log("[Outbox Worker] Stopped");
}