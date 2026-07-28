import { prisma } from "../db/prisma";
import {
  TERMINAL_CALL_STATUSES,
  type DbCallStatus,
} from "./callFinalization.service";
import {
  enqueuePostCallProcessing,
  finalizeCallLifecycle,
  findRelatedScheduledTask,
  isTerminalCallStatus,
  synchronizeRelatedTask,
} from "./callLifecycle.service";
import { AI_CALL_TASK_KIND, parseScheduledCallContext } from "./aiScheduledCallContext";

export type ReconcileOptions = {
  apply?: boolean;
  companyId?: string | null;
  staleActiveCallMinutes?: number;
  limit?: number;
};

export type ReconcileFinding = {
  kind:
    | "terminal_call_active_task"
    | "terminal_call_active_conversation"
    | "terminal_call_missing_jobs"
    | "stale_active_call"
    | "active_task_without_call";
  callId?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  companyId: string;
  detail: string;
  repairable: boolean;
};

export type ReconcileReport = {
  dryRun: boolean;
  scanned: {
    activeTasks: number;
    activeCalls: number;
    terminalCallsWithActiveTasks: number;
    staleConversations: number;
    missingPostCallJobs: number;
    staleActiveCalls: number;
  };
  findings: ReconcileFinding[];
  applied: Array<{
    kind: string;
    callId?: string | null;
    taskId?: string | null;
    result: string;
  }>;
};

function getStaleActiveCallMinutes(override?: number) {
  if (Number.isFinite(override) && (override as number) > 0) {
    return Math.max(5, Math.round(override as number));
  }
  const raw = Number(process.env.CALL_RECONCILE_STALE_ACTIVE_MINUTES || 45);
  if (!Number.isFinite(raw)) return 45;
  return Math.max(5, Math.round(raw));
}

function redact(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function logReconcile(event: string, data: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      scope: "call_reconcile",
      event,
      at: new Date().toISOString(),
      ...data,
    }),
  );
}

export async function reconcileCallLifecycle(
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const apply = Boolean(options.apply);
  const limit = Math.max(1, Math.min(options.limit || 200, 1000));
  const staleMinutes = getStaleActiveCallMinutes(options.staleActiveCallMinutes);
  const staleBefore = new Date(Date.now() - staleMinutes * 60_000);
  const companyFilter = options.companyId
    ? { companyId: options.companyId }
    : {};

  const activeTasks = await prisma.task.findMany({
    where: {
      ...companyFilter,
      status: "DOING",
    },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  const activeCalls = await prisma.call.findMany({
    where: {
      status: { in: ["RINGING", "IN_PROGRESS", "LIVE"] },
      ...(options.companyId
        ? { conversation: { companyId: options.companyId } }
        : {}),
    },
    include: { conversation: true, postAnalysis: true, humeSyncJobs: true },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  const terminalCalls = await prisma.call.findMany({
    where: {
      status: { in: Array.from(TERMINAL_CALL_STATUSES) as DbCallStatus[] },
      ...(options.companyId
        ? { conversation: { companyId: options.companyId } }
        : {}),
      OR: [
        { endedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
        { updatedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
      ],
    },
    include: {
      conversation: true,
      postAnalysis: true,
      humeSyncJobs: true,
      humeExpressionAnalysis: true,
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  const findings: ReconcileFinding[] = [];
  const applied: ReconcileReport["applied"] = [];

  let terminalCallsWithActiveTasks = 0;
  let staleConversations = 0;
  let missingPostCallJobs = 0;
  let staleActiveCalls = 0;

  for (const call of terminalCalls) {
    const companyId = call.conversation.companyId;
    const relatedTask = await findRelatedScheduledTask({
      companyId,
      conversationId: call.conversationId,
      metadata: call.metadata,
      providerCallId: call.providerCallId,
      twilioCallSid: call.twilioCallSid,
    });

    if (relatedTask && relatedTask.status === "DOING") {
      terminalCallsWithActiveTasks += 1;
      findings.push({
        kind: "terminal_call_active_task",
        callId: call.id,
        taskId: relatedTask.id,
        conversationId: call.conversationId,
        companyId,
        detail: `Call ${call.status} but Task still DOING`,
        repairable: true,
      });

      if (apply) {
        const sync = await synchronizeRelatedTask({
          companyId,
          conversationId: call.conversationId,
          callId: call.id,
          callStatus: call.status as DbCallStatus,
          metadata: call.metadata,
          providerCallId: call.providerCallId,
          twilioCallSid: call.twilioCallSid,
          endedAt: call.endedAt || call.updatedAt,
          failureReason: call.failureReason,
          endReason: call.endReason,
        });
        applied.push({
          kind: "terminal_call_active_task",
          callId: call.id,
          taskId: relatedTask.id,
          result: sync.updated ? `task_${sync.taskStatus}` : "noop",
        });
      }
    }

    if (
      call.conversation.status === "IN_PROGRESS" ||
      call.conversation.status === "NEW"
    ) {
      staleConversations += 1;
      findings.push({
        kind: "terminal_call_active_conversation",
        callId: call.id,
        conversationId: call.conversationId,
        companyId,
        detail: `Conversation still ${call.conversation.status} after terminal call`,
        repairable: true,
      });

      if (apply) {
        await finalizeCallLifecycle({
          callId: call.id,
          companyId,
          endReason: call.endReason || "reconcile_terminal_call",
          terminalStatus: call.status as DbCallStatus,
          markCompleted: call.status === "COMPLETED",
          source: "RECONCILER",
          humeChatId: call.humeChatId,
        });
        applied.push({
          kind: "terminal_call_active_conversation",
          callId: call.id,
          result: "conversation_finalized",
        });
      }
    }

    if (call.humeChatId) {
      const hasSync = call.humeSyncJobs.some(
        (job) =>
          job.chatId === call.humeChatId &&
          ["PENDING", "PROCESSING", "COMPLETED"].includes(job.status),
      );
      const needsRecording =
        call.recordingReconstructionStatus === "NOT_REQUESTED" ||
        call.recordingReconstructionStatus == null;
      const needsExpression = !call.humeExpressionAnalysis;
      const needsAnalysis = !call.postAnalysis;

      if (!hasSync || needsRecording || needsExpression || needsAnalysis) {
        missingPostCallJobs += 1;
        findings.push({
          kind: "terminal_call_missing_jobs",
          callId: call.id,
          conversationId: call.conversationId,
          companyId,
          detail: [
            !hasSync ? "missing_hume_sync" : null,
            needsRecording ? "missing_recording_queue" : null,
            needsExpression ? "missing_expression" : null,
            needsAnalysis ? "missing_post_analysis" : null,
          ]
            .filter(Boolean)
            .join(","),
          repairable: true,
        });

        if (apply) {
          if (needsAnalysis) {
            await finalizeCallLifecycle({
              callId: call.id,
              companyId,
              endReason: call.endReason || "reconcile_enqueue_jobs",
              terminalStatus: call.status as DbCallStatus,
              markCompleted: call.status === "COMPLETED",
              source: "RECONCILER",
              humeChatId: call.humeChatId,
            });
          }
          const jobs = await enqueuePostCallProcessing({
            callId: call.id,
            companyId,
            humeChatId: call.humeChatId,
            callStatus: call.status as DbCallStatus,
            hasTranscript: Boolean(call.transcript),
          });
          applied.push({
            kind: "terminal_call_missing_jobs",
            callId: call.id,
            result: jobs.join(",") || "noop",
          });
        }
      }
    }
  }

  for (const call of activeCalls) {
    const updatedAt = call.updatedAt || call.createdAt;
    if (updatedAt > staleBefore) continue;
    staleActiveCalls += 1;
    findings.push({
      kind: "stale_active_call",
      callId: call.id,
      conversationId: call.conversationId,
      companyId: call.conversation.companyId,
      detail: `Active ${call.status} older than ${staleMinutes}m; provider verification not auto-completed`,
      repairable: false,
    });
  }

  for (const task of activeTasks) {
    const notes = parseScheduledCallContext(task.aiNotes);
    if (!notes || notes.kind !== AI_CALL_TASK_KIND) continue;

    const relatedCall = notes.callSid
      ? await prisma.call.findFirst({
          where: {
            OR: [
              { providerCallId: notes.callSid },
              { twilioCallSid: notes.callSid },
            ],
            conversation: { companyId: task.companyId },
          },
        })
      : notes.conversationId
        ? await prisma.call.findFirst({
            where: {
              conversationId: notes.conversationId,
              conversation: { companyId: task.companyId },
            },
            orderBy: { createdAt: "desc" },
          })
        : null;

    if (relatedCall && isTerminalCallStatus(relatedCall.status)) {
      // Covered by terminal_call_active_task path; skip duplicate finding noise.
      continue;
    }

    if (!relatedCall && notes.status !== "SCHEDULED") {
      findings.push({
        kind: "active_task_without_call",
        taskId: task.id,
        conversationId: task.conversationId,
        companyId: task.companyId,
        detail: "DOING scheduled-call task has no related Call row",
        repairable: false,
      });
    }
  }

  const report: ReconcileReport = {
    dryRun: !apply,
    scanned: {
      activeTasks: activeTasks.length,
      activeCalls: activeCalls.length,
      terminalCallsWithActiveTasks,
      staleConversations,
      missingPostCallJobs,
      staleActiveCalls,
    },
    findings: findings.map((finding) => ({
      ...finding,
      callId: redact(finding.callId),
      taskId: redact(finding.taskId),
      conversationId: redact(finding.conversationId),
    })),
    applied: apply
      ? applied.map((item) => ({
          ...item,
          callId: redact(item.callId),
          taskId: redact(item.taskId),
        }))
      : [],
  };

  logReconcile(apply ? "reconcile_applied" : "reconcile_dry_run", {
    activeTasks: report.scanned.activeTasks,
    activeCalls: report.scanned.activeCalls,
    findings: report.findings.length,
    applied: report.applied.length,
    companyId: options.companyId ? redact(options.companyId) : null,
  });

  return report;
}
