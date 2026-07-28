import type { Booking } from "@prisma/client";
import { prisma } from "../db/prisma";
import { resolveMeetingDateTime } from "./meetingDateResolver.service";

type VerifiedCallContext = {
  id: string;
  conversationId: string;
  metadata: unknown;
  conversation: {
    companyId: string;
    customerId: string | null;
  };
};

type ScheduleInput = {
  call: VerifiedCallContext;
  preferredTimeText: string;
  timezone?: string | null;
  purpose?: string | null;
  notes?: string | null;
  modelResolvedIso?: string | null;
  toolCallId: string;
  humeChatId: string;
  referenceInstant: Date;
  source: "HUME_TOOL" | "HUME_HISTORY_RECOVERY";
};

type ScheduleResult =
  | {
      success: true;
      duplicate: boolean;
      booking: Booking;
      localDate: string;
      localTime: string;
      timezone: string;
      utcTimestamp: string;
      originalPhrase: string;
    }
  | {
      success: false;
      needsClarification: boolean;
      message: string;
      originalPhrase: string;
      safeErrorCategory:
        | "clarification_required"
        | "timezone_invalid"
        | "past_time"
        | "booking_failed";
    };

function toolMarker(toolCallId: string) {
  return `[HUME_TOOL_CALL_ID:${toolCallId}]`;
}

async function resolveTimezone(
  call: VerifiedCallContext,
  requestedTimezone?: string | null,
) {
  if (requestedTimezone?.trim()) return requestedTimezone.trim();
  const metadata = (call.metadata as Record<string, unknown> | null) || {};
  const callTz = typeof metadata.timezone === "string" ? metadata.timezone.trim() : "";
  if (callTz) return callTz;
  const settings = await prisma.companySettings.findUnique({
    where: { companyId: call.conversation.companyId },
    select: { timezone: true },
  });
  return settings?.timezone?.trim() || "Asia/Kolkata";
}

export async function scheduleMeetingForVerifiedCall(
  input: ScheduleInput,
): Promise<ScheduleResult> {
  const timezone = await resolveTimezone(input.call, input.timezone);
  const resolution = resolveMeetingDateTime({
    preferredTimeText: input.preferredTimeText,
    timezone,
    referenceInstant: input.referenceInstant,
    modelResolvedIso: input.modelResolvedIso || null,
  });

  if (!resolution.ok) {
    const msg = resolution.message.toLowerCase();
    const safeErrorCategory =
      msg.includes("timezone")
        ? "timezone_invalid"
        : msg.includes("past")
          ? "past_time"
          : "clarification_required";
    return {
      success: false,
      needsClarification: true,
      message: resolution.message,
      originalPhrase: resolution.originalPhrase,
      safeErrorCategory,
    };
  }

  const marker = toolMarker(input.toolCallId);
  const existingByMarker = await prisma.booking.findFirst({
    where: {
      companyId: input.call.conversation.companyId,
      callId: input.call.id,
      notes: { contains: marker },
    },
  });
  if (existingByMarker) {
    return {
      success: true,
      duplicate: true,
      booking: existingByMarker,
      localDate: resolution.localDate,
      localTime: resolution.localTime,
      timezone: resolution.timezone,
      utcTimestamp: resolution.utcTimestamp,
      originalPhrase: resolution.originalPhrase,
    };
  }

  const existingBySlot = await prisma.booking.findFirst({
    where: {
      companyId: input.call.conversation.companyId,
      callId: input.call.id,
      dateTime: resolution.dateTime,
    },
  });
  if (existingBySlot) {
    return {
      success: true,
      duplicate: true,
      booking: existingBySlot,
      localDate: resolution.localDate,
      localTime: resolution.localTime,
      timezone: resolution.timezone,
      utcTimestamp: resolution.utcTimestamp,
      originalPhrase: resolution.originalPhrase,
    };
  }

  try {
    const booking = await prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          companyId: input.call.conversation.companyId,
          customerId: input.call.conversation.customerId,
          conversationId: input.call.conversationId,
          callId: input.call.id,
          title: input.purpose?.trim() || "AI Call Meeting",
          dateTime: resolution.dateTime,
          timezone: resolution.timezone,
          purpose: input.purpose?.trim() || null,
          notes: [
            input.notes?.trim() || null,
            `Requested: ${resolution.originalPhrase}`,
            marker,
            `[HUME_CHAT_ID:${input.humeChatId}]`,
            `[SOURCE:${input.source}]`,
          ]
            .filter(Boolean)
            .join("\n")
            .slice(0, 4000),
          status: "REQUESTED",
          acceptanceStatus: "PENDING_ACCEPTANCE",
          nextAction: "Confirm meeting details with customer.",
        },
      });
      await tx.conversation.update({
        where: { id: input.call.conversationId },
        data: { bookingCreated: true },
      });
      return created;
    });

    return {
      success: true,
      duplicate: false,
      booking,
      localDate: resolution.localDate,
      localTime: resolution.localTime,
      timezone: resolution.timezone,
      utcTimestamp: resolution.utcTimestamp,
      originalPhrase: resolution.originalPhrase,
    };
  } catch {
    return {
      success: false,
      needsClarification: false,
      message: "Unable to schedule the meeting right now.",
      originalPhrase: input.preferredTimeText.trim(),
      safeErrorCategory: "booking_failed",
    };
  }
}
