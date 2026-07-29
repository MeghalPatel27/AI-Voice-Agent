import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  TERMINAL_CALL_STATUSES,
  finalizeCall,
  mapTwilioStatusToCallStatus,
  shouldApplyCallStatus,
  type DbCallStatus,
  type FinalizeCallInput,
  type FinalizeCallResult,
} from "./callFinalization.service";
import {
  extractRelatedTaskId,
  isSuccessfulTerminalStatus,
  mapCallStatusToTaskTerminal,
} from "./callLifecycleTaskSync";
import {
  AI_CALL_TASK_KIND,
  parseScheduledCallContext,
  stringifyScheduledCallContext,
  type ScheduledCallContext,
} from "./aiScheduledCallContext";
import { enqueueHumeSyncJob } from "../integrations/hume/humeChatSync.service";
import { getHumeChat } from "../integrations/hume/humeChatHistory.client";
import {
  findCallByTwilioSid,
  persistHumeChatCorrelation,
} from "../integrations/hume/humeChatCorrelation.service";
import { markPostMeetingTerminationSatisfied } from "./callTermination.service";

export type LifecycleSource = "TWILIO" | "HUME" | "RECONCILER" | "SYNC" | "SYSTEM";

export type CallLifecyclePhase =
  | "PRE_CALL"
  | "ACTIVE"
  | "TERMINAL_SUCCESS"
  | "TERMINAL_NON_SUCCESS";

export type LifecycleTransitionResult = {
  applied: boolean;
  ignored: boolean;
  ignoreReason?: string;
  previousStatus: DbCallStatus | null;
  nextStatus: DbCallStatus | null;
  callId: string | null;
  taskId: string | null;
  taskStatus: TaskStatus | null;
  conversationId: string | null;
  jobsEnqueued: string[];
  finalize?: FinalizeCallResult | null;
};

type TxClient = Prisma.TransactionClient;

function lifecycleLog(
  event: string,
  data: Record<string, unknown> = {},
) {
  console.log(
    JSON.stringify({
      scope: "call_lifecycle",
      event,
      at: new Date().toISOString(),
      ...data,
    }),
  );
}

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function isTerminalCallStatus(
  status: string | null | undefined,
): status is DbCallStatus {
  return Boolean(status && TERMINAL_CALL_STATUSES.has(status as DbCallStatus));
}

export function canTransitionCallStatus(
  currentStatus: string | null | undefined,
  nextStatus: DbCallStatus,
) {
  return shouldApplyCallStatus(currentStatus, nextStatus);
}

export function normalizeTwilioStatus(
  twilioStatus: string,
  direction?: string | null,
): DbCallStatus | null {
  const status = String(twilioStatus || "")
    .toLowerCase()
    .trim();

  switch (status) {
    case "queued":
    case "initiated":
    case "ringing":
      return "RINGING";
    case "answered":
    case "in-progress":
      return "IN_PROGRESS";
    case "completed":
      return "COMPLETED";
    case "busy":
      return "BUSY";
    case "failed":
      return "FAILED";
    case "no-answer":
      return direction === "INBOUND" ? "MISSED" : "NO_ANSWER";
    case "canceled":
    case "cancelled":
      return "CANCELED";
    default:
      return null;
  }
}

export function normalizeHumeEndReason(raw?: string | null) {
  const value = String(raw || "chat_ended")
    .trim()
    .slice(0, 200);
  return value || "chat_ended";
}

export function callLifecyclePhase(status: DbCallStatus): CallLifecyclePhase {
  if (status === "RINGING") return "ACTIVE";
  if (status === "IN_PROGRESS" || status === "LIVE") return "ACTIVE";
  if (status === "COMPLETED" || status === "TRANSFERRED") {
    return "TERMINAL_SUCCESS";
  }
  if (isTerminalCallStatus(status)) return "TERMINAL_NON_SUCCESS";
  return "PRE_CALL";
}

export {
  extractRelatedTaskId,
  isSuccessfulTerminalStatus,
  mapCallStatusToTaskTerminal,
} from "./callLifecycleTaskSync";

function readMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function nonNegativeDuration(
  providerDuration: number | undefined,
  startedAt: Date | null | undefined,
  endedAt: Date,
  existing: number | null | undefined,
) {
  if (Number.isFinite(providerDuration) && (providerDuration as number) >= 0) {
    return Math.max(0, Math.round(providerDuration as number));
  }
  if (startedAt) {
    const calculated = Math.round(
      (endedAt.getTime() - new Date(startedAt).getTime()) / 1000,
    );
    return Math.max(0, calculated, existing || 0);
  }
  return Math.max(0, existing || 0);
}

export async function findRelatedScheduledTask(
  input: {
    companyId: string;
    conversationId: string;
    metadata?: unknown;
    providerCallId?: string | null;
    twilioCallSid?: string | null;
  },
  client: TxClient | typeof prisma = prisma,
) {
  const relatedTaskId = extractRelatedTaskId(input.metadata);
  if (relatedTaskId) {
    const byId = await client.task.findFirst({
      where: {
        id: relatedTaskId,
        companyId: input.companyId,
      },
    });
    if (byId) {
      const notes = parseScheduledCallContext(byId.aiNotes);
      if (notes || String(byId.aiNotes || "").includes(AI_CALL_TASK_KIND)) {
        return byId;
      }
    }
  }

  const candidates = await client.task.findMany({
    where: {
      companyId: input.companyId,
      conversationId: input.conversationId,
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  const providerSid = input.providerCallId || input.twilioCallSid || null;

  for (const candidate of candidates) {
    const notes = parseScheduledCallContext(candidate.aiNotes);
    if (!notes || notes.kind !== AI_CALL_TASK_KIND) continue;
    if (providerSid && notes.callSid && notes.callSid === providerSid) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const notes = parseScheduledCallContext(candidate.aiNotes);
    if (!notes || notes.kind !== AI_CALL_TASK_KIND) continue;
    if (["CALLING", "RINGING", "IN_PROGRESS", "CONNECTED"].includes(notes.status)) {
      return candidate;
    }
    if (candidate.status === "DOING") return candidate;
  }

  return null;
}

export async function synchronizeRelatedTask(
  input: {
    companyId: string;
    conversationId: string;
    callId: string;
    callStatus: DbCallStatus;
    metadata?: unknown;
    providerCallId?: string | null;
    twilioCallSid?: string | null;
    endedAt: Date;
    failureReason?: string | null;
    endReason?: string | null;
  },
  client: TxClient | typeof prisma = prisma,
) {
  if (!isTerminalCallStatus(input.callStatus)) {
    return { updated: false, taskId: null, taskStatus: null as TaskStatus | null };
  }

  const task = await findRelatedScheduledTask(
    {
      companyId: input.companyId,
      conversationId: input.conversationId,
      metadata: input.metadata,
      providerCallId: input.providerCallId,
      twilioCallSid: input.twilioCallSid,
    },
    client,
  );

  if (!task) {
    return { updated: false, taskId: null, taskStatus: null as TaskStatus | null };
  }

  const notes = parseScheduledCallContext(task.aiNotes);
  if (!notes && !String(task.aiNotes || "").includes(AI_CALL_TASK_KIND)) {
    return { updated: false, taskId: task.id, taskStatus: task.status };
  }

  // Dial/config failures already terminalized before a successful call outcome.
  if (
    notes &&
    task.status === "BLOCKED" &&
    notes.status === "FAILED" &&
    !notes.callSid &&
    !isSuccessfulTerminalStatus(input.callStatus)
  ) {
    return { updated: false, taskId: task.id, taskStatus: task.status };
  }

  const mapped = mapCallStatusToTaskTerminal(input.callStatus);
  const alreadyDesired =
    task.status === mapped.taskStatus &&
    (task.status !== "DONE" || Boolean(task.completedAt)) &&
    (!notes ||
      notes.status === mapped.notesStatus ||
      (mapped.taskStatus === "DONE" && notes.status === "COMPLETED"));

  if (task.status === "DONE" && mapped.taskStatus !== "DONE") {
    // Never reopen a completed task from a non-success late event.
    return { updated: false, taskId: task.id, taskStatus: task.status };
  }

  if (alreadyDesired && task.status !== "DOING") {
    return { updated: false, taskId: task.id, taskStatus: task.status };
  }

  const terminalAt = task.completedAt || input.endedAt;
  const reason =
    input.failureReason ||
    input.endReason ||
    `Call ended with status ${input.callStatus}`;

  const nextNotes = notes
    ? stringifyScheduledCallContext({
        ...notes,
        status: mapped.notesStatus,
        conversationId: notes.conversationId || input.conversationId,
        callSid:
          notes.callSid || input.providerCallId || input.twilioCallSid || null,
        completedAt:
          notes.completedAt || terminalAt.toISOString(),
        failedAt:
          mapped.taskStatus === "DONE"
            ? notes.failedAt || null
            : notes.failedAt || terminalAt.toISOString(),
        error: mapped.taskStatus === "DONE" ? null : String(reason).slice(0, 450),
      })
    : task.aiNotes;

  await client.task.update({
    where: { id: task.id },
    data: {
      status: mapped.taskStatus,
      completedAt: task.completedAt || terminalAt,
      blockedReason:
        mapped.taskStatus === "DONE" ? null : String(reason).slice(0, 450),
      conversationId: task.conversationId || input.conversationId,
      aiNotes: nextNotes,
    },
  });

  lifecycleLog("task_lifecycle_updated", {
    source: "SYSTEM",
    callId: redactId(input.callId),
    taskId: redactId(task.id),
    previousStatus: task.status,
    nextStatus: mapped.taskStatus,
    callStatus: input.callStatus,
    notesStatus: mapped.notesStatus,
  });

  return {
    updated: true,
    taskId: task.id,
    taskStatus: mapped.taskStatus,
  };
}

export async function enqueuePostCallProcessing(input: {
  callId: string;
  companyId: string;
  humeChatId?: string | null;
  callStatus: DbCallStatus;
  hasTranscript?: boolean;
}): Promise<string[]> {
  const jobs: string[] = [];
  const call = await prisma.call.findFirst({
    where: {
      id: input.callId,
      conversation: { companyId: input.companyId },
    },
    include: {
      postAnalysis: true,
      humeExpressionAnalysis: true,
      humeSyncJobs: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
  });

  if (!call) return jobs;

  const chatId = input.humeChatId || call.humeChatId;
  const terminal = isTerminalCallStatus(input.callStatus);
  const syncJobs = call.humeSyncJobs || [];

  if (chatId && terminal) {
    const existingSync = syncJobs.find(
      (job) => job.chatId === chatId && job.status === "COMPLETED",
    );
    if (!existingSync) {
      const before = syncJobs.find((job) => job.chatId === chatId);
      await enqueueHumeSyncJob(call.id, chatId, input.companyId);
      if (!before || before.status === "FAILED") {
        jobs.push("hume_chat_sync");
      }
    }

    if (
      call.recordingReconstructionStatus === "NOT_REQUESTED" ||
      call.recordingReconstructionStatus == null
    ) {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          recordingReconstructionStatus: "QUEUED",
          recordingSource: call.recordingSource || "HUME",
        },
      });
      jobs.push("recording_reconstruction");
    }

    if (!call.humeExpressionAnalysis) {
      await prisma.humeExpressionAnalysis.upsert({
        where: { callId: call.id },
        create: {
          callId: call.id,
          companyId: input.companyId,
          chatId,
          status: "PENDING",
        },
        update: {},
      });
      jobs.push("expression_analysis");
    }
  }

  // Post-call business analysis is created inside finalizeCall (unique on callId).
  if (terminal && !call.postAnalysis) {
    jobs.push("post_call_analysis_pending_finalize");
  } else if (terminal && call.postAnalysis?.status === "PENDING") {
    jobs.push("post_call_analysis");
  }

  return jobs;
}

/**
 * Authoritative terminalization entry used by Twilio, Hume, sync, and reconcilers.
 * Call/Conversation/analysis writes remain in finalizeCall; Task sync is attached here.
 */
export async function finalizeCallLifecycle(
  input: FinalizeCallInput & {
    source: LifecycleSource;
    humeChatId?: string | null;
    humeEndReason?: string | null;
  },
): Promise<LifecycleTransitionResult> {
  const finalize = await finalizeCall({
    ...input,
    endReason: input.humeEndReason
      ? normalizeHumeEndReason(input.humeEndReason)
      : input.endReason,
  });

  if (!finalize.callId || !finalize.companyId || !finalize.status) {
    return {
      applied: false,
      ignored: true,
      ignoreReason: "call_not_found_or_tenant_mismatch",
      previousStatus: null,
      nextStatus: null,
      callId: null,
      taskId: null,
      taskStatus: null,
      conversationId: finalize.conversationId,
      jobsEnqueued: [],
      finalize,
    };
  }

  const call = await prisma.call.findFirst({
    where: {
      id: finalize.callId,
      conversation: { companyId: finalize.companyId },
    },
    include: { conversation: true },
  });

  if (!call) {
    return {
      applied: !finalize.alreadyTerminal,
      ignored: false,
      previousStatus: null,
      nextStatus: finalize.status,
      callId: finalize.callId,
      taskId: null,
      taskStatus: null,
      conversationId: finalize.conversationId,
      jobsEnqueued: [],
      finalize,
    };
  }

  const taskSync =
    finalize.taskUpdated || finalize.taskId
      ? {
          updated: finalize.taskUpdated,
          taskId: finalize.taskId,
          taskStatus: finalize.taskStatus,
        }
      : await synchronizeRelatedTask({
          companyId: finalize.companyId,
          conversationId: call.conversationId,
          callId: call.id,
          callStatus: finalize.status,
          metadata: call.metadata,
          providerCallId: call.providerCallId,
          twilioCallSid: call.twilioCallSid,
          endedAt: call.endedAt || input.endedAt || new Date(),
          failureReason: call.failureReason,
          endReason: call.endReason || input.endReason,
        });

  const jobsEnqueued = await enqueuePostCallProcessing({
    callId: call.id,
    companyId: finalize.companyId,
    humeChatId: input.humeChatId || call.humeChatId,
    callStatus: finalize.status,
    hasTranscript: Boolean(finalize.transcript || call.transcript),
  });

  lifecycleLog("call_lifecycle_updated", {
    source: input.source,
    callId: redactId(call.id),
    taskId: redactId(taskSync.taskId),
    previousStatus: finalize.alreadyTerminal ? finalize.status : null,
    nextStatus: finalize.status,
    transitionApplied: !finalize.alreadyTerminal,
    alreadyTerminal: finalize.alreadyTerminal,
    taskUpdated: taskSync.updated,
    jobsEnqueued,
  });

  return {
    applied: !finalize.alreadyTerminal || taskSync.updated,
    ignored: finalize.alreadyTerminal && !taskSync.updated,
    ignoreReason:
      finalize.alreadyTerminal && !taskSync.updated
        ? "already_terminal_idempotent"
        : undefined,
    previousStatus: (call.status as DbCallStatus) || null,
    nextStatus: finalize.status,
    callId: call.id,
    taskId: taskSync.taskId,
    taskStatus: taskSync.taskStatus,
    conversationId: call.conversationId,
    jobsEnqueued,
    finalize,
  };
}

export async function applyTwilioLifecycleEvent(input: {
  callSid: string;
  twilioStatus: string;
  durationSeconds?: number;
  companyId?: string | null;
}): Promise<LifecycleTransitionResult> {
  const call = await prisma.call.findFirst({
    where: {
      OR: [
        { providerCallId: input.callSid },
        { twilioCallSid: input.callSid },
      ],
      ...(input.companyId
        ? { conversation: { companyId: input.companyId } }
        : {}),
    },
    include: { conversation: true },
  });

  if (!call) {
    lifecycleLog("twilio_lifecycle_miss", {
      source: "TWILIO",
      providerCallId: redactId(input.callSid),
    });
    return {
      applied: false,
      ignored: true,
      ignoreReason: "call_not_found",
      previousStatus: null,
      nextStatus: null,
      callId: null,
      taskId: null,
      taskStatus: null,
      conversationId: null,
      jobsEnqueued: [],
    };
  }

  const previousStatus = call.status as DbCallStatus;
  const mapped = normalizeTwilioStatus(input.twilioStatus, call.direction);
  if (!mapped) {
    lifecycleLog("twilio_lifecycle_ignored", {
      source: "TWILIO",
      callId: redactId(call.id),
      ignoreReason: "unknown_provider_status",
      providerStatus: String(input.twilioStatus || "").slice(0, 40),
      previousStatus,
    });
    return {
      applied: false,
      ignored: true,
      ignoreReason: "unknown_provider_status",
      previousStatus,
      nextStatus: previousStatus,
      callId: call.id,
      taskId: null,
      taskStatus: null,
      conversationId: call.conversationId,
      jobsEnqueued: [],
    };
  }

  const apply = canTransitionCallStatus(previousStatus, mapped);
  const endedAt =
    isTerminalCallStatus(mapped) && !call.endedAt
      ? new Date()
      : call.endedAt;
  const durationSeconds = isTerminalCallStatus(mapped)
    ? nonNegativeDuration(
        input.durationSeconds,
        call.startedAt,
        endedAt || new Date(),
        call.durationSeconds,
      )
    : call.durationSeconds;

  if (apply) {
    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: mapped,
        durationSeconds,
        endedAt: isTerminalCallStatus(mapped) ? endedAt || new Date() : call.endedAt,
        failureReason: [
          "NO_ANSWER",
          "BUSY",
          "FAILED",
          "CANCELED",
          "MISSED",
        ].includes(mapped)
          ? call.failureReason || `Twilio call status: ${input.twilioStatus}`
          : call.failureReason,
        metadata: {
          ...readMetadata(call.metadata),
          twilioStatus: input.twilioStatus,
          ...(mapped === "IN_PROGRESS" && !readMetadata(call.metadata).answeredAt
            ? { answeredAt: new Date().toISOString() }
            : {}),
        } as Prisma.InputJsonValue,
      },
    });
  } else {
    await prisma.call.update({
      where: { id: call.id },
      data: {
        metadata: {
          ...readMetadata(call.metadata),
          twilioStatus: input.twilioStatus,
          ignoredTwilioStatus: input.twilioStatus,
        } as Prisma.InputJsonValue,
        durationSeconds:
          input.durationSeconds && input.durationSeconds > 0
            ? Math.max(input.durationSeconds, call.durationSeconds || 0)
            : call.durationSeconds,
      },
    });
  }

  if (!isTerminalCallStatus(mapped)) {
    lifecycleLog("call_lifecycle_updated", {
      source: "TWILIO",
      callId: redactId(call.id),
      previousStatus,
      nextStatus: apply ? mapped : previousStatus,
      transitionApplied: apply,
      ignoreReason: apply ? undefined : "status_rank_or_terminal_guard",
    });
    return {
      applied: apply,
      ignored: !apply,
      ignoreReason: apply ? undefined : "status_rank_or_terminal_guard",
      previousStatus,
      nextStatus: apply ? mapped : previousStatus,
      callId: call.id,
      taskId: null,
      taskStatus: null,
      conversationId: call.conversationId,
      jobsEnqueued: [],
    };
  }

  // Even if the status transition was ignored (already terminal), still
  // reconcile Task / post-call jobs from the verified terminal evidence.
  const finalized = await finalizeCallLifecycle({
    callId: call.id,
    companyId: call.conversation.companyId,
    endReason: `twilio_status_${input.twilioStatus}`,
    providerStatus: input.twilioStatus,
    terminalStatus: isTerminalCallStatus(previousStatus) ? previousStatus : mapped,
    markCompleted: mapped === "COMPLETED",
    durationSeconds,
    endedAt: endedAt || undefined,
    source: "TWILIO",
    humeChatId: call.humeChatId,
  });
  await markPostMeetingTerminationSatisfied({
    callId: call.id,
    source: "TWILIO_TERMINAL",
  });
  return finalized;
}

export async function applyHumeChatEndedLifecycle(input: {
  chatId: string;
  endReason?: string | null;
  endTimestamp?: number | null;
}): Promise<LifecycleTransitionResult> {
  let call = await prisma.call.findFirst({
    where: { humeChatId: input.chatId },
    include: { conversation: true },
  });

  if (!call) {
    try {
      const chat = await getHumeChat(input.chatId);
      if (chat.twilioCallSid) {
        call = await findCallByTwilioSid(chat.twilioCallSid);
        if (call) {
          await persistHumeChatCorrelation({
            callId: call.id,
            chat,
            evidence: {
              method: "twilio_call_sid",
              twilioCallSid: chat.twilioCallSid,
              configIdMatch: true,
              timestampDeltaMs: null,
              chatStartMs: chat.startTimestampMs,
              callStartMs: (call.startedAt || call.createdAt).getTime(),
            },
          });
          call = await prisma.call.findFirst({
            where: { id: call.id },
            include: { conversation: true },
          });
        }
      }
    } catch {
      // fail closed below
    }
  }

  if (!call) {
    return {
      applied: false,
      ignored: true,
      ignoreReason: "call_not_found",
      previousStatus: null,
      nextStatus: null,
      callId: null,
      taskId: null,
      taskStatus: null,
      conversationId: null,
      jobsEnqueued: [],
    };
  }

  const previousStatus = call.status as DbCallStatus;
  const humeEndReason = normalizeHumeEndReason(input.endReason);
  const endedAt = input.endTimestamp
    ? new Date(input.endTimestamp * 1000)
    : call.endedAt || new Date();

  // Hume chat_ended proves the EVI session closed. Prefer existing terminal
  // Twilio status (including non-success); otherwise treat as completed chat.
  const nextStatus: DbCallStatus = isTerminalCallStatus(previousStatus)
    ? previousStatus
    : "COMPLETED";

  const applyStatus = canTransitionCallStatus(previousStatus, nextStatus);

  await prisma.call.update({
    where: { id: call.id },
    data: {
      humeEndReason,
      endedAt: call.endedAt || endedAt,
      status: applyStatus ? nextStatus : call.status,
      humeSyncStatus: "PENDING",
      transcriptSyncStatus: "PENDING",
      expressionAnalysisStatus: "PENDING",
      metadata: {
        ...readMetadata(call.metadata),
        humeChatEndedAt: endedAt.toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  const terminalStatus = (
    isTerminalCallStatus(applyStatus ? nextStatus : previousStatus)
      ? applyStatus
        ? nextStatus
        : previousStatus
      : "COMPLETED"
  ) as DbCallStatus;

  const finalized = await finalizeCallLifecycle({
    callId: call.id,
    companyId: call.conversation.companyId,
    endReason: humeEndReason,
    humeEndReason,
    terminalStatus,
    markCompleted: isSuccessfulTerminalStatus(terminalStatus),
    endedAt: call.endedAt || endedAt,
    source: "HUME",
    humeChatId: call.humeChatId,
  });
  await markPostMeetingTerminationSatisfied({
    callId: call.id,
    source: "HUME_CHAT_ENDED",
  });
  return finalized;
}

export { mapTwilioStatusToCallStatus, shouldApplyCallStatus, TERMINAL_CALL_STATUSES };
