import { prisma } from "../../db/prisma";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

function buildTwilioAuthHeader() {
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  return `Basic ${auth}`;
}

export async function proxyTwilioRecordingForCall(callId: string, companyId: string) {
  const call = await prisma.call.findUnique({ where: { id: callId }, include: { conversation: true } });
  if (!call || call.conversation.companyId !== companyId) {
    return { status: 404 as const, body: { message: "Recording not found." } };
  }
  if (!call.recordingUrl) {
    return { status: 404 as const, body: { message: "Recording is still processing. Try again in a few seconds." } };
  }
  const url = call.recordingUrl.endsWith(".mp3") ? call.recordingUrl : `${call.recordingUrl}.mp3`;
  const response = await fetch(url, { headers: { Authorization: buildTwilioAuthHeader() } });
  if (!response.ok) {
    return { status: 502 as const, body: { message: "Could not load Twilio recording media yet." } };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: 200 as const,
    buffer,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=300",
    },
  };
}
