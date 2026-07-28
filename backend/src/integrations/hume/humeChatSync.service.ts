import { prisma } from "../../db/prisma";
import { finalizeCall } from "../../services/callFinalization.service";
import { listHumeChatEvents } from "./hume.client";
import type { HumeChatEvent } from "./hume.types";
import type { MessageSender } from "@prisma/client";

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

function eventToMessage(event: HumeChatEvent) {
  const role = event.message?.role || event.role;
  const body = String(event.message?.content || "").trim();
  if (!body) return null;
  if (role === "system") return null;
  if (role !== "user" && role !== "assistant") return null;
  return {
    senderType: (role === "user" ? "CUSTOMER" : "AI") as MessageSender,
    body,
    providerMessageId: String(event.id || ""),
    createdAt: event.message?.timestamp ? new Date(event.message.timestamp * 1000) : new Date(),
  };
}

function parseEmotionFeatures(raw: unknown): Record<string, number> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return parseEmotionFeatures(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
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

  // Idempotent: only re-queue failed jobs. Never reopen COMPLETED/PROCESSING.
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

export async function runHumeSyncWorkerOnce(limit = 5) {
  await recoverStaleProcessingJobs();

  const jobs = await prisma.humeChatSyncJob.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
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
      const call = await prisma.call.findUnique({
        where: { id: job.callId },
        include: { conversation: true },
      });
      if (!call) throw new Error("call_not_found");

      const events: HumeChatEvent[] = [];
      let page = 0;
      let totalPages = 1;
      while (page < totalPages) {
        const response = await listHumeChatEvents(job.chatId, page);
        const pageEvents = Array.isArray(response?.events) ? response.events : [];
        events.push(...pageEvents);
        totalPages = Number(response?.total_pages || 1);
        page += 1;
      }

      for (const event of events) {
        const msg = eventToMessage(event);
        if (!msg || !msg.providerMessageId) continue;
        const existing = await prisma.message.findFirst({
          where: {
            conversationId: call.conversationId,
            provider: "hume_evi",
            providerMessageId: msg.providerMessageId,
          },
          select: { id: true },
        });
        if (!existing) {
          await prisma.message.create({
            data: {
              conversationId: call.conversationId,
              senderType: msg.senderType,
              body: msg.body,
              provider: "hume_evi",
              providerMessageId: msg.providerMessageId,
              providerStatus: "stored",
              createdAt: msg.createdAt,
            },
          });
        }
      }

      const transcriptMessages = await prisma.message.findMany({
        where: { conversationId: call.conversationId, provider: "hume_evi" },
        orderBy: { createdAt: "asc" },
      });
      const transcript = transcriptMessages
        .map((m) => `${m.senderType === "CUSTOMER" ? "CUSTOMER" : "AI"}: ${m.body}`)
        .join("\n");

      const userEmotionEvents = events
        .filter((e) => (e.message?.role || e.role) === "user")
        .map((e) => parseEmotionFeatures(e.emotion_features))
        .filter((e) => Object.keys(e).length > 0);

      const totals: Record<string, number> = {};
      for (const row of userEmotionEvents) {
        for (const [k, v] of Object.entries(row)) totals[k] = (totals[k] || 0) + v;
      }
      const count = userEmotionEvents.length || 1;
      const averages: Record<string, number> = {};
      for (const [k, v] of Object.entries(totals)) averages[k] = Number((v / count).toFixed(4));
      const topExpressions = Object.entries(averages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, score]) => ({ name, score }));

      await prisma.$transaction(async (tx) => {
        await tx.call.update({
          where: { id: call.id },
          data: {
            transcript: transcript || call.transcript,
            transcriptSyncStatus: "COMPLETED",
            humeSyncStatus: "COMPLETED",
            expressionAnalysisStatus: "COMPLETED",
          },
        });
        await tx.conversation.update({
          where: { id: call.conversationId },
          data: {
            lastMessage: transcriptMessages.at(-1)?.body || call.conversation.lastMessage,
            lastMessageAt: transcriptMessages.at(-1)?.createdAt || call.conversation.lastMessageAt || new Date(),
          },
        });
        await tx.humeExpressionAnalysis.upsert({
          where: { callId: call.id },
          create: {
            callId: call.id,
            companyId: job.companyId,
            chatId: job.chatId,
            status: "COMPLETED",
            userTurnCount: userEmotionEvents.length,
            averageScores: averages as any,
            topExpressions: topExpressions as any,
            expressionTimeline: userEmotionEvents as any,
            completedAt: new Date(),
            rawSchemaVersion: "evi_v3",
          },
          update: {
            status: "COMPLETED",
            userTurnCount: userEmotionEvents.length,
            averageScores: averages as any,
            topExpressions: topExpressions as any,
            expressionTimeline: userEmotionEvents as any,
            completedAt: new Date(),
          },
        });
        await tx.humeChatSyncJob.update({
          where: { id: job.id },
          data: { status: "COMPLETED", completedAt: new Date(), lastError: null },
        });
      });

      await finalizeCall({
        callId: call.id,
        companyId: job.companyId,
        endReason: call.humeEndReason || "hume_chat_ended",
        markCompleted: true,
      });
      // Task sync happens inside finalizeCall; post-call jobs already queued by chat_ended.
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
