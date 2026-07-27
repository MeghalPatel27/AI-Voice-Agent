import { prisma } from "../../db/prisma";
import { mapTwilioStatusToCallStatus } from "../../services/callFinalization.service";
import { buildHumeTwilioUrl, redactUrlForLogs } from "../hume/hume.config";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";

function twilioAuthHeader() {
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  return `Basic ${auth}`;
}

function normalizePhoneNumber(value: string) {
  const clean = value.replace(/[^\d+]/g, "").trim();
  if (!clean) return "";
  return clean.startsWith("+") ? clean : `+${clean}`;
}

export async function startHumeOutboundCall(input: {
  companyId: string;
  requestedBy: string | null;
  fullName?: string;
  phone: string;
  purpose?: string;
  notes?: string;
  preferredTime?: string;
  preferredLanguage?: string;
  publicWebhookUrl: string;
}) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    throw new Error("twilio_outbound_not_configured");
  }
  const phone = normalizePhoneNumber(input.phone);
  if (!phone.startsWith("+")) throw new Error("invalid_phone_number");

  const customerExisting = await prisma.customer.findFirst({
    where: { companyId: input.companyId, phone },
  });
  const customer = customerExisting
    ? await prisma.customer.update({
        where: { id: customerExisting.id },
        data: { fullName: input.fullName || customerExisting.fullName },
      })
    : await prisma.customer.create({
        data: { companyId: input.companyId, fullName: input.fullName || "Unknown Customer", phone, source: "ai_call" },
      });

  const conversation = await prisma.conversation.create({
    data: {
      companyId: input.companyId,
      customerId: customer.id,
      channel: "AI_CALL",
      status: "IN_PROGRESS",
      priority: "HIGH",
      intent: input.purpose || "Outbound AI requirement call",
      aiSummary: "Outbound AI call requested from CRM via Hume EVI.",
      nextAction: "AI is calling lead via Hume EVI.",
      provider: "hume_evi",
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderType: "AI",
      body: `Outbound AI call requested.\nPhone: ${phone}\nPurpose: ${input.purpose || "-"}\nPreferred language: ${input.preferredLanguage || "AUTO"}`,
    },
  });

  const humeTwilioUrl = buildHumeTwilioUrl();
  const statusCallback = `${input.publicWebhookUrl.replace(/\/$/, "")}/api/voice/twilio/status`;
  const body = new URLSearchParams({
    To: phone,
    From: TWILIO_PHONE_NUMBER,
    Url: humeTwilioUrl,
    Method: "POST",
    StatusCallback: statusCallback,
    StatusCallbackMethod: "POST",
  });
  body.append("StatusCallbackEvent", "queued");
  body.append("StatusCallbackEvent", "initiated");
  body.append("StatusCallbackEvent", "ringing");
  body.append("StatusCallbackEvent", "answered");
  body.append("StatusCallbackEvent", "completed");

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`, {
    method: "POST",
    headers: { Authorization: twilioAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json: any = await response.json();
  if (!response.ok) throw new Error(`twilio_outbound_failed:${json?.message || response.status}`);

  const callSid = String(json.sid || "");
  const initial = mapTwilioStatusToCallStatus(String(json.status || "queued"), "OUTBOUND");
  const call = await prisma.call.create({
    data: {
      conversationId: conversation.id,
      phone,
      provider: "twilio",
      providerCallId: callSid || null,
      twilioCallSid: callSid || null,
      direction: "OUTBOUND",
      status: initial === "IN_PROGRESS" ? "RINGING" : initial,
      telephonyProvider: "TWILIO",
      voiceAgentProvider: "HUME_EVI",
      humeConfigId: process.env.HUME_CONFIG_ID || null,
      startedAt: new Date(),
      recordingSource: "HUME",
      recordingReconstructionStatus: "NOT_REQUESTED",
      metadata: {
        requestedBy: input.requestedBy,
        purpose: input.purpose || null,
        notes: input.notes || null,
        preferredTime: input.preferredTime || null,
        preferredLanguage: input.preferredLanguage || null,
        humeTwilioUrl: redactUrlForLogs(humeTwilioUrl),
      } as any,
    },
  });
  return { call, conversation, customer, callSid, status: json.status };
}
