import { describe, expect, it } from "vitest";
import {
  buildLabeledTranscriptLines,
  buildTranscriptTextFromMessages,
  callScopedMessageWhere,
} from "../src/services/callTranscript.service";

describe("callTranscript.service", () => {
  it("scopes message queries to exact Call ID", () => {
    expect(callScopedMessageWhere("call-a", "conv-1")).toEqual({
      conversationId: "conv-1",
      callId: "call-a",
    });
  });

  it("builds transcript text only from provided call messages", () => {
    const text = buildTranscriptTextFromMessages([
      {
        senderType: "CUSTOMER",
        body: "Need CRM",
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
      },
      {
        senderType: "AI",
        body: "Sure",
        createdAt: new Date("2026-07-20T10:00:05.000Z"),
      },
    ]);

    expect(text).toContain("Customer: Need CRM");
    expect(text).toContain("AI: Sure");
    expect(text).not.toContain("Other call");
  });

  it("builds labeled transcript lines for analysis", () => {
    const labeled = buildLabeledTranscriptLines([
      { senderType: "CUSTOMER", body: "Pricing?" },
      { senderType: "AI", body: "Happy to explain." },
    ]);

    expect(labeled).toBe("CUSTOMER: Pricing?\nAI: Happy to explain.");
  });
});
