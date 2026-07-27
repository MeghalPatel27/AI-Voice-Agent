import { prisma } from "../../db/prisma";
import {
  TERMINAL_CALL_STATUSES,
  finalizeCall,
  mapTwilioStatusToCallStatus,
  shouldApplyCallStatus,
} from "../../services/callFinalization.service";

export async function applyTwilioStatusCallback(input: {
  callSid: string;
  twilioStatus: string;
  durationSeconds?: number;
}) {
  const call = await prisma.call.findFirst({
    where: { OR: [{ providerCallId: input.callSid }, { twilioCallSid: input.callSid }] },
    include: { conversation: true },
  });
  if (!call) return null;

  const nextStatus = mapTwilioStatusToCallStatus(input.twilioStatus, call.direction);
  await prisma.call.update({
    where: { id: call.id },
    data: {
      status: shouldApplyCallStatus(call.status, nextStatus) ? nextStatus : call.status,
      durationSeconds:
        input.durationSeconds && input.durationSeconds > 0
          ? Math.max(input.durationSeconds, call.durationSeconds || 0)
          : call.durationSeconds,
      endedAt: TERMINAL_CALL_STATUSES.has(nextStatus)
        ? call.endedAt || new Date()
        : call.endedAt,
      failureReason: ["NO_ANSWER", "BUSY", "FAILED", "CANCELED", "MISSED"].includes(nextStatus)
        ? call.failureReason || `Twilio call status: ${input.twilioStatus}`
        : call.failureReason,
      metadata: {
        ...((call.metadata as Record<string, unknown>) || {}),
        twilioStatus: input.twilioStatus,
      } as any,
    },
  });

  if (TERMINAL_CALL_STATUSES.has(nextStatus)) {
    await finalizeCall({
      callId: call.id,
      companyId: call.conversation.companyId,
      endReason: `twilio_status_${input.twilioStatus}`,
      providerStatus: input.twilioStatus,
      terminalStatus: nextStatus,
      markCompleted: nextStatus === "COMPLETED",
      durationSeconds: input.durationSeconds,
    });
  }

  return call;
}
