import { describe, expect, it } from "vitest";
import {
  buildTranscriptText,
  computeExpressionAnalysis,
  eventToTranscriptLine,
} from "../src/integrations/hume/humeChatTranscript.service";
import type { HumeChatEvent } from "../src/integrations/hume/hume.types";

describe("humeChatTranscript.service", () => {
  it("maps USER_MESSAGE to customer transcript lines", () => {
    const line = eventToTranscriptLine({
      id: "evt-1",
      type: "USER_MESSAGE",
      role: "USER",
      message_text: "I need a website",
      timestamp: 1_700_000_000_000,
    } as HumeChatEvent);
    expect(line?.speaker).toBe("CUSTOMER");
    expect(line?.body).toBe("I need a website");
  });

  it("maps AGENT_MESSAGE to agent transcript lines", () => {
    const line = eventToTranscriptLine({
      id: "evt-2",
      type: "AGENT_MESSAGE",
      role: "ASSISTANT",
      message_text: "Happy to help.",
      timestamp: 1_700_000_001_000,
    } as HumeChatEvent);
    expect(line?.speaker).toBe("AI");
    expect(line?.body).toBe("Happy to help.");
  });

  it("excludes SYSTEM_PROMPT events", () => {
    expect(
      eventToTranscriptLine({
        id: "evt-3",
        type: "SYSTEM_PROMPT",
        message_text: "secret",
      } as HumeChatEvent),
    ).toBeNull();
  });

  it("excludes SESSION_SETTINGS events", () => {
    expect(
      eventToTranscriptLine({
        id: "evt-4",
        type: "SESSION_SETTINGS",
        message_text: "settings",
      } as HumeChatEvent),
    ).toBeNull();
  });

  it("builds readable transcript text", () => {
    const text = buildTranscriptText([
      {
        speaker: "CUSTOMER",
        body: "Hello",
        providerMessageId: "1",
        createdAt: new Date(),
      },
      {
        speaker: "AI",
        body: "Hi there",
        providerMessageId: "2",
        createdAt: new Date(),
      },
    ]);
    expect(text).toContain("CUSTOMER: Hello");
    expect(text).toContain("AI: Hi there");
  });

  it("computes expression averages from USER_MESSAGE events", () => {
    const result = computeExpressionAnalysis([
      {
        type: "USER_MESSAGE",
        emotion_features: { Joy: 0.8, Calmness: 0.2 },
      } as HumeChatEvent,
      {
        type: "USER_MESSAGE",
        emotion_features: { Joy: 0.4, Calmness: 0.6 },
      } as HumeChatEvent,
    ]);
    expect(result.userTurnCount).toBe(2);
    expect(result.averages.Joy).toBe(0.6);
    expect(result.topExpressions[0]?.name).toBe("Joy");
  });
});
