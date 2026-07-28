import { prisma } from "../../db/prisma";
import { getHumeChatHistoryConfig } from "./humeChatHistory.config";
import { requestHumeChatAudio } from "./humeChatHistory.client";

const pendingAudioPolls = new Map<string, NodeJS.Timeout>();

function mapAudioStatus(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "COMPLETE") return "COMPLETE" as const;
  if (normalized === "ERROR") return "ERROR" as const;
  if (normalized === "CANCELED") return "CANCELED" as const;
  if (normalized === "IN_PROGRESS") return "IN_PROGRESS" as const;
  return "QUEUED" as const;
}

export async function pollHumeAudioForCall(callId: string, chatId: string, attempt = 1) {
  const runtime = getHumeChatHistoryConfig();
  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call) return;

  try {
    const audio = await requestHumeChatAudio(chatId);
    const status = mapAudioStatus(String(audio?.status || "QUEUED"));
    await prisma.call.update({
      where: { id: callId },
      data: {
        recordingSource: "HUME",
        recordingReconstructionStatus: status,
        recordingStatus: String(audio?.status || status),
        metadata: {
          ...((call.metadata as Record<string, unknown>) || {}),
          humeAudioLastCheckedAt: new Date().toISOString(),
          humeAudioPollAttempt: attempt,
        } as any,
      },
    });

    if (status === "COMPLETE" || status === "ERROR" || status === "CANCELED") {
      pendingAudioPolls.delete(callId);
      return;
    }
  } catch {
    if (attempt >= runtime.audioPollMaxAttempts) {
      await prisma.call.update({
        where: { id: callId },
        data: { recordingReconstructionStatus: "ERROR" },
      });
      pendingAudioPolls.delete(callId);
      return;
    }
  }

  if (attempt >= runtime.audioPollMaxAttempts) {
    pendingAudioPolls.delete(callId);
    return;
  }

  const delay = runtime.audioPollBaseMs * attempt;
  const timer = setTimeout(() => {
    void pollHumeAudioForCall(callId, chatId, attempt + 1);
  }, delay);
  pendingAudioPolls.set(callId, timer);
}

export async function queueHumeAudioPoll(callId: string, chatId: string) {
  if (pendingAudioPolls.has(callId)) return;
  const runtime = getHumeChatHistoryConfig();
  const timer = setTimeout(() => {
    void pollHumeAudioForCall(callId, chatId, 1);
  }, runtime.audioPollBaseMs);
  pendingAudioPolls.set(callId, timer);
  await prisma.call.update({
    where: { id: callId },
    data: { recordingReconstructionStatus: "QUEUED" },
  });
}

export function stopHumeAudioPoll(callId: string) {
  const timer = pendingAudioPolls.get(callId);
  if (timer) clearTimeout(timer);
  pendingAudioPolls.delete(callId);
}
