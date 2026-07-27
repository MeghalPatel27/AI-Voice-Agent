import { prisma } from "../../db/prisma";
import { finalizeCall, mapTwilioStatusToCallStatus, shouldApplyCallStatus } from "../../services/callFinalization.service";
import { enqueueHumeSyncJob } from "./humeChatSync.service";
import { getHumeConfig } from "./hume.config";
import { handleHumeToolCall } from "./humeTool.service";
import type { HumeWebhookPayload } from "./hume.types";

function normalizePhone(value?: string | null) {
  const v = String(value || "").trim();
  if (!v) return "";
  return v.startsWith("+") ? v : `+${v}`;
}

async function resolveInboundCompanyId(toNumber?: string | null) {
  const cfg = getHumeConfig();
  if (!cfg.voiceCompanyId) throw new Error("voice_company_id_required_for_inbound");
  const company = await prisma.company.findUnique({ where: { id: cfg.voiceCompanyId } });
  if (!company) throw new Error("voice_company_id_not_found");
  return company.id;
}

export async function processHumeWebhook(payload: HumeWebhookPayload) {
  const idempotencyKey =
    payload.event_name === "chat_started"
      ? `chat_started:${payload.chat_id}`
      : payload.event_name === "chat_ended"
        ? `chat_ended:${payload.chat_id}:${payload.end_timestamp || "na"}`
        : `tool_call:${payload.chat_id}:${payload.tool_call_message?.tool_call_id || "unknown"}`;

  const receipt = await prisma.humeWebhookReceipt.findUnique({ where: { idempotencyKey } });
  if (receipt) return;

  await prisma.humeWebhookReceipt.create({
    data: {
      idempotencyKey,
      eventType: payload.event_name,
      chatId: payload.chat_id,
    },
  });

  if (payload.event_name === "chat_started") {
    const twilioCallSid = payload.twilio_metadata?.call_sid || undefined;
    const from = normalizePhone(payload.caller_number || payload.twilio_metadata?.from_number);
    const to = normalizePhone(payload.twilio_metadata?.to_number);
    const companyId = await resolveInboundCompanyId(to);
    const customerExisting = await prisma.customer.findFirst({
      where: { companyId, phone: from || "unknown" },
    });
    const customer = customerExisting
      ? customerExisting
      : await prisma.customer.create({
          data: {
            companyId,
            phone: from || "unknown",
            fullName: "Unknown Caller",
            source: "ai_call",
          },
        });

    const existingBySid = twilioCallSid
      ? await prisma.call.findFirst({ where: { OR: [{ providerCallId: twilioCallSid }, { twilioCallSid }] } })
      : null;

    if (existingBySid) {
      await prisma.call.update({
        where: { id: existingBySid.id },
        data: {
          humeChatId: payload.chat_id,
          humeChatGroupId: payload.chat_group_id || null,
          humeConfigId: payload.config_id || null,
          voiceAgentProvider: "HUME_EVI",
          telephonyProvider: "TWILIO",
          twilioCallSid: twilioCallSid || existingBySid.twilioCallSid,
          status: shouldApplyCallStatus(existingBySid.status, "IN_PROGRESS") ? "IN_PROGRESS" : existingBySid.status,
        },
      });
      return;
    }

    const conversation = await prisma.conversation.create({
      data: {
        companyId,
        customerId: customer.id,
        channel: "AI_CALL",
        status: "IN_PROGRESS",
        priority: "HIGH",
        intent: "Hume inbound call",
        aiSummary: "Hume EVI call in progress.",
        nextAction: "Await transcript synchronization.",
        provider: "hume_evi",
      },
    });

    await prisma.call.create({
      data: {
        conversationId: conversation.id,
        phone: from || "unknown",
        status: "IN_PROGRESS",
        direction: "INBOUND",
        provider: "twilio",
        providerCallId: twilioCallSid || null,
        twilioCallSid: twilioCallSid || null,
        telephonyProvider: "TWILIO",
        voiceAgentProvider: "HUME_EVI",
        humeChatId: payload.chat_id,
        humeChatGroupId: payload.chat_group_id || null,
        humeConfigId: payload.config_id || null,
        startedAt: payload.start_timestamp ? new Date(payload.start_timestamp * 1000) : new Date(),
      },
    });
    return;
  }

  if (payload.event_name === "tool_call") {
    await handleHumeToolCall(payload);
    return;
  }

  if (payload.event_name === "chat_ended") {
    const call = await prisma.call.findFirst({ where: { humeChatId: payload.chat_id }, include: { conversation: true } });
    if (!call) return;
    const terminal = mapTwilioStatusToCallStatus("completed", call.direction);
    await prisma.call.update({
      where: { id: call.id },
      data: {
        humeEndReason: String((payload as any).end_reason || "chat_ended"),
        endedAt: payload.end_timestamp ? new Date(payload.end_timestamp * 1000) : call.endedAt || new Date(),
        status: shouldApplyCallStatus(call.status, terminal) ? terminal : call.status,
        humeSyncStatus: "PENDING",
        transcriptSyncStatus: "PENDING",
        expressionAnalysisStatus: "PENDING",
      },
    });
    await enqueueHumeSyncJob(call.id, payload.chat_id, call.conversation.companyId);
  }
}
