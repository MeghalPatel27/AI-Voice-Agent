import type { HumeWebhookPayload } from "./hume.types";
import { prisma } from "../../db/prisma";
import { applyHumeChatEndedLifecycle } from "../../services/callLifecycle.service";
import { bootstrapInboundVoiceCall } from "../../services/bootstrapInboundVoiceCall.service";
import { logHumeLatency } from "./humeContextCache.service";
import { handleHumeToolCall } from "./humeTool.service";

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

export async function processHumeWebhook(payload: HumeWebhookPayload) {
  const idempotencyKey =
    payload.event_name === "chat_started"
      ? `chat_started:${payload.chat_id}`
      : payload.event_name === "chat_ended"
        ? `chat_ended:${payload.chat_id}:${payload.end_timestamp || "na"}`
        : `tool_call:${payload.chat_id}:${payload.tool_call_message?.tool_call_id || "unknown"}`;

  const receipt = await prisma.humeWebhookReceipt.findUnique({
    where: { idempotencyKey },
  });

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
    const from = normalizePhone(
      payload.caller_number || payload.twilio_metadata?.from_number,
    );
    const to = normalizePhone(payload.twilio_metadata?.to_number);
    const bootstrapped = await bootstrapInboundVoiceCall({
      providerCallId: twilioCallSid || "",
      callerPhone: from,
      calledNumber: to || null,
      direction: "INBOUND",
      humeChatId: payload.chat_id,
      humeChatGroupId: payload.chat_group_id || null,
      humeConfigId: payload.config_id || null,
      humeRequestId:
        typeof payload.request_id === "string" ? payload.request_id : null,
      startedAt: payload.start_timestamp
        ? new Date(payload.start_timestamp * 1000)
        : new Date(),
    });

    await prisma.humeWebhookReceipt.update({
      where: { idempotencyKey },
      data: {
        callId: bootstrapped.call.id,
        companyId: bootstrapped.companyId,
      },
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
