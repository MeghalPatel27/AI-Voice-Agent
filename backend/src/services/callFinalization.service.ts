import type {
  CallIntentLevel,
  CallPostAnalysisStatus,
  CallStatus,
  Prisma,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  extractRelatedTaskId,
  mapCallStatusToTaskTerminal,
  isSuccessfulTerminalStatus,
} from "./callLifecycleTaskSync";
import {
  parseScheduledCallContext,
  stringifyScheduledCallContext,
  AI_CALL_TASK_KIND,
} from "./aiScheduledCallContext";

export type DbCallStatus = CallStatus;

export const TERMINAL_CALL_STATUSES = new Set<DbCallStatus>([
  "COMPLETED",
  "NO_ANSWER",
  "BUSY",
  "CANCELED",
  "FAILED",
  "MISSED",
  "TRANSFERRED",
]);

const CALL_STATUS_RANK: Record<DbCallStatus, number> = {
  RINGING: 10,
  IN_PROGRESS: 20,
  LIVE: 30,
  COMPLETED: 100,
  NO_ANSWER: 100,
  BUSY: 100,
  CANCELED: 100,
  FAILED: 100,
  MISSED: 100,
  TRANSFERRED: 100,
};

const ANALYSIS_KEEP_STATUSES = new Set<CallPostAnalysisStatus>([
  "COMPLETED",
  "FAILED",
  "INSUFFICIENT_DATA",
  "PROCESSING",
]);

export type FinalizeCallInput = {
  providerCallId?: string | null;
  callId?: string | null;
  conversationId?: string | null;
  companyId?: string | null;
  endReason: string;
  endedAt?: Date;
  providerStatus?: string | null;
  terminalStatus?: DbCallStatus;
  durationSeconds?: number;
  markCompleted?: boolean;
};

export type FinalizeCallResult = {
  callId: string | null;
  conversationId: string | null;
  companyId: string | null;
  alreadyTerminal: boolean;
  analysisQueued: boolean;
  status: DbCallStatus | null;
  transcript: string | null;
  taskId: string | null;
  taskStatus: TaskStatus | null;
  taskUpdated: boolean;
};

function finalizeLog(
  event: string,
  data: Record<string, unknown> = {},
) {
  console.log(
    JSON.stringify({
      scope: "call_finalization",
      event,
      at: new Date().toISOString(),
      ...data,
    }),
  );
}

function cleanText(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapTwilioStatusToCallStatus(
  twilioStatus: string,
  direction?: string | null,
): DbCallStatus {
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
      return "IN_PROGRESS";
  }
}

export function shouldApplyCallStatus(
  currentStatus: string | null | undefined,
  nextStatus: DbCallStatus,
) {
  if (!currentStatus) return true;

  const current = currentStatus as DbCallStatus;
  const currentRank = CALL_STATUS_RANK[current] ?? 0;
  const nextRank = CALL_STATUS_RANK[nextStatus] ?? 0;

  if (
    TERMINAL_CALL_STATUSES.has(current) &&
    !TERMINAL_CALL_STATUSES.has(nextStatus)
  ) {
    return false;
  }

  if (
    TERMINAL_CALL_STATUSES.has(current) &&
    TERMINAL_CALL_STATUSES.has(nextStatus)
  ) {
    return current === nextStatus || nextStatus === "COMPLETED";
  }

  if (current === "LIVE" && nextStatus === "IN_PROGRESS") {
    return false;
  }

  return nextRank >= currentRank;
}

export function buildTranscriptFromMessages(
  messages: Array<{ senderType: string; body: string }>,
) {
  return messages
    .map((message) => {
      const speaker =
        message.senderType === "CUSTOMER"
          ? "CUSTOMER"
          : message.senderType === "AI"
            ? "AI"
            : "HUMAN";
      return `${speaker}: ${cleanText(message.body)}`;
    })
    .filter((line) => line.replace(/^(CUSTOMER|AI|HUMAN):\s*/, "").trim())
    .join("\n")
    .trim();
}

function isUsefulCustomerRequirement(text: string) {
  const value = cleanText(text).toLowerCase();
  if (value.length < 8) return false;
  if (/^(hello|hi|hey|ok|okay|yes|no|thanks|thank you)\b/.test(value)) {
    return false;
  }
  return true;
}

function buildLeadSummary(
  messages: Array<{ senderType: string; body: string }>,
) {
  const useful = messages
    .filter(
      (message) =>
        message.senderType === "CUSTOMER" &&
        isUsefulCustomerRequirement(message.body),
    )
    .map((message) => cleanText(message.body))
    .slice(0, 6);

  if (useful.length === 0) {
    return "Customer completed an AI voice call.";
  }

  return useful.join(" · ").slice(0, 420);
}

function extractPreferredMeetingTimeFromText(text: string) {
  const value = String(text || "");
  const match = value.match(
    /\b(?:tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[0-9]{1,2}\s*(?:am|pm)|[0-9]{1,2}:[0-9]{2})\b[^.\n]{0,40}/i,
  );
  return match ? cleanText(match[0]).slice(0, 120) : null;
}

function resolveTerminalStatus(input: FinalizeCallInput): DbCallStatus {
  if (input.terminalStatus && TERMINAL_CALL_STATUSES.has(input.terminalStatus)) {
    return input.terminalStatus;
  }

  if (input.providerStatus) {
    const mapped = mapTwilioStatusToCallStatus(input.providerStatus, null);
    if (TERMINAL_CALL_STATUSES.has(mapped)) {
      return mapped;
    }
  }

  if (input.markCompleted === false) {
    return "COMPLETED";
  }

  return "COMPLETED";
}

async function findCallForFinalize(input: FinalizeCallInput) {
  if (input.callId) {
    const byId = await prisma.call.findFirst({
      where: {
        id: input.callId,
        ...(input.companyId
          ? {
              conversation: {
                companyId: input.companyId,
              },
            }
          : {}),
      },
      include: {
        conversation: {
          include: {
            customer: true,
            messages: {
              orderBy: { createdAt: "asc" },
              take: 200,
            },
          },
        },
        postAnalysis: true,
      },
    });

    if (byId) return byId;
    if (input.companyId) return null;
  }

  if (input.providerCallId) {
    const bySid = await prisma.call.findFirst({
      where: {
        providerCallId: input.providerCallId,
        ...(input.companyId
          ? {
              conversation: {
                companyId: input.companyId,
              },
            }
          : {}),
      },
      include: {
        conversation: {
          include: {
            customer: true,
            messages: {
              orderBy: { createdAt: "asc" },
              take: 200,
            },
          },
        },
        postAnalysis: true,
      },
    });

    if (bySid) return bySid;
    if (input.companyId) return null;
  }

  if (input.conversationId) {
    return prisma.call.findFirst({
      where: {
        conversationId: input.conversationId,
        ...(input.companyId
          ? {
              conversation: {
                companyId: input.companyId,
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        conversation: {
          include: {
            customer: true,
            messages: {
              orderBy: { createdAt: "asc" },
              take: 200,
            },
          },
        },
        postAnalysis: true,
      },
    });
  }

  return null;
}

/**
 * Idempotent call finalizer.
 * Marks the call terminal, updates conversation CRM fields, and queues
 * post-call analysis as PENDING without calling OpenAI.
 */
export async function finalizeCall(
  input: FinalizeCallInput,
): Promise<FinalizeCallResult> {
  if (!input.providerCallId && !input.callId && !input.conversationId) {
    return {
      callId: null,
      conversationId: null,
      companyId: null,
      alreadyTerminal: false,
      analysisQueued: false,
      status: null,
      transcript: null,
      taskId: null,
      taskStatus: null,
      taskUpdated: false,
    };
  }

  const call = await findCallForFinalize(input);

  if (!call) {
    finalizeLog("call_finalize_miss", {
      providerCallId: input.providerCallId || null,
      callId: input.callId || null,
      conversationId: input.conversationId || null,
      companyId: input.companyId || null,
      endReason: input.endReason,
    });
    return {
      callId: null,
      conversationId: input.conversationId || null,
      companyId: input.companyId || null,
      alreadyTerminal: false,
      analysisQueued: false,
      status: null,
      transcript: null,
      taskId: null,
      taskStatus: null,
      taskUpdated: false,
    };
  }

  const conversation = call.conversation;
  const companyId = conversation.companyId;

  if (input.companyId && input.companyId !== companyId) {
    finalizeLog("call_finalize_tenant_mismatch", {
      callId: call.id,
      expectedCompanyId: input.companyId,
      actualCompanyId: companyId,
    });
    return {
      callId: null,
      conversationId: null,
      companyId: null,
      alreadyTerminal: false,
      analysisQueued: false,
      status: null,
      transcript: null,
      taskId: null,
      taskStatus: null,
      taskUpdated: false,
    };
  }

  const alreadyTerminal = TERMINAL_CALL_STATUSES.has(call.status as DbCallStatus);
  const endedAt = call.endedAt || input.endedAt || new Date();
  const endReason = call.endReason || input.endReason;

  let nextStatus: DbCallStatus = resolveTerminalStatus(input);

  if (input.markCompleted === false && input.providerStatus) {
    const mapped = mapTwilioStatusToCallStatus(
      input.providerStatus,
      call.direction,
    );
    if (TERMINAL_CALL_STATUSES.has(mapped)) {
      nextStatus = mapped;
    }
  }

  if (alreadyTerminal) {
    nextStatus = call.status as DbCallStatus;
  }

  const transcript = buildTranscriptFromMessages(conversation.messages);
  const leadSummary = buildLeadSummary(conversation.messages);
  const meetingTimeText = extractPreferredMeetingTimeFromText(
    conversation.messages
      .filter((message) => message.senderType === "CUSTOMER")
      .map((message) => message.body)
      .join("\n"),
  );

  const summary =
    conversation.aiSummary &&
    !conversation.aiSummary.toLowerCase().includes("call started") &&
    !conversation.aiSummary
      .toLowerCase()
      .includes("outbound ai call requested")
      ? conversation.aiSummary
      : `Lead requirements: ${leadSummary}${
          meetingTimeText ? ` Meeting time: ${meetingTimeText}` : ""
        }`.slice(0, 500);

  const usefulTurns = conversation.messages.filter(
    (message) =>
      message.senderType === "CUSTOMER" &&
      isUsefulCustomerRequirement(message.body),
  ).length;

  const aiConfidence = Math.min(
    95,
    35 + usefulTurns * 12 + (conversation.bookingCreated ? 20 : 0),
  );

  const durationSeconds =
    Number.isFinite(input.durationSeconds) &&
    (input.durationSeconds as number) >= 0
      ? Math.max(0, Math.round(input.durationSeconds as number))
      : call.startedAt != null
        ? Math.max(
            0,
            call.durationSeconds || 0,
            Math.round(
              (endedAt.getTime() - new Date(call.startedAt).getTime()) / 1000,
            ),
          )
        : Math.max(0, call.durationSeconds || 0);

  const existingAnalysis = call.postAnalysis;
  const shouldQueueAnalysis =
    !existingAnalysis ||
    (!ANALYSIS_KEEP_STATUSES.has(existingAnalysis.status) &&
      existingAnalysis.status !== "PENDING");

  const analysisQueued = !existingAnalysis
    ? true
    : existingAnalysis.status === "PENDING"
      ? false
      : shouldQueueAnalysis;

  const settlingMs = Number(
    process.env.POST_CALL_ANALYSIS_SETTLE_MS || 8_000,
  );
  const nextAttemptAt = new Date(
    Date.now() + (Number.isFinite(settlingMs) ? Math.max(0, settlingMs) : 8_000),
  );

  let taskId: string | null = null;
  let taskStatus: TaskStatus | null = null;
  let taskUpdated = false;

  await prisma.$transaction(async (tx) => {
    const metadata = {
      ...((call.metadata as Record<string, unknown>) || {}),
      finalizedAt:
        ((call.metadata as Record<string, unknown>) || {}).finalizedAt ||
        new Date().toISOString(),
      finalizeReason: endReason,
      twilioStatus:
        input.providerStatus ||
        ((call.metadata as Record<string, unknown>) || {}).twilioStatus ||
        null,
      taskId:
        extractRelatedTaskId(call.metadata) ||
        ((call.metadata as Record<string, unknown>) || {}).taskId ||
        null,
    };

    await tx.call.update({
      where: { id: call.id },
      data: {
        transcript: transcript || call.transcript,
        status: nextStatus,
        durationSeconds,
        endedAt,
        endReason,
        failureReason: ["NO_ANSWER", "BUSY", "CANCELED", "FAILED", "MISSED"].includes(
          nextStatus,
        )
          ? call.failureReason ||
            `Twilio call status: ${input.providerStatus || nextStatus}`
          : call.failureReason,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        status:
          conversation.status === "CONVERTED" ||
          conversation.status === "HUMAN_REQUIRED"
            ? conversation.status
            : "FOLLOW_UP",
        aiSummary: summary,
        intent: conversation.intent || "AI voice call requirements",
        aiConfidence: Math.max(conversation.aiConfidence || 0, aiConfidence),
        nextAction:
          conversation.nextAction &&
          !conversation.nextAction.toLowerCase().includes("ai is")
            ? conversation.nextAction
            : meetingTimeText
              ? `Confirm meeting for: ${meetingTimeText}`
              : "Review call transcript and follow up with the lead.",
        lastMessage: transcript
          ? transcript.split("\n").slice(-1)[0]?.slice(0, 300) ||
            conversation.lastMessage
          : conversation.lastMessage,
        lastMessageAt: transcript ? new Date() : conversation.lastMessageAt,
      },
    });

    if (conversation.customerId) {
      await tx.customer.update({
        where: { id: conversation.customerId },
        data: {
          lastContactAt: new Date(),
          lastSeenAt: new Date(),
          leadStage:
            conversation.customer?.leadStage &&
            conversation.customer.leadStage !== "NEW"
              ? conversation.customer.leadStage
              : conversation.bookingCreated
                ? "MEETING_REQUESTED"
                : "CONTACTED",
          leadScore: Math.max(
            conversation.customer?.leadScore || 0,
            conversation.bookingCreated ? 80 : 65,
          ),
          notes: [
            conversation.customer?.notes || "",
            leadSummary ? `AI call notes: ${leadSummary}` : "",
          ]
            .filter(Boolean)
            .join("\n")
            .slice(0, 4000),
        },
      });
    }

    if (!existingAnalysis) {
      try {
        await tx.callPostAnalysis.create({
          data: {
            companyId,
            callId: call.id,
            status: "PENDING",
            nextAttemptAt,
            attemptCount: 0,
          },
        });
      } catch (error) {
        // Unique callId constraint: another finalizer already queued analysis.
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code)
            : "";
        if (code !== "P2002") {
          throw error;
        }
      }
    } else if (
      existingAnalysis.status === "PENDING" ||
      ANALYSIS_KEEP_STATUSES.has(existingAnalysis.status)
    ) {
      // Preserve PENDING / COMPLETED / FAILED / PROCESSING / INSUFFICIENT_DATA.
    } else {
      await tx.callPostAnalysis.update({
        where: { id: existingAnalysis.id },
        data: {
          status: "PENDING",
          nextAttemptAt,
          failureCode: null,
          processingStartedAt: null,
        },
      });
    }

    // Synchronize related scheduled AI-call Task inside the same transaction.
    const relatedTaskId = extractRelatedTaskId(call.metadata);
    let relatedTask = relatedTaskId
      ? await tx.task.findFirst({
          where: { id: relatedTaskId, companyId },
        })
      : null;

    if (!relatedTask) {
      const candidates = await tx.task.findMany({
        where: {
          companyId,
          conversationId: conversation.id,
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
      });
      relatedTask =
        candidates.find((candidate) => {
          const notes = parseScheduledCallContext(candidate.aiNotes);
          if (!notes || notes.kind !== AI_CALL_TASK_KIND) return false;
          const sid = call.providerCallId || call.twilioCallSid;
          if (sid && notes.callSid && notes.callSid === sid) return true;
          return (
            candidate.status === "DOING" ||
            ["CALLING", "RINGING", "IN_PROGRESS", "CONNECTED"].includes(
              notes.status,
            )
          );
        }) || null;
    }

    if (relatedTask) {
      const notes = parseScheduledCallContext(relatedTask.aiNotes);
      if (notes && notes.kind === AI_CALL_TASK_KIND) {
        const skipPreDialFailure =
          relatedTask.status === "BLOCKED" &&
          notes.status === "FAILED" &&
          !notes.callSid &&
          !isSuccessfulTerminalStatus(nextStatus);

        const mapped = mapCallStatusToTaskTerminal(nextStatus);
        const reopenBlocked =
          relatedTask.status === "DONE" && mapped.taskStatus !== "DONE";

        if (!skipPreDialFailure && !reopenBlocked) {
          const alreadyDesired =
            relatedTask.status === mapped.taskStatus &&
            relatedTask.status !== "DOING" &&
            (notes.status === mapped.notesStatus ||
              (mapped.taskStatus === "DONE" && notes.status === "COMPLETED"));

          if (!alreadyDesired) {
            const terminalAt = relatedTask.completedAt || endedAt;
            await tx.task.update({
              where: { id: relatedTask.id },
              data: {
                status: mapped.taskStatus,
                completedAt: relatedTask.completedAt || terminalAt,
                blockedReason:
                  mapped.taskStatus === "DONE"
                    ? null
                    : (
                        call.failureReason ||
                        endReason ||
                        `Call ended: ${nextStatus}`
                      ).slice(0, 450),
                conversationId:
                  relatedTask.conversationId || conversation.id,
                aiNotes: stringifyScheduledCallContext({
                  ...notes,
                  status: mapped.notesStatus,
                  conversationId:
                    notes.conversationId || conversation.id,
                  callSid:
                    notes.callSid ||
                    call.providerCallId ||
                    call.twilioCallSid ||
                    null,
                  completedAt:
                    notes.completedAt || terminalAt.toISOString(),
                  failedAt:
                    mapped.taskStatus === "DONE"
                      ? notes.failedAt || null
                      : notes.failedAt || terminalAt.toISOString(),
                  error:
                    mapped.taskStatus === "DONE"
                      ? null
                      : (
                          call.failureReason ||
                          endReason ||
                          `Call ended: ${nextStatus}`
                        ).slice(0, 450),
                }),
              },
            });
            taskUpdated = true;
            taskStatus = mapped.taskStatus;
          } else {
            taskStatus = relatedTask.status;
          }
          taskId = relatedTask.id;
        } else {
          taskId = relatedTask.id;
          taskStatus = relatedTask.status;
        }
      }
    }
  });

  finalizeLog("call_finalized", {
    callId: call.id,
    conversationId: conversation.id,
    companyId,
    providerCallId: call.providerCallId,
    endReason,
    status: nextStatus,
    alreadyTerminal,
    analysisQueued: !existingAnalysis || analysisQueued,
    taskId,
    taskStatus,
    taskUpdated,
  });

  if (!existingAnalysis) {
    finalizeLog("post_call_analysis_queued", {
      callId: call.id,
      companyId,
      nextAttemptAt: nextAttemptAt.toISOString(),
    });
  }

  return {
    callId: call.id,
    conversationId: conversation.id,
    companyId,
    alreadyTerminal,
    analysisQueued: !existingAnalysis,
    status: nextStatus,
    transcript: transcript || call.transcript,
    taskId,
    taskStatus,
    taskUpdated,
  };
}

export type PostCallAnalysisDto = {
  analysisStatus: CallPostAnalysisStatus | "NONE";
  intentLevel: CallIntentLevel | null;
  intentScore: number | null;
  confidence: number | null;
  requirementSummary: string | null;
  requirementDetails: unknown;
  evidenceSignals: unknown;
  completedAt: Date | null;
  failureCode: string | null;
  promptVersion: string | null;
  callId: string | null;
  isLatestCallAnalysis?: boolean;
};

export function serializePostCallAnalysis(
  analysis:
    | {
        status: CallPostAnalysisStatus;
        intentLevel: CallIntentLevel | null;
        intentScore: number | null;
        confidence: number | null;
        requirementSummary: string | null;
        requirementDetails: unknown;
        evidenceSignals: unknown;
        completedAt: Date | null;
        failureCode: string | null;
        promptVersion: string | null;
        callId: string;
      }
    | null
    | undefined,
  options?: { isLatestCallAnalysis?: boolean },
): PostCallAnalysisDto {
  if (!analysis) {
    return {
      analysisStatus: "NONE",
      intentLevel: null,
      intentScore: null,
      confidence: null,
      requirementSummary: null,
      requirementDetails: null,
      evidenceSignals: null,
      completedAt: null,
      failureCode: null,
      promptVersion: null,
      callId: null,
      ...(options?.isLatestCallAnalysis != null
        ? { isLatestCallAnalysis: options.isLatestCallAnalysis }
        : {}),
    };
  }

  return {
    analysisStatus: analysis.status,
    intentLevel: analysis.intentLevel,
    intentScore: analysis.intentScore,
    confidence: analysis.confidence,
    requirementSummary: analysis.requirementSummary,
    requirementDetails: analysis.requirementDetails ?? null,
    evidenceSignals: analysis.evidenceSignals ?? null,
    completedAt: analysis.completedAt,
    failureCode: analysis.failureCode,
    promptVersion: analysis.promptVersion,
    callId: analysis.callId,
    ...(options?.isLatestCallAnalysis != null
      ? { isLatestCallAnalysis: options.isLatestCallAnalysis }
      : {}),
  };
}
