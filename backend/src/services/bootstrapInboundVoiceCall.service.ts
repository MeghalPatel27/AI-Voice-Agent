import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { shouldApplyCallStatus } from "./callFinalization.service";
import { prewarmAiradeskCallContext } from "../integrations/hume/humeContextCache.service";
import {
  normalizePhoneToE164,
  resolveInboundCompanyByCalledNumber,
} from "./inboundVoiceRouting.service";

export type BootstrapInboundVoiceCallInput = {
  providerCallId: string;
  callerPhone: string;
  calledNumber?: string | null;
  direction?: string | null;
  humeChatId?: string | null;
  humeChatGroupId?: string | null;
  humeConfigId?: string | null;
  humeRequestId?: string | null;
  startedAt?: Date | null;
  twilioStatus?: string | null;
  companyId?: string | null;
};

function normalizePhone(value?: string | null) {
  return normalizePhoneToE164(value) || "";
}

async function resolveCompanyId(input: BootstrapInboundVoiceCallInput) {
  const routing = await resolveInboundCompanyByCalledNumber({
    calledNumber: input.calledNumber,
  });
  return routing.company.id;
}

async function resolveCustomer(companyId: string, callerPhone: string) {
  const phone = normalizePhone(callerPhone);
  if (!phone) throw new Error("invalid_caller_number");
  const existing = await prisma.customer.findFirst({
    where: { companyId, phone },
  });

  if (existing) return existing;

  return prisma.customer.create({
    data: {
      companyId,
      phone,
      fullName: "Unknown Caller",
      source: "inbound_voice",
    },
  });
}

function readMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

/**
 * Canonical inbound voice bootstrap.
 * Upserts by exact Twilio Call SID; converges chat_started and Twilio status races.
 */
export async function bootstrapInboundVoiceCall(
  input: BootstrapInboundVoiceCallInput,
) {
  const providerCallId = String(input.providerCallId || "").trim();
  if (!providerCallId) {
    throw new Error("provider_call_id_required");
  }
  const companyId = await resolveCompanyId(input);
  const customer = await resolveCustomer(companyId, input.callerPhone);
  const from = normalizePhone(input.callerPhone) || customer.phone;
  const startedAt = input.startedAt || new Date();

  if (input.humeChatId) {
    const existingByChat = await prisma.call.findFirst({
      where: { humeChatId: input.humeChatId },
      include: { conversation: true },
    });
    if (existingByChat) {
      if (existingByChat.conversation.companyId !== companyId) {
        throw new Error("foreign_tenant_call_mapping");
      }
      const updated = await prisma.call.update({
        where: { id: existingByChat.id },
        data: {
          providerCallId: providerCallId || existingByChat.providerCallId,
          twilioCallSid: providerCallId || existingByChat.twilioCallSid,
          humeChatId: input.humeChatId || existingByChat.humeChatId,
          humeChatGroupId:
            input.humeChatGroupId || existingByChat.humeChatGroupId,
          humeConfigId: input.humeConfigId || existingByChat.humeConfigId,
          direction: "INBOUND",
          voiceAgentProvider: "HUME_EVI",
          telephonyProvider: "TWILIO",
        },
      });
      if (input.humeChatId) {
        void prewarmAiradeskCallContext({
          callId: updated.id,
          companyId,
          chatId: input.humeChatId,
        }).catch(() => undefined);
      }
      return {
        call: updated,
        conversationId: existingByChat.conversationId,
        customerId: customer.id,
        companyId,
        created: false,
      };
    }
  }

  {
    const existingBySid = await prisma.call.findFirst({
      where: { providerCallId },
      include: { conversation: true },
    });

    if (existingBySid) {
      if (existingBySid.conversation.companyId !== companyId) {
        throw new Error("foreign_tenant_call_mapping");
      }

      const meta = readMetadata(existingBySid.metadata);
      const answeredAt = meta.answeredAt || new Date().toISOString();
      const nextStatus = shouldApplyCallStatus(
        existingBySid.status,
        "IN_PROGRESS",
      )
        ? "IN_PROGRESS"
        : existingBySid.status;

      const updated = await prisma.call.update({
        where: { id: existingBySid.id },
        data: {
          humeChatId: input.humeChatId || existingBySid.humeChatId,
          humeChatGroupId:
            input.humeChatGroupId || existingBySid.humeChatGroupId,
          humeConfigId: input.humeConfigId || existingBySid.humeConfigId,
          twilioCallSid: providerCallId,
          providerCallId,
          voiceAgentProvider: "HUME_EVI",
          telephonyProvider: "TWILIO",
          direction: "INBOUND",
          status: nextStatus,
          startedAt: existingBySid.startedAt || startedAt,
          metadata: {
            ...meta,
            answeredAt,
            ...(input.humeRequestId
              ? { humeRequestId: input.humeRequestId }
              : {}),
            ...(input.twilioStatus
              ? { twilioStatus: input.twilioStatus }
              : {}),
          } as Prisma.InputJsonValue,
        },
      });

      if (input.humeChatId) {
        void prewarmAiradeskCallContext({
          callId: updated.id,
          companyId,
          chatId: input.humeChatId,
        }).catch(() => undefined);
      }

      return {
        call: updated,
        conversationId: existingBySid.conversationId,
        customerId: customer.id,
        companyId,
        created: false,
      };
    }
  }

  const conversation = await prisma.conversation.create({
    data: {
      companyId,
      customerId: customer.id,
      channel: "AI_CALL",
      status: "IN_PROGRESS",
      priority: "HIGH",
      intent: "Inbound voice call",
      aiSummary: "Inbound Hume EVI call in progress.",
      nextAction: "Await transcript synchronization.",
      provider: "hume_evi",
    },
  });

  const call = await prisma.call.create({
    data: {
      conversationId: conversation.id,
      phone: from,
      status: "IN_PROGRESS",
      direction: "INBOUND",
      provider: "twilio",
      providerCallId: providerCallId || null,
      twilioCallSid: providerCallId || null,
      telephonyProvider: "TWILIO",
      voiceAgentProvider: "HUME_EVI",
      humeChatId: input.humeChatId || null,
      humeChatGroupId: input.humeChatGroupId || null,
      humeConfigId: input.humeConfigId || null,
      startedAt,
      metadata: {
        answeredAt: new Date().toISOString(),
        source: "INBOUND_VOICE_BOOTSTRAP",
        calledNumber: normalizePhone(input.calledNumber) || null,
        ...(input.humeRequestId ? { humeRequestId: input.humeRequestId } : {}),
        ...(input.twilioStatus ? { twilioStatus: input.twilioStatus } : {}),
      } as Prisma.InputJsonValue,
    },
  });

  if (input.humeChatId) {
    void prewarmAiradeskCallContext({
      callId: call.id,
      companyId,
      chatId: input.humeChatId,
    }).catch(() => undefined);
  }

  return {
    call,
    conversationId: conversation.id,
    customerId: customer.id,
    companyId,
    created: true,
  };
}
