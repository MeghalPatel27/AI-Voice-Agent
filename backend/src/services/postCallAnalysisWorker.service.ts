import { prisma } from "../db/prisma";
import {
  TERMINAL_CALL_STATUSES,
  type DbCallStatus,
} from "./callFinalization.service";
import {
  POST_CALL_PROMPT_VERSION,
  analyzeCallTranscriptWithOpenAI,
  getPostCallAnalysisModel,
  loadCallTranscriptForAnalysis,
} from "./postCallAnalysis.service";

let workerTimer: ReturnType<typeof setInterval> | null = null;
let isWorkerRunning = false;

function workerLog(event: string, data: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      scope: "post_call_analysis_worker",
      event,
      at: new Date().toISOString(),
      ...data,
    }),
  );
}

function getWorkerEnabled() {
  return process.env.POST_CALL_ANALYSIS_WORKER_ENABLED !== "false";
}

function getIntervalMs() {
  const raw = Number(process.env.POST_CALL_ANALYSIS_WORKER_INTERVAL_MS || 5000);
  if (!Number.isFinite(raw)) return 5000;
  return Math.max(2000, raw);
}

function getBatchLimit() {
  const raw = Number(process.env.POST_CALL_ANALYSIS_BATCH_LIMIT || 5);
  if (!Number.isFinite(raw)) return 5;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

function getMaxAttempts() {
  const raw = Number(process.env.POST_CALL_ANALYSIS_MAX_ATTEMPTS || 4);
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.min(8, Math.floor(raw)));
}

function getSettleMs() {
  const raw = Number(process.env.POST_CALL_ANALYSIS_SETTLE_MS || 8000);
  if (!Number.isFinite(raw)) return 8000;
  return Math.max(0, raw);
}

function getStaleProcessingMs() {
  const raw = Number(
    process.env.POST_CALL_ANALYSIS_STALE_PROCESSING_MS || 120000,
  );
  if (!Number.isFinite(raw)) return 120000;
  return Math.max(30000, raw);
}

function retryDelayMs(attemptCount: number) {
  const base = Number(process.env.POST_CALL_ANALYSIS_RETRY_MS || 10000);
  const safeBase = Number.isFinite(base) ? Math.max(2000, base) : 10000;
  return safeBase * Math.max(1, attemptCount);
}

function classifyFailure(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error || "unknown");

  if (message.includes("openai_api_key_missing")) return "openai_api_key_missing";
  if (message.includes("openai_http_error")) return "openai_http_error";
  if (message.includes("openai_empty_output")) return "openai_empty_output";
  if (message.includes("openai_invalid_json")) return "openai_invalid_json";
  if (message.includes("intentScore_required")) return "validation_error";
  if (message.includes("requirement_summary")) return "validation_error";
  if (message.toLowerCase().includes("abort")) return "openai_timeout";
  if (message.toLowerCase().includes("zod")) return "validation_error";
  return "analysis_failed";
}

async function recoverStaleProcessingJobs() {
  const staleBefore = new Date(Date.now() - getStaleProcessingMs());

  const recovered = await prisma.callPostAnalysis.updateMany({
    where: {
      status: "PROCESSING",
      processingStartedAt: {
        lt: staleBefore,
      },
    },
    data: {
      status: "PENDING",
      nextAttemptAt: new Date(),
      processingStartedAt: null,
      failureCode: "stale_processing_recovered",
    },
  });

  if (recovered.count > 0) {
    workerLog("stale_processing_recovered", { count: recovered.count });
  }

  return recovered.count;
}

async function claimNextAnalysisJob() {
  const now = new Date();

  const candidates = await prisma.callPostAnalysis.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: 10,
    select: {
      id: true,
      callId: true,
      companyId: true,
      attemptCount: true,
      updatedAt: true,
    },
  });

  for (const candidate of candidates) {
    const claimed = await prisma.callPostAnalysis.updateMany({
      where: {
        id: candidate.id,
        status: "PENDING",
        updatedAt: candidate.updatedAt,
      },
      data: {
        status: "PROCESSING",
        processingStartedAt: now,
        attemptCount: { increment: 1 },
        failureCode: null,
      },
    });

    if (claimed.count === 1) {
      return prisma.callPostAnalysis.findUnique({
        where: { id: candidate.id },
      });
    }
  }

  return null;
}

async function processClaimedAnalysis(analysisId: string) {
  const analysis = await prisma.callPostAnalysis.findUnique({
    where: { id: analysisId },
    include: {
      call: {
        select: {
          id: true,
          status: true,
          endedAt: true,
          conversationId: true,
        },
      },
    },
  });

  if (!analysis || analysis.status !== "PROCESSING") {
    return { skipped: true as const };
  }

  // Worker must never reopen or alter terminal call status.
  if (
    analysis.call &&
    !TERMINAL_CALL_STATUSES.has(analysis.call.status as DbCallStatus)
  ) {
    await prisma.callPostAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "PENDING",
        nextAttemptAt: new Date(Date.now() + getSettleMs()),
        processingStartedAt: null,
        failureCode: "call_not_terminal",
      },
    });
    return { skipped: true as const, reason: "call_not_terminal" };
  }

  workerLog("post_call_analysis_started", {
    analysisId: analysis.id,
    callId: analysis.callId,
    companyId: analysis.companyId,
    attemptCount: analysis.attemptCount,
  });

  const loaded = await loadCallTranscriptForAnalysis(analysis.callId);

  if (!loaded) {
    await prisma.callPostAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "FAILED",
        failureCode: "call_not_found",
        processingStartedAt: null,
        completedAt: new Date(),
      },
    });
    workerLog("post_call_analysis_failed", {
      analysisId: analysis.id,
      callId: analysis.callId,
      failureCode: "call_not_found",
    });
    return { failed: true as const, failureCode: "call_not_found" };
  }

  const { built } = loaded;

  if (!built.hasMeaningfulCustomerContent) {
    if (analysis.attemptCount < getMaxAttempts()) {
      await prisma.callPostAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: "PENDING",
          nextAttemptAt: new Date(Date.now() + retryDelayMs(analysis.attemptCount)),
          processingStartedAt: null,
          failureCode: "waiting_for_transcript",
        },
      });
      return { retried: true as const, reason: "waiting_for_transcript" };
    }

    await prisma.callPostAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "INSUFFICIENT_DATA",
        intentLevel: "UNKNOWN",
        intentScore: null,
        confidence: 0.2,
        requirementSummary: null,
        requirementDetails: null,
        evidenceSignals: [],
        promptVersion: POST_CALL_PROMPT_VERSION,
        modelName: getPostCallAnalysisModel(),
        truncatedTranscript: built.truncated,
        processingStartedAt: null,
        completedAt: new Date(),
        failureCode: "insufficient_customer_transcript",
      },
    });

    workerLog("post_call_analysis_completed", {
      analysisId: analysis.id,
      callId: analysis.callId,
      status: "INSUFFICIENT_DATA",
    });

    return { insufficient: true as const };
  }

  try {
    const result = await analyzeCallTranscriptWithOpenAI({
      transcript: built.transcript,
      truncated: built.truncated,
    });

    await prisma.callPostAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "COMPLETED",
        intentLevel: result.intentLevel,
        intentScore: result.intentScore,
        confidence: result.confidence,
        requirementSummary: result.requirementSummary,
        requirementDetails: result.requirements,
        evidenceSignals: result.evidenceSignals,
        promptVersion: POST_CALL_PROMPT_VERSION,
        modelName: getPostCallAnalysisModel(),
        truncatedTranscript: built.truncated,
        processingStartedAt: null,
        completedAt: new Date(),
        failureCode: null,
        nextAttemptAt: null,
      },
    });

    workerLog("post_call_analysis_completed", {
      analysisId: analysis.id,
      callId: analysis.callId,
      companyId: analysis.companyId,
      intentLevel: result.intentLevel,
      intentScore: result.intentScore,
      confidence: result.confidence,
      truncated: built.truncated,
    });

    return { completed: true as const };
  } catch (error) {
    const failureCode = classifyFailure(error);

    if (
      analysis.attemptCount < getMaxAttempts() &&
      (failureCode === "openai_timeout" ||
        failureCode === "openai_http_error" ||
        failureCode === "waiting_for_transcript")
    ) {
      await prisma.callPostAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: "PENDING",
          nextAttemptAt: new Date(Date.now() + retryDelayMs(analysis.attemptCount)),
          processingStartedAt: null,
          failureCode,
        },
      });
      return { retried: true as const, failureCode };
    }

    await prisma.callPostAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "FAILED",
        failureCode,
        processingStartedAt: null,
        completedAt: new Date(),
        intentLevel: null,
        intentScore: null,
        confidence: null,
        requirementSummary: null,
        requirementDetails: null,
        evidenceSignals: null,
      },
    });

    workerLog("post_call_analysis_failed", {
      analysisId: analysis.id,
      callId: analysis.callId,
      companyId: analysis.companyId,
      failureCode,
    });

    return { failed: true as const, failureCode };
  }
}

export async function runPostCallAnalysisWorkerOnce(limit = getBatchLimit()) {
  await recoverStaleProcessingJobs();

  let processed = 0;
  let completed = 0;
  let failed = 0;
  let retried = 0;
  let insufficient = 0;

  for (let i = 0; i < limit; i += 1) {
    const claimed = await claimNextAnalysisJob();
    if (!claimed) break;

    processed += 1;

    try {
      const result = await processClaimedAnalysis(claimed.id);
      if ("completed" in result && result.completed) completed += 1;
      if ("failed" in result && result.failed) failed += 1;
      if ("retried" in result && result.retried) retried += 1;
      if ("insufficient" in result && result.insufficient) insufficient += 1;
    } catch (error) {
      failed += 1;
      workerLog("post_call_analysis_failed", {
        analysisId: claimed.id,
        callId: claimed.callId,
        failureCode: "unhandled_worker_error",
      });

      await prisma.callPostAnalysis
        .update({
          where: { id: claimed.id },
          data: {
            status: "FAILED",
            failureCode: "unhandled_worker_error",
            processingStartedAt: null,
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  }

  return {
    processed,
    completed,
    failed,
    retried,
    insufficient,
  };
}

export async function runPostCallAnalysisWorkerTick() {
  if (isWorkerRunning) {
    return { skipped: true, reason: "already_running" as const };
  }

  isWorkerRunning = true;

  try {
    const result = await runPostCallAnalysisWorkerOnce();
    if (result.processed > 0) {
      workerLog("worker_tick", result);
    }
    return { skipped: false, ...result };
  } catch (error) {
    workerLog("worker_tick_failed", {
      failureCode: "worker_tick_error",
    });
    return {
      skipped: false,
      processed: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      insufficient: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    isWorkerRunning = false;
  }
}

export function startPostCallAnalysisWorker() {
  if (!getWorkerEnabled()) {
    console.log("[Post-Call Analysis Worker] Disabled");
    return;
  }

  if (workerTimer) {
    console.log("[Post-Call Analysis Worker] Already running");
    return;
  }

  const intervalMs = getIntervalMs();
  console.log(`[Post-Call Analysis Worker] Started. Interval: ${intervalMs}ms`);

  workerTimer = setInterval(() => {
    void runPostCallAnalysisWorkerTick();
  }, intervalMs);

  // Do not keep the process alive solely for this timer during tests.
  if (typeof workerTimer === "object" && "unref" in workerTimer) {
    workerTimer.unref();
  }

  void runPostCallAnalysisWorkerTick();
}

export function stopPostCallAnalysisWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
  console.log("[Post-Call Analysis Worker] Stopped");
}
