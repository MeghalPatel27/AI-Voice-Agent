import { prisma } from "../../db/prisma";
import { finalizeCall } from "../../services/callFinalization.service";
import { enqueuePostCallProcessing } from "../../services/callLifecycle.service";
import {
  persistHumeChatCorrelation,
  resolveHumeChatForCall,
} from "./humeChatCorrelation.service";
import {
  fetchAllHumeChatEvents,
  requestHumeChatAudio,
} from "./humeChatHistory.client";
import {
  buildTranscriptText,
  computeExpressionAnalysis,
  countEventTypes,
  eventToTranscriptLine,
} from "./humeChatTranscript.service";
import { queueHumeAudioPoll } from "./humeAudioReconstruction.service";

function getStaleProcessingMs() {
  const raw = Number(process.env.HUME_SYNC_WORKER_STALE_PROCESSING_MS || 120000);
  if (!Number.isFinite(raw)) return 120000;
  return Math.max(30000, raw);
}

async function recoverStaleProcessingJobs() {
  const staleBefore = new Date(Date.now() - getStaleProcessingMs());
  const recovered = await prisma.humeChatSyncJob.updateMany({
    where: {
      status: "PROCESSING",
      startedAt: { lt: staleBefore },
    },
    data: {
      status: "PENDING",
      nextAttemptAt: new Date(),
      lastError: "stale_processing_recovered",
    },
  });
  return recovered.count;
}

export async function enqueueHumeSyncJob(callId: string, chatId: string, companyId: string) {
  const existing = await prisma.humeChatSyncJob.findUnique({
    where: { callId_chatId: { callId, chatId } },
  });

  if (!existing) {
    try {
      await prisma.humeChatSyncJob.create({
        data: {
          callId,
          chatId,
          companyId,
          status: "PENDING",
          nextAttemptAt: new Date(),
        },
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code !== "P2002") throw error;
    }
    return;
  }

  if (existing.status === "FAILED") {
    await prisma.humeChatSyncJob.update({
      where: { id: existing.id },
      data: {
        status: "PENDING",
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
  }
}

export async function syncHumeChatForCall(callId: string) {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { conversation: true },
  });
  if (!call) throw new Error("call_not_found");

  const correlation = await resolveHumeChatForCall(call);
  if (correlation.status !== "MATCHED") {
    throw new Error(`chat_correlation_${correlation.status.toLowerCase()}`);
  }

  if (!call.humeChatId || call.humeChatId !== correlation.chat.id) {
    await persistHumeChatCorrelation({
      callId: call.id,
      chat: correlation.chat,
      evidence: correlation.evidence,
    });
  }

  const { events, totalPages } = await fetchAllHumeChatEvents(correlation.chat.id);
  const lines = events
    .map((event) => eventToTranscriptLine(event))
    .filter((line): line is NonNullable<typeof line> => Boolean(line));

  for (const line of lines) {
    const existing = await prisma.message.findFirst({
      where: {
        conversationId: call.conversationId,
        provider: "hume_evi",
        providerMessageId: line.providerMessageId,
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.message.create({
        data: {
          conversationId: call.conversationId,
          senderType: line.speaker,
          body: line.body,
          provider: "hume_evi",
          providerMessageId: line.providerMessageId,
          providerStatus: line.interrupted ? "interrupted" : "stored",
          createdAt: line.createdAt,
        },
      });
    }
  }

  const transcriptMessages = await prisma.message.findMany({
    where: {
      conversationId: call.conversationId,
      provider: "hume_evi",
      providerStatus: { not: "interrupted" },
    },
    orderBy: { createdAt: "asc" },
  });
  const transcriptLines = transcriptMessages.map((m) => ({
    speaker: m.senderType as "CUSTOMER" | "AI",
    body: m.body,
    providerMessageId: m.providerMessageId || m.id,
    createdAt: m.createdAt,
  }));
  const transcript = buildTranscriptText(transcriptLines);
  const expression = computeExpressionAnalysis(events);
  const eventCounts = countEventTypes(events);

  await prisma.$transaction(async (tx) => {
    await tx.call.update({
      where: { id: call.id },
      data: {
        transcript: transcript || call.transcript,
        transcriptSyncStatus: "COMPLETED",
        humeSyncStatus: "COMPLETED",
        expressionAnalysisStatus: "COMPLETED",
        recordingReconstructionStatus: "QUEUED",
        metadata: {
          ...((call.metadata as Record<string, unknown>) || {}),
          humeEventCount: events.length,
          humeEventPages: totalPages,
          humeEventTypeCounts: eventCounts,
        } as any,
      },
    });
    await tx.conversation.update({
      where: { id: call.conversationId },
      data: {
        lastMessage: transcriptMessages.at(-1)?.body || call.conversation.lastMessage,
        lastMessageAt:
          transcriptMessages.at(-1)?.createdAt || call.conversation.lastMessageAt || new Date(),
      },
    });
    await tx.humeExpressionAnalysis.upsert({
      where: { callId: call.id },
      create: {
        callId: call.id,
        companyId: call.conversation.companyId,
        chatId: correlation.chat.id,
        status: "COMPLETED",
        userTurnCount: expression.userTurnCount,
        averageScores: expression.averages as any,
        topExpressions: expression.topExpressions as any,
        expressionTimeline: expression.timeline as any,
        completedAt: new Date(),
        rawSchemaVersion: "evi_v3",
      },
      update: {
        status: "COMPLETED",
        userTurnCount: expression.userTurnCount,
        averageScores: expression.averages as any,
        topExpressions: expression.topExpressions as any,
        expressionTimeline: expression.timeline as any,
        completedAt: new Date(),
      },
    });
  });

  try {
    const audio = await requestHumeChatAudio(correlation.chat.id);
    const status = String(audio?.status || "QUEUED").toUpperCase();
    await prisma.call.update({
      where: { id: call.id },
      data: {
        recordingSource: "HUME",
        recordingReconstructionStatus:
          status === "COMPLETE"
            ? "COMPLETE"
            : status === "ERROR"
              ? "ERROR"
              : status === "CANCELED"
                ? "CANCELED"
                : status === "IN_PROGRESS"
                  ? "IN_PROGRESS"
                  : "QUEUED",
        recordingStatus: status,
      },
    });
    if (status !== "COMPLETE") {
      await queueHumeAudioPoll(call.id, correlation.chat.id);
    }
  } catch {
    await queueHumeAudioPoll(call.id, correlation.chat.id);
  }

  await enqueuePostCallProcessing({
    callId: call.id,
    companyId: call.conversation.companyId,
    humeChatId: correlation.chat.id,
    callStatus: call.status,
    hasTranscript: Boolean(transcript),
  });

  if (call.status === "COMPLETED" || call.status === "FAILED" || call.status === "MISSED") {
    await finalizeCall({
      callId: call.id,
      companyId: call.conversation.companyId,
      endReason: call.humeEndReason || "hume_chat_synced",
      markCompleted: call.status === "COMPLETED",
    });
  }

  return {
    chatId: correlation.chat.id,
    eventCount: events.length,
    totalPages,
    userMessageCount: eventCounts.USER_MESSAGE || 0,
    agentMessageCount: eventCounts.AGENT_MESSAGE || 0,
    interruptionCount: eventCounts.USER_INTERRUPTION || 0,
    functionCallCount: (eventCounts.FUNCTION_CALL || 0) + (eventCounts.FUNCTION_CALL_RESPONSE || 0),
    transcriptLength: transcript.length,
  };
}

export async function runHumeSyncWorkerOnce(limit = 5) {
  await recoverStaleProcessingJobs();

  const jobs = await prisma.humeChatSyncJob.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  let processed = 0;
  let completed = 0;
  let failed = 0;
  let retried = 0;

  for (const job of jobs) {
    const claimed = await prisma.humeChatSyncJob.updateMany({
      where: { id: job.id, status: "PENDING", updatedAt: job.updatedAt },
      data: { status: "PROCESSING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;
    processed += 1;

    try {
      await syncHumeChatForCall(job.callId);
      await prisma.humeChatSyncJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", completedAt: new Date(), lastError: null },
      });
      completed += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const terminal = attempts >= 5;
      await prisma.humeChatSyncJob.update({
        where: { id: job.id },
        data: {
          status: terminal ? "FAILED" : "PENDING",
          lastError: error instanceof Error ? error.message : "sync_failed",
          nextAttemptAt: terminal ? null : new Date(Date.now() + attempts * 15_000),
        },
      });
      if (terminal) failed += 1;
      else retried += 1;
    }
  }

  return { processed, completed, failed, retried };
}
