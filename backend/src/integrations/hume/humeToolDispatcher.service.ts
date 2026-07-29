import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { buildInboundFallbackCallContext } from "../../services/callContext.service";
import { getHumeConfig } from "./hume.config";
import {
  HumeControlPlaneError,
  getHumeChatStatus,
  sendHumeToolResponse,
  type HumeToolControlPlaneMessage,
} from "./hume.client";
import {
  invalidateAiradeskCallContextCache,
  loadAiradeskCallContextFast,
  logHumeLatency,
} from "./humeContextCache.service";
import {
  captureLeadSchema,
  handoffSchema,
  scheduleMeetingSchema,
} from "./humeToolSchemas";
import { scheduleMeetingForVerifiedCall } from "../../services/humeMeetingScheduling.service";
import {
  armPostMeetingTermination,
  runPostMeetingTerminationWatchdog,
} from "../../services/callTermination.service";
import { getHumeToolRuntimeConfig } from "./humeToolRuntime.config";
import type { HumeWebhookPayload } from "./hume.types";

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function parseToolParams(raw: string | undefined) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid_tool_params_json");
  }
}

function controlPlanePayload(
  toolCallId: string,
  content: unknown,
  isError = false,
): HumeToolControlPlaneMessage {
  if (isError) {
    return {
      type: "tool_error",
      tool_call_id: toolCallId,
      content: JSON.stringify(content),
    };
  }
  return {
    type: "tool_response",
    tool_call_id: toolCallId,
    content: JSON.stringify(content),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function findCallForToolOnce(payload: HumeWebhookPayload) {
  const chatId = payload.chat_id;
  const twilioCallSid = payload.twilio_metadata?.call_sid || undefined;
  return prisma.call.findFirst({
    where: {
      OR: [
        { humeChatId: chatId },
        ...(twilioCallSid
          ? [{ providerCallId: twilioCallSid }, { twilioCallSid }]
          : []),
      ],
    },
    include: { conversation: { include: { customer: true } } },
  });
}

/**
 * Race-safe Call resolver: prefer chat mapping, else verified Twilio SID.
 * Never phone-only / name-only / latest-call / model-supplied Call ID.
 */
export async function resolveCallForTool(payload: HumeWebhookPayload) {
  const config = getHumeConfig();
  if (
    payload.config_id &&
    config.configId &&
    payload.config_id !== config.configId
  ) {
    throw new Error("hume_config_id_mismatch");
  }

  let call = await findCallForToolOnce(payload);
  if (!call) {
    for (const delayMs of [50, 100, 150]) {
      await sleep(delayMs);
      call = await findCallForToolOnce(payload);
      if (call) break;
    }
  }
  if (!call) return null;

  if (config.voiceCompanyId && call.conversation.companyId !== config.voiceCompanyId) {
    throw new Error("foreign_tenant_call_mapping");
  }

  if (!call.humeChatId || call.humeChatId !== payload.chat_id) {
    try {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          humeChatId: payload.chat_id,
          humeChatGroupId: payload.chat_group_id || call.humeChatGroupId,
          humeConfigId: payload.config_id || call.humeConfigId,
          voiceAgentProvider: "HUME_EVI",
          telephonyProvider: "TWILIO",
        },
      });
      call = {
        ...call,
        humeChatId: payload.chat_id,
        humeChatGroupId: payload.chat_group_id || call.humeChatGroupId,
      };
    } catch (error) {
      // Unique chat mapping race: another handler won; re-read.
      const again = await prisma.call.findFirst({
        where: { humeChatId: payload.chat_id },
        include: { conversation: { include: { customer: true } } },
      });
      if (!again) throw error;
      if (
        config.voiceCompanyId &&
        again.conversation.companyId !== config.voiceCompanyId
      ) {
        throw new Error("foreign_tenant_call_mapping");
      }
      call = again;
    }
  }

  return call;
}

type ResolvedCall = NonNullable<Awaited<ReturnType<typeof resolveCallForTool>>>;

async function executeToolBusiness(input: {
  toolName: string;
  params: Record<string, unknown>;
  call: ResolvedCall;
  chatId: string;
  toolCallId: string;
}): Promise<{ result: unknown; isError: boolean }> {
  const { toolName, params, call } = input;

  if (toolName === "airadesk_get_call_context") {
    if (Object.keys(params).length > 0) {
      throw new Error("context_tool_does_not_accept_parameters");
    }
    const timeoutMs = getHumeToolRuntimeConfig().toolExecutionTimeoutMs;
    const loaded = await withTimeout(
      loadAiradeskCallContextFast({
        callId: call.id,
        companyId: call.conversation.companyId,
      }),
      timeoutMs,
      "context_tool_timeout",
    );
    return {
      result: {
        ...loaded.context,
        ok: true,
        contextSource: loaded.source,
        continueSpeaking: true,
      },
      isError: false,
    };
  }

  if (toolName === "airadesk_capture_lead_details") {
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
              requirementSummary: parsed.requirementSummary,
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
      if (parsed.requirementSummary) {
        await tx.call.update({
          where: { id: call.id },
          data: {
            summary: parsed.requirementSummary,
            metadata: {
              ...((call.metadata as Record<string, unknown>) || {}),
              capturedRequirementSummary: parsed.requirementSummary,
              capturedRequirementsAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
      }
    });
    await invalidateAiradeskCallContextCache({
      callId: call.id,
      companyId: call.conversation.companyId,
    });
    return { result: { ok: true, captured: true }, isError: false };
  }

  if (toolName === "airadesk_schedule_meeting") {
    const parsed = scheduleMeetingSchema.parse(params);
    const result = await scheduleMeetingForVerifiedCall({
      call: {
        id: call.id,
        conversationId: call.conversationId,
        metadata: call.metadata,
        conversation: {
          companyId: call.conversation.companyId,
          customerId: call.conversation.customerId,
        },
      },
      preferredTimeText: parsed.preferredTimeText,
      timezone: parsed.timezone || null,
      purpose: parsed.purpose || null,
      notes: parsed.notes || null,
      modelResolvedIso: parsed.modelResolvedIso || null,
      // Falls back to receipt key in dispatcher scope if unavailable in params.
      toolCallId: input.toolCallId,
      humeChatId: call.humeChatId || input.chatId,
      referenceInstant: new Date(),
      source: "HUME_TOOL",
    });

    if (!result.success) {
      return {
        result: {
          success: false,
          needsClarification: result.needsClarification,
          clarificationQuestion: result.needsClarification ? result.message : undefined,
          message: result.needsClarification ? undefined : result.message,
          originalPhrase: result.originalPhrase,
          conversationComplete: false,
          mustHangUp: false,
        },
        isError: false,
      };
    }

    await armPostMeetingTermination({
      callId: call.id,
      bookingId: result.booking.id,
      toolCallId: input.toolCallId,
      direction: call.direction,
    });
    void runPostMeetingTerminationWatchdog(call.id).catch(() => undefined);

    return {
      result: {
        success: true,
        status: "scheduled",
        bookingCreated: !result.duplicate,
        localDate: result.localDate,
        localTime: result.localTime,
        timezone: result.timezone,
        utcTimestamp: result.utcTimestamp,
        confirmationText: `${result.localDate} ${result.localTime} ${result.timezone}`,
        originalPhrase: result.originalPhrase,
        conversationComplete: true,
        nextAction: "close_and_hang_up",
        mustHangUp: true,
      },
      isError: false,
    };
  }

  if (toolName === "airadesk_request_human_handoff") {
    const parsed = handoffSchema.parse(params);
    await prisma.conversation.update({
      where: { id: call.conversationId },
      data: {
        humanNeeded: true,
        status: "HUMAN_REQUIRED",
        nextAction: `Human handoff requested: ${parsed.reason} (${parsed.urgency})`,
      },
    });
    return { result: { ok: true, handoffRequested: true }, isError: false };
  }

  return {
    result: { ok: false, unsupportedTool: toolName, continueSpeaking: true },
    isError: true,
  };
}

export async function deliverStoredToolResult(input: {
  toolCallId: string;
  chatId: string;
  payload: HumeToolControlPlaneMessage;
  allowRetry: boolean;
}): Promise<"accepted" | "undeliverable" | "failed_retryable" | "failed_permanent"> {
  const runtime = getHumeToolRuntimeConfig();
  const receipt = await prisma.humeToolCallReceipt.findUnique({
    where: { toolCallId: input.toolCallId },
  });
  if (!receipt) return "failed_permanent";
  if (receipt.deliveryStatus === "ACCEPTED") return "accepted";
  if (receipt.deliveryAttempts >= runtime.toolDeliveryMaxAttempts) {
    await prisma.humeToolCallReceipt.update({
      where: { toolCallId: input.toolCallId },
      data: {
        deliveryStatus: "FAILED",
        errorCategory: receipt.errorCategory || "max_attempts",
      },
    });
    return "failed_permanent";
  }

  try {
    const chatStatus = await getHumeChatStatus(input.chatId);
    if (chatStatus.terminal) {
      await prisma.humeToolCallReceipt.update({
        where: { toolCallId: input.toolCallId },
        data: {
          deliveryStatus: "UNDELIVERABLE",
          errorCategory: "chat_terminal",
          lastDeliveryError: chatStatus.status || "terminal",
        },
      });
      return "undeliverable";
    }
  } catch (error) {
    if (
      error instanceof HumeControlPlaneError &&
      error.kind === "auth"
    ) {
      await prisma.humeToolCallReceipt.update({
        where: { toolCallId: input.toolCallId },
        data: {
          deliveryStatus: "FAILED",
          errorCategory: "auth",
          lastDeliveryError: "provider_auth",
        },
      });
      logHumeLatency("tool_response_auth_failure", {
        chatId: redactId(input.chatId),
        toolCallId: redactId(input.toolCallId),
      });
      return "failed_permanent";
    }
    // Proceed to send attempt if status check itself failed transiently.
  }

  const attempt = receipt.deliveryAttempts + 1;
  await prisma.humeToolCallReceipt.update({
    where: { toolCallId: input.toolCallId },
    data: {
      deliveryStatus: "SENDING",
      deliveryAttempts: attempt,
      responseSendStartedAt: new Date(),
      responsePayload: input.payload as object,
    },
  });
  logHumeLatency("tool_response_send_started", {
    chatId: redactId(input.chatId),
    toolCallId: redactId(input.toolCallId),
    attempt,
    type: input.payload.type,
  });

  try {
    await sendHumeToolResponse(input.chatId, input.payload);
    await prisma.humeToolCallReceipt.update({
      where: { toolCallId: input.toolCallId },
      data: {
        deliveryStatus: "ACCEPTED",
        responseAcceptedAt: new Date(),
        status: receipt.businessStatus === "FAILED" ? "FAILED" : "COMPLETED",
        lastDeliveryError: null,
      },
    });
    logHumeLatency(
      input.payload.type === "tool_error" ? "tool_error_sent" : "tool_response_accepted",
      {
        chatId: redactId(input.chatId),
        toolCallId: redactId(input.toolCallId),
        attempt,
      },
    );
    return "accepted";
  } catch (error) {
    const cpError =
      error instanceof HumeControlPlaneError
        ? error
        : new HumeControlPlaneError({
            message: error instanceof Error ? error.message : "send_failed",
            kind: "unknown",
            retryable: true,
          });

    if (cpError.kind === "auth") {
      await prisma.humeToolCallReceipt.update({
        where: { toolCallId: input.toolCallId },
        data: {
          deliveryStatus: "FAILED",
          errorCategory: "auth",
          lastDeliveryError: "provider_auth",
        },
      });
      logHumeLatency("tool_response_auth_failure", {
        chatId: redactId(input.chatId),
        toolCallId: redactId(input.toolCallId),
      });
      return "failed_permanent";
    }

    const retryable = cpError.retryable && input.allowRetry;
    await prisma.humeToolCallReceipt.update({
      where: { toolCallId: input.toolCallId },
      data: {
        deliveryStatus: retryable ? "PENDING" : "FAILED",
        errorCategory: cpError.kind,
        lastDeliveryError: cpError.message.slice(0, 160),
      },
    });

    if (!retryable || attempt >= runtime.toolDeliveryMaxAttempts) {
      return "failed_permanent";
    }
    return "failed_retryable";
  }
}

async function sendWithBoundedRetries(input: {
  toolCallId: string;
  chatId: string;
  payload: HumeToolControlPlaneMessage;
}) {
  const runtime = getHumeToolRuntimeConfig();
  let attempt = 0;
  while (attempt < runtime.toolDeliveryMaxAttempts) {
    attempt += 1;
    const result = await deliverStoredToolResult({
      ...input,
      allowRetry: true,
    });
    if (result === "accepted" || result === "undeliverable" || result === "failed_permanent") {
      return result;
    }
    const backoff = runtime.toolDeliveryRetryBaseMs * Math.pow(2, attempt - 1);
    await sleep(backoff);
  }
  return "failed_permanent" as const;
}

async function ensureInboundFallbackResponse(toolCallId: string, chatId: string) {
  try {
    const companyId = getHumeConfig().voiceCompanyId;
    if (!companyId) throw new Error("voice_company_id_missing");
    const fallback = await buildInboundFallbackCallContext(companyId);
    return controlPlanePayload(toolCallId, {
      ...fallback,
      ok: true,
      contextSource: "inbound_fallback",
      continueSpeaking: true,
      note: "Call mapping not ready yet. Continue the conversation naturally.",
    });
  } catch {
    return controlPlanePayload(toolCallId, {
      ok: true,
      continueSpeaking: true,
      call: {
        direction: "INBOUND",
        collectionGoal:
          "Understand the caller's requirements and preferred next step.",
        callPurpose: "Inbound caller enquiry",
        extraNotes: null,
        preferredLanguage: "AUTO",
        scheduledTime: null,
        timezone: null,
      },
      company: {
        name: "Company",
        businessType: null,
        services: [],
        pricingGuidance: [],
        agentTone: null,
      },
      customer: { name: null, preferredLanguage: "AUTO" },
      recentContext: { summary: null, knownRequirements: [] },
      note: "Context unavailable. Keep talking; do not go silent.",
    });
  }
}

/**
 * Canonical Hume custom-tool dispatcher.
 * Webhook HTTP 200 is only an acknowledgement — this function must still
 * deliver Tool Response / Tool Error through the Control Plane.
 */
export async function dispatchHumeToolCall(payload: HumeWebhookPayload) {
  const tool = payload.tool_call_message;
  if (!tool?.tool_call_id || !tool.name) {
    throw new Error("invalid_tool_payload");
  }

  const chatId = payload.chat_id;
  const toolCallId = tool.tool_call_id;
  const responseRequired = tool.response_required !== false;
  const receivedAt = new Date();

  logHumeLatency("tool_call_received", {
    chatId: redactId(chatId),
    toolCallId: redactId(toolCallId),
    toolName: tool.name,
    responseRequired,
  });

  if (!responseRequired) {
    return { acknowledged: true, delivered: false, reason: "response_not_required" };
  }

  let call: ResolvedCall | null = null;
  try {
    call = await resolveCallForTool(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "resolve_failed";
    const payloadOut = controlPlanePayload(
      toolCallId,
      {
        ok: false,
        code: message === "foreign_tenant_call_mapping" ? "FOREIGN_TENANT" : "CALL_RESOLVE_FAILED",
        error: "Unable to resolve call context for this chat.",
        continueSpeaking: true,
      },
      true,
    );
    // Persist a synthetic receipt only when we can attach a call; otherwise send error directly.
    await sendHumeToolResponse(chatId, payloadOut).catch(() => undefined);
    logHumeLatency("tool_error_sent", {
      chatId: redactId(chatId),
      toolCallId: redactId(toolCallId),
      errorCategory: message,
    });
    return { acknowledged: true, delivered: true, reason: message };
  }

  if (!call) {
    const soft =
      tool.name === "airadesk_get_call_context"
        ? await ensureInboundFallbackResponse(toolCallId, chatId)
        : controlPlanePayload(
            toolCallId,
            {
              ok: false,
              code: "CALL_CONTEXT_NOT_FOUND",
              error: "Unable to resolve call context for this chat.",
              continueSpeaking: true,
            },
            true,
          );
    await sendHumeToolResponse(chatId, soft);
    logHumeLatency(
      soft.type === "tool_error" ? "tool_error_sent" : "tool_response_accepted",
      {
        chatId: redactId(chatId),
        toolCallId: redactId(toolCallId),
        mapping: "missing",
      },
    );
    return { acknowledged: true, delivered: true, reason: "call_not_found_soft" };
  }

  const existing = await prisma.humeToolCallReceipt.findUnique({
    where: { toolCallId },
  });

  if (existing) {
    // Duplicate webhook: never re-run business logic; may retry delivery.
    if (existing.deliveryStatus === "ACCEPTED") {
      return { acknowledged: true, delivered: true, reason: "already_delivered" };
    }
    if (existing.responsePayload) {
      const stored = existing.responsePayload as HumeToolControlPlaneMessage;
      await sendWithBoundedRetries({
        toolCallId,
        chatId,
        payload: {
          type: stored.type,
          tool_call_id: toolCallId,
          content: stored.content,
        },
      });
      return { acknowledged: true, delivered: true, reason: "redelivered" };
    }
    // Receipt exists but no stored payload yet — another worker may still be executing.
    return { acknowledged: true, delivered: false, reason: "in_flight" };
  }

  await prisma.humeToolCallReceipt.create({
    data: {
      toolCallId,
      chatId,
      callId: call.id,
      companyId: call.conversation.companyId,
      toolName: tool.name,
      status: "PROCESSING",
      responseRequired: true,
      businessStatus: "PENDING",
      deliveryStatus: "PENDING",
      receivedAt,
    },
  });

  let planeMessage: HumeToolControlPlaneMessage;
  try {
    logHumeLatency("tool_execution_started", {
      chatId: redactId(chatId),
      toolCallId: redactId(toolCallId),
      toolName: tool.name,
    });
    await prisma.humeToolCallReceipt.update({
      where: { toolCallId },
      data: { executionStartedAt: new Date() },
    });

    const params = parseToolParams(tool.parameters);
    const timeoutMs = getHumeToolRuntimeConfig().toolExecutionTimeoutMs;
    const executed = await withTimeout(
      executeToolBusiness({
        toolName: tool.name,
        params,
        call,
        chatId,
        toolCallId,
      }),
      timeoutMs,
      "tool_execution_timeout",
    );

    planeMessage = controlPlanePayload(
      toolCallId,
      executed.result,
      executed.isError,
    );

    await prisma.humeToolCallReceipt.update({
      where: { toolCallId },
      data: {
        businessStatus: executed.isError ? "FAILED" : "COMPLETED",
        executionCompletedAt: new Date(),
        responsePayload: planeMessage as object,
        status: executed.isError ? "FAILED" : "PROCESSING",
        error: executed.isError ? "tool_business_error" : null,
      },
    });
    logHumeLatency("tool_execution_completed", {
      chatId: redactId(chatId),
      toolCallId: redactId(toolCallId),
      businessStatus: executed.isError ? "FAILED" : "COMPLETED",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "tool_failed";
    const isTimeout = message.includes("timeout");
    planeMessage = controlPlanePayload(
      toolCallId,
      {
        ok: false,
        code: isTimeout ? "TOOL_TIMEOUT" : "TOOL_EXECUTION_ERROR",
        error: isTimeout ? "Tool timed out. Continue speaking." : message,
        continueSpeaking: true,
      },
      true,
    );
    await prisma.humeToolCallReceipt.update({
      where: { toolCallId },
      data: {
        businessStatus: "FAILED",
        executionCompletedAt: new Date(),
        responsePayload: planeMessage as object,
        status: "FAILED",
        error: message.slice(0, 200),
        errorCategory: isTimeout ? "timeout" : "execution",
      },
    });
    logHumeLatency("tool_execution_completed", {
      chatId: redactId(chatId),
      toolCallId: redactId(toolCallId),
      businessStatus: "FAILED",
      errorCategory: isTimeout ? "timeout" : "execution",
    });
  }

  await sendWithBoundedRetries({
    toolCallId,
    chatId,
    payload: planeMessage,
  });

  return { acknowledged: true, delivered: true };
}
