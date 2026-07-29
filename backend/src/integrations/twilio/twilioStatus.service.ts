import {
  applyTwilioLifecycleEvent,
} from "../../services/callLifecycle.service";
import { bootstrapInboundVoiceCall } from "../../services/bootstrapInboundVoiceCall.service";

function normalizePhone(value?: string | null) {
  const v = String(value || "").trim();
  if (!v) return "";
  return v.startsWith("+") ? v : `+${v}`;
}

export async function applyTwilioStatusCallback(input: {
  callSid: string;
  twilioStatus: string;
  durationSeconds?: number;
  fromNumber?: string | null;
  toNumber?: string | null;
  direction?: string | null;
}) {
  let result = await applyTwilioLifecycleEvent({
    callSid: input.callSid,
    twilioStatus: input.twilioStatus,
    durationSeconds: input.durationSeconds,
  });

  if (!result.callId && input.callSid) {
    const direction = String(input.direction || "").toLowerCase();
    const isInbound =
      direction.includes("inbound") || direction === "inbound";

    if (isInbound && input.fromNumber && input.toNumber) {
      try {
        const bootstrapped = await bootstrapInboundVoiceCall({
          providerCallId: input.callSid,
          callerPhone: normalizePhone(input.fromNumber),
          calledNumber: normalizePhone(input.toNumber),
          direction: "INBOUND",
          twilioStatus: input.twilioStatus,
          startedAt: new Date(),
        });

        result = await applyTwilioLifecycleEvent({
          callSid: input.callSid,
          twilioStatus: input.twilioStatus,
          durationSeconds: input.durationSeconds,
          companyId: bootstrapped.companyId,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            scope: "twilio_status",
            event: "inbound_bootstrap_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }

  if (!result.callId) return null;

  return {
    id: result.callId,
    conversationId: result.conversationId,
    status: result.nextStatus,
    taskId: result.taskId,
    taskStatus: result.taskStatus,
  };
}
