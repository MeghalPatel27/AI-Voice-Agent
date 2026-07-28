import {
  applyTwilioLifecycleEvent,
} from "../../services/callLifecycle.service";

export async function applyTwilioStatusCallback(input: {
  callSid: string;
  twilioStatus: string;
  durationSeconds?: number;
}) {
  const result = await applyTwilioLifecycleEvent({
    callSid: input.callSid,
    twilioStatus: input.twilioStatus,
    durationSeconds: input.durationSeconds,
  });

  if (!result.callId) return null;

  return {
    id: result.callId,
    conversationId: result.conversationId,
    status: result.nextStatus,
    taskId: result.taskId,
    taskStatus: result.taskStatus,
  };
}
