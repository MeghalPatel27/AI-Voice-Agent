import type { Call } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { getHumeConfig } from "./hume.config";
import { getHumeChatHistoryConfig } from "./humeChatHistory.config";
import {
  getHumeChat,
  listHumeChats,
  type HumeChatSummary,
} from "./humeChatHistory.client";

export type HumeChatCorrelationResult =
  | {
      status: "MATCHED";
      chat: HumeChatSummary;
      evidence: CorrelationEvidence;
    }
  | {
      status: "NEEDS_REVIEW";
      reason: string;
      candidateCount: number;
      candidates: Array<{ chatId: string; reason: string }>;
    }
  | {
      status: "NOT_FOUND";
      reason: string;
      candidateCount: number;
    };

export type CorrelationEvidence = {
  method: "stored_chat_id" | "twilio_call_sid" | "reconciled_twilio_call_sid";
  twilioCallSid: string | null;
  configIdMatch: boolean;
  timestampDeltaMs: number | null;
  chatStartMs: number | null;
  callStartMs: number | null;
};

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function callWindowMs(call: Pick<Call, "startedAt" | "createdAt" | "endedAt">) {
  const start = call.startedAt || call.createdAt;
  const end = call.endedAt || new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function isTimestampCompatible(
  call: Pick<Call, "startedAt" | "createdAt" | "endedAt">,
  chat: HumeChatSummary,
) {
  if (!chat.startTimestampMs) return true;
  const windowSeconds = getHumeChatHistoryConfig().matchTimeWindowSeconds;
  const { startMs, endMs } = callWindowMs(call);
  const padMs = windowSeconds * 1000;
  return (
    chat.startTimestampMs >= startMs - padMs &&
    chat.startTimestampMs <= endMs + padMs
  );
}

function configMatches(chat: HumeChatSummary) {
  const configured = getHumeConfig().configId;
  if (!configured || !chat.configId) return true;
  return chat.configId === configured;
}

function scoreCandidate(
  call: Pick<Call, "providerCallId" | "twilioCallSid" | "direction" | "startedAt" | "createdAt" | "endedAt">,
  chat: HumeChatSummary,
): { exact: boolean; reason: string } {
  const sid = call.providerCallId || call.twilioCallSid;
  if (!sid || !chat.twilioCallSid || chat.twilioCallSid !== sid) {
    return { exact: false, reason: "twilio_sid_mismatch" };
  }
  if (!configMatches(chat)) {
    return { exact: false, reason: "config_id_mismatch" };
  }
  if (!isTimestampCompatible(call, chat)) {
    return { exact: false, reason: "timestamp_incompatible" };
  }
  if (call.direction && chat.direction) {
    const normalized = call.direction.toUpperCase();
    const chatDir = chat.direction.toLowerCase();
    const compatible =
      (normalized === "OUTBOUND" && chatDir.includes("outbound")) ||
      (normalized === "INBOUND" && chatDir.includes("inbound")) ||
      chatDir === "";
    if (!compatible) {
      return { exact: false, reason: "direction_incompatible" };
    }
  }
  return { exact: true, reason: "twilio_sid_exact" };
}

export function buildEvidence(
  method: CorrelationEvidence["method"],
  call: Pick<Call, "providerCallId" | "twilioCallSid" | "startedAt" | "createdAt">,
  chat: HumeChatSummary,
): CorrelationEvidence {
  const callStartMs = (call.startedAt || call.createdAt).getTime();
  return {
    method,
    twilioCallSid: call.providerCallId || call.twilioCallSid,
    configIdMatch: configMatches(chat),
    timestampDeltaMs:
      chat.startTimestampMs != null ? chat.startTimestampMs - callStartMs : null,
    chatStartMs: chat.startTimestampMs,
    callStartMs,
  };
}

export async function resolveHumeChatForCall(call: Call): Promise<HumeChatCorrelationResult> {
  if (call.humeChatId) {
    try {
      const chat = await getHumeChat(call.humeChatId);
      if (!configMatches(chat)) {
        return {
          status: "NEEDS_REVIEW",
          reason: "stored_chat_config_mismatch",
          candidateCount: 1,
          candidates: [{ chatId: redactId(chat.id) || chat.id, reason: "config_id_mismatch" }],
        };
      }
      const sid = call.providerCallId || call.twilioCallSid;
      if (chat.twilioCallSid && sid && chat.twilioCallSid !== sid) {
        return {
          status: "NEEDS_REVIEW",
          reason: "stored_chat_twilio_sid_mismatch",
          candidateCount: 1,
          candidates: [{ chatId: redactId(chat.id) || chat.id, reason: "twilio_sid_mismatch" }],
        };
      }
      return {
        status: "MATCHED",
        chat,
        evidence: buildEvidence("stored_chat_id", call, chat),
      };
    } catch {
      return {
        status: "NOT_FOUND",
        reason: "stored_chat_not_found",
        candidateCount: 0,
      };
    }
  }

  const sid = call.providerCallId || call.twilioCallSid;
  if (!sid) {
    return { status: "NOT_FOUND", reason: "missing_provider_call_sid", candidateCount: 0 };
  }

  const exactCandidates: HumeChatSummary[] = [];
  let page = 0;
  let totalPages = 1;
  const runtime = getHumeChatHistoryConfig();
  const lookbackMs = runtime.reconcileLookbackDays * 24 * 60 * 60 * 1000;
  const minStartMs = Date.now() - lookbackMs;

  while (page < totalPages && page < runtime.syncMaxPages) {
    const listed = await listHumeChats({ pageNumber: page, ascendingOrder: false });
    totalPages = listed.totalPages;
    for (const chat of listed.chats) {
      if (chat.startTimestampMs && chat.startTimestampMs < minStartMs) continue;
      const scored = scoreCandidate(call, chat);
      if (scored.exact) exactCandidates.push(chat);
    }
    page += 1;
    if (listed.chats.every((c) => c.startTimestampMs && c.startTimestampMs < minStartMs)) {
      break;
    }
  }

  if (exactCandidates.length === 0) {
    return { status: "NOT_FOUND", reason: "zero_exact_candidates", candidateCount: 0 };
  }
  if (exactCandidates.length > 1) {
    return {
      status: "NEEDS_REVIEW",
      reason: "multiple_exact_candidates",
      candidateCount: exactCandidates.length,
      candidates: exactCandidates.map((c) => ({
        chatId: redactId(c.id) || c.id,
        reason: "twilio_sid_exact",
      })),
    };
  }

  const matched = exactCandidates[0];
  if (!matched) {
    return { status: "NOT_FOUND", reason: "zero_exact_candidates", candidateCount: 0 };
  }

  return {
    status: "MATCHED",
    chat: matched,
    evidence: buildEvidence("twilio_call_sid", call, matched),
  };
}

export async function persistHumeChatCorrelation(input: {
  callId: string;
  chat: HumeChatSummary;
  evidence: CorrelationEvidence;
}) {
  const existing = await prisma.call.findFirst({
    where: {
      humeChatId: input.chat.id,
      NOT: { id: input.callId },
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error("hume_chat_already_attached");
  }

  await prisma.call.update({
    where: { id: input.callId },
    data: {
      humeChatId: input.chat.id,
      humeChatGroupId: input.chat.chatGroupId,
      humeConfigId: input.chat.configId || undefined,
      voiceAgentProvider: "HUME_EVI",
      telephonyProvider: "TWILIO",
      metadata: {
        humeCorrelationMethod: input.evidence.method,
        humeCorrelationAt: new Date().toISOString(),
        humeTimestampDeltaMs: input.evidence.timestampDeltaMs,
      },
    },
  });
}

export async function findCallByTwilioSid(twilioCallSid: string) {
  return prisma.call.findFirst({
    where: {
      OR: [{ providerCallId: twilioCallSid }, { twilioCallSid }],
    },
    include: { conversation: true },
  });
}

export async function attachHumeChatFromWebhook(input: {
  chatId: string;
  chatGroupId?: string | null;
  configId?: string | null;
  twilioCallSid?: string | null;
  requestId?: string | null;
}) {
  if (input.twilioCallSid) {
    const call = await findCallByTwilioSid(input.twilioCallSid);
    if (call) {
      const conflict = await prisma.call.findFirst({
        where: { humeChatId: input.chatId, NOT: { id: call.id } },
      });
      if (conflict) throw new Error("hume_chat_id_conflict");

      await prisma.call.update({
        where: { id: call.id },
        data: {
          humeChatId: input.chatId,
          humeChatGroupId: input.chatGroupId || call.humeChatGroupId,
          humeConfigId: input.configId || call.humeConfigId,
          voiceAgentProvider: "HUME_EVI",
          telephonyProvider: "TWILIO",
        },
      });
      return call.id;
    }
  }

  const byChat = await prisma.call.findFirst({ where: { humeChatId: input.chatId } });
  return byChat?.id || null;
}
