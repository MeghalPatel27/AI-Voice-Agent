import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { buildAiradeskCallContext } from "../../services/callContext.service";
import { sendHumeToolResponse } from "./hume.client";
import {
  captureLeadSchema,
  handoffSchema,
  scheduleMeetingSchema,
} from "./humeToolSchemas";
import type { HumeWebhookPayload } from "./hume.types";

function parseToolParams(raw: string | undefined) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid_tool_params_json");
  }
}

function controlPlanePayload(toolCallId: string, content: unknown, isError = false) {
  if (isError) {
    return { type: "tool_error", tool_call_id: toolCallId, content: JSON.stringify(content) };
  }
  return { type: "tool_response", tool_call_id: toolCallId, content: JSON.stringify(content) };
}

export async function handleHumeToolCall(payload: HumeWebhookPayload) {
  const tool = payload.tool_call_message;
  if (!tool?.tool_call_id || !tool.name) {
    throw new Error("invalid_tool_payload");
  }
  const chatId = payload.chat_id;
  const call = await prisma.call.findFirst({
    where: { humeChatId: chatId },
    include: { conversation: { include: { customer: true } } },
  });
  if (!call) {
    await sendHumeToolResponse(
      chatId,
      controlPlanePayload(
        tool.tool_call_id,
        {
          ok: false,
          code: "CALL_CONTEXT_NOT_FOUND",
          error: "Unable to resolve call context for this chat.",
        },
        true,
      ),
    );
    return;
  }

  const existing = await prisma.humeToolCallReceipt.findUnique({
    where: { toolCallId: tool.tool_call_id },
  });
  if (existing) return;

  await prisma.humeToolCallReceipt.create({
    data: {
      toolCallId: tool.tool_call_id,
      chatId,
      callId: call.id,
      companyId: call.conversation.companyId,
      toolName: tool.name,
      status: "PROCESSING",
    },
  });

  try {
    const params = parseToolParams(tool.parameters);
    let result: unknown = { ok: true };
    if (tool.name === "airadesk_get_call_context") {
      if (Object.keys(params).length > 0) {
        throw new Error("context_tool_does_not_accept_parameters");
      }
      result = await buildAiradeskCallContext(call.id, call.conversation.companyId);
    } else if (tool.name === "airadesk_capture_lead_details") {
      const parsed = captureLeadSchema.parse(params);
      await prisma.$transaction(async (tx) => {
        if (call.conversation.customerId) {
          await tx.customer.update({
            where: { id: call.conversation.customerId },
            data: {
              fullName: parsed.fullName || undefined,
              metadata: {
                ...(call.conversation.customer?.metadata as Record<string, unknown> | null),
                businessType: parsed.businessType,
                requiredServices: parsed.requiredServices,
                budget: parsed.budget,
                timeline: parsed.timeline,
                preferredLanguage: parsed.preferredLanguage,
              } as Prisma.InputJsonValue,
              notes: [call.conversation.customer?.notes || "", parsed.additionalNotes || ""]
                .filter(Boolean)
                .join("\n")
                .slice(0, 4000),
            },
          });
        }
        await tx.conversation.update({
          where: { id: call.conversationId },
          data: {
            aiSummary: parsed.requirementSummary || call.conversation.aiSummary,
            nextAction: parsed.preferredMeetingTime
              ? `Confirm meeting for ${parsed.preferredMeetingTime}`
              : call.conversation.nextAction,
          },
        });
      });
      result = { ok: true, captured: true };
    } else if (tool.name === "airadesk_schedule_meeting") {
      const parsed = scheduleMeetingSchema.parse(params);
      const date = new Date(parsed.preferredTimeText);
      if (Number.isNaN(date.getTime())) {
        result = {
          ok: false,
          needsClarification: true,
          message: "Please provide a clear date and time.",
        };
      } else {
        await prisma.$transaction(async (tx) => {
          await tx.booking.create({
            data: {
              companyId: call.conversation.companyId,
              customerId: call.conversation.customerId,
              conversationId: call.conversationId,
              callId: call.id,
              title: parsed.purpose || "AI Call Meeting",
              dateTime: date,
              timezone: parsed.timezone || undefined,
              purpose: parsed.purpose || undefined,
              notes: parsed.notes || undefined,
              status: "REQUESTED",
              acceptanceStatus: "PENDING_ACCEPTANCE",
              nextAction: "Confirm meeting details with customer.",
            },
          });
          await tx.conversation.update({
            where: { id: call.conversationId },
            data: { bookingCreated: true },
          });
        });
        result = { ok: true, meetingCreated: true, scheduledAt: date.toISOString() };
      }
    } else if (tool.name === "airadesk_request_human_handoff") {
      const parsed = handoffSchema.parse(params);
      await prisma.conversation.update({
        where: { id: call.conversationId },
        data: {
          humanNeeded: true,
          status: "HUMAN_REQUIRED",
          nextAction: `Human handoff requested: ${parsed.reason} (${parsed.urgency})`,
        },
      });
      result = { ok: true, handoffRequested: true };
    } else {
      result = { ok: false, unsupportedTool: tool.name };
    }

    await sendHumeToolResponse(chatId, controlPlanePayload(tool.tool_call_id, result));
    await prisma.humeToolCallReceipt.update({
      where: { toolCallId: tool.tool_call_id },
      data: { status: "COMPLETED", error: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "tool_failed";
    await sendHumeToolResponse(
      chatId,
      controlPlanePayload(
        tool.tool_call_id,
        { ok: false, code: "TOOL_EXECUTION_ERROR", error: message },
        true,
      ),
    );
    await prisma.humeToolCallReceipt.update({
      where: { toolCallId: tool.tool_call_id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : "tool_failed" },
    });
  }
}
