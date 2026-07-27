import { prisma } from "../../db/prisma";
import { getHumeChatAudio } from "./hume.client";

export async function getHumeRecordingMediaForCall(callId: string, companyId: string) {
  const call = await prisma.call.findFirst({
    where: { id: callId, conversation: { companyId } },
  });
  if (!call) return { status: 404 as const, body: { message: "Recording not found." } };
  if (!call.humeChatId) return { status: 404 as const, body: { message: "Hume chat not available." } };

  const audio = await getHumeChatAudio(call.humeChatId);
  const status = String(audio?.status || "QUEUED").toUpperCase();
  const signedUrl = audio?.signed_audio_url || audio?.signed_url || null;

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
      metadata: {
        ...((call.metadata as Record<string, unknown>) || {}),
        humeAudioLastCheckedAt: new Date().toISOString(),
        humeAudioSignedUrlExpiresAt: audio?.signed_url_expiration_timestamp || null,
      } as any,
    },
  });

  if (!signedUrl || status !== "COMPLETE") {
    return { status: 409 as const, body: { message: "Recording is being prepared." } };
  }

  const response = await fetch(signedUrl);
  if (!response.ok) {
    return { status: 502 as const, body: { message: "Failed to fetch Hume recording media." } };
  }
  const contentType = response.headers.get("content-type") || "audio/mpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: 200 as const,
    buffer,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=60",
    },
  };
}
