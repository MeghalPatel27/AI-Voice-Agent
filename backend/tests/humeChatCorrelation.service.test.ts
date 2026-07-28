import { describe, expect, it } from "vitest";
import type { HumeChatSummary } from "../src/integrations/hume/humeChatHistory.client";

function scoreCandidate(
  call: {
    providerCallId: string | null;
    twilioCallSid: string | null;
    direction: string | null;
    startedAt: Date;
    createdAt: Date;
    endedAt: Date | null;
  },
  chat: HumeChatSummary,
  configuredConfigId: string,
) {
  const sid = call.providerCallId || call.twilioCallSid;
  if (!sid || !chat.twilioCallSid || chat.twilioCallSid !== sid) {
    return { exact: false, reason: "twilio_sid_mismatch" };
  }
  if (chat.configId && chat.configId !== configuredConfigId) {
    return { exact: false, reason: "config_id_mismatch" };
  }
  return { exact: true, reason: "twilio_sid_exact" };
}

describe("hume chat correlation contract", () => {
  const call = {
    providerCallId: "CA123",
    twilioCallSid: "CA123",
    direction: "OUTBOUND",
    startedAt: new Date("2026-07-28T13:52:00Z"),
    createdAt: new Date("2026-07-28T13:52:00Z"),
    endedAt: new Date("2026-07-28T13:55:00Z"),
  };

  const chat: HumeChatSummary = {
    id: "chat-1",
    chatGroupId: "group-1",
    configId: "cfg-1",
    status: "USER_ENDED",
    startTimestampMs: Date.parse("2026-07-28T13:52:20Z"),
    endTimestampMs: Date.parse("2026-07-28T13:55:00Z"),
    eventCount: 10,
    twilioCallSid: "CA123",
    direction: "outbound-api",
    requestId: null,
  };

  it("accepts exact Twilio Call SID correlation", () => {
    expect(scoreCandidate(call, chat, "cfg-1")).toEqual({
      exact: true,
      reason: "twilio_sid_exact",
    });
  });

  it("rejects wrong Twilio Call SID", () => {
    expect(
      scoreCandidate(call, { ...chat, twilioCallSid: "CA999" }, "cfg-1"),
    ).toEqual({
      exact: false,
      reason: "twilio_sid_mismatch",
    });
  });

  it("rejects wrong Config ID", () => {
    expect(scoreCandidate(call, chat, "cfg-other")).toEqual({
      exact: false,
      reason: "config_id_mismatch",
    });
  });
});
