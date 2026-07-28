import { prisma } from "../../db/prisma";
import { shouldApplyCallStatus } from "../../services/callFinalization.service";
import { applyHumeChatEndedLifecycle } from "../../services/callLifecycle.service";
import { getHumeConfig } from "./hume.config";
import { attachHumeChatFromWebhook, findCallByTwilioSid } from "./humeChatCorrelation.service";
import { prewarmAiradeskCallContext, logHumeLatency } from "./humeContextCache.service";
import { handleHumeToolCall } from "./humeTool.service";
import type { HumeWebhookPayload } from "./hume.types";

function normalizePhone(value?: string | null) {
  const v = String(value || "").trim();
  if (!v) return "";
  return v.startsWith("+") ? v : `+${v}`;
}

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

async function resolveInboundCompanyId(_toNumber?: string | null) {
  const cfg = getHumeConfig();
  if (!cfg.voiceCompanyId) throw new Error("voice_company_id_required_for_inbound");
  const company = await prisma.company.findUnique({ where: { id: cfg.voiceCompanyId } });
  if (!company) throw new Error("voice_company_id_not_found");
  return company.id;
}

function scheduleContextPrewarm(input: {
  callId: string;
  companyId: string;
  chatId: string;
}) {
  void prewarmAiradeskCallContext(input).catch(() => undefined);
}

export async function processHumeWebhook(payload: HumeWebhookPayload) {
  const idempotencyKey =
    payload.event_name === "chat_started"
      ? `chat_started:${payload.chat_id}`
      : payload.event_name === "chat_ended"
        ? `chat_ended:${payload.chat_id}:${payload.end_timestamp || "na"}`
        : `tool_call:${payload.chat_id}:${payload.tool_call_message?.tool_call_id || "unknown"}`;

  const receipt = await prisma.humeWebhookReceipt.findUnique({ where: { idempotencyKey } });

  // tool_call: webhook receipt is only an acknowledgement. Always enter the
  // dispatcher so undelivered Control Plane responses can be retried safely
  // without repeating business actions.
  if (receipt && payload.event_name !== "tool_call") {
    return;
  }

  if (!receipt) {
    await prisma.humeWebhookReceipt.create({
      data: {
        idempotencyKey,
        eventType: payload.event_name,
        chatId: payload.chat_id,
      },
    });
  }

  if (payload.event_name === "chat_started") {
    logHumeLatency("hume_chat_started", {
      chatId: redactId(payload.chat_id),
      chatGroupId: redactId(payload.chat_group_id),
      configId: redactId(payload.config_id),
    });

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
      ? await prisma.call.findFirst({
          where: { OR: [{ providerCallId: twilioCallSid }, { twilioCallSid }] },
        })
      : null;

    if (existingBySid) {
      const answeredAt =
        ((existingBySid.metadata as Record<string, unknown>) || {}).answeredAt ||
        new Date().toISOString();
      const updated = await prisma.call.update({
        where: { id: existingBySid.id },
        data: {
          humeChatId: payload.chat_id,
          humeChatGroupId: payload.chat_group_id || null,
          humeConfigId: payload.config_id || null,
          voiceAgentProvider: "HUME_EVI",
          telephonyProvider: "TWILIO",
          twilioCallSid: twilioCallSid || existingBySid.twilioCallSid,
          status: shouldApplyCallStatus(existingBySid.status, "IN_PROGRESS")
            ? "IN_PROGRESS"
            : existingBySid.status,
          metadata: {
            ...((existingBySid.metadata as Record<string, unknown>) || {}),
            answeredAt,
          } as any,
        },
      });
      await prisma.humeWebhookReceipt.update({
        where: { idempotencyKey },
        data: { callId: updated.id, companyId },
      });
      scheduleContextPrewarm({
        callId: updated.id,
        companyId,
        chatId: payload.chat_id,
      });
      return;
    }

    // If a concurrent tool_call already attached this chatId, converge.
    const existingByChat = await prisma.call.findFirst({
      where: { humeChatId: payload.chat_id },
    });
    if (existingByChat) {
      await prisma.humeWebhookReceipt.update({
        where: { idempotencyKey },
        data: { callId: existingByChat.id, companyId },
      });
      scheduleContextPrewarm({
        callId: existingByChat.id,
        companyId,
        chatId: payload.chat_id,
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

    const created = await prisma.call.create({
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
        startedAt: payload.start_timestamp
          ? new Date(payload.start_timestamp * 1000)
          : new Date(),
        metadata: {
          answeredAt: new Date().toISOString(),
        },
      },
    });
    await prisma.humeWebhookReceipt.update({
      where: { idempotencyKey },
      data: { callId: created.id, companyId },
    });
    scheduleContextPrewarm({
      callId: created.id,
      companyId,
      chatId: payload.chat_id,
    });
    return;
  }

  if (payload.event_name === "tool_call") {
    await handleHumeToolCall(payload);
    return;
  }

  if (payload.event_name === "chat_ended") {
    logHumeLatency("chat_ended", {
      chatId: redactId(payload.chat_id),
      endReason: String((payload as { end_reason?: string }).end_reason || "chat_ended"),
    });
    await applyHumeChatEndedLifecycle({
      chatId: payload.chat_id,
      endReason: String((payload as { end_reason?: string }).end_reason || "chat_ended"),
      endTimestamp: payload.end_timestamp || null,
    });
  }
}
