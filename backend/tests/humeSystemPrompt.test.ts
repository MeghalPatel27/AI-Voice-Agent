import { describe, expect, it } from "vitest";
import {
  HUME_SYSTEM_PROMPT_CHAR_COUNT,
  HUME_SYSTEM_PROMPT_CHECKSUM,
  HUME_SYSTEM_PROMPT_MAX_CHARS,
  HUME_SYSTEM_PROMPT_TEXT,
  HUME_SYSTEM_PROMPT_VERSION,
  computePromptChecksum,
  normalizePromptText,
} from "../src/integrations/hume/humeSystemPrompt";

describe("canonical hume system prompt", () => {
  it("is under 7,000 characters with stable version/checksum", () => {
    expect(HUME_SYSTEM_PROMPT_VERSION).toBeTruthy();
    expect(HUME_SYSTEM_PROMPT_CHAR_COUNT).toBeLessThan(HUME_SYSTEM_PROMPT_MAX_CHARS);
    expect(HUME_SYSTEM_PROMPT_CHAR_COUNT).toBe(normalizePromptText(HUME_SYSTEM_PROMPT_TEXT).length);
    expect(HUME_SYSTEM_PROMPT_CHECKSUM).toBe(computePromptChecksum(HUME_SYSTEM_PROMPT_TEXT));
  });

  it("contains required approved prompt rules", () => {
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain("{{now}}");
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain("airadesk_get_call_context");
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain("airadesk_capture_lead_details");
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain("airadesk_schedule_meeting");
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain("airadesk_request_human_handoff");
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain(
      "Hi, this is Kora from Cowd. We build software solutions and websites for businesses. What do you have in mind?",
    );
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain("Do not ask “How can I help you?”");
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain("Ask no more than two or three discovery questions.");
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain(
      "Use airadesk_schedule_meeting only when exact date, time, and timezone are known.",
    );
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain(
      "A meeting is scheduled only when the tool returns success: true.",
    );
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain(
      "Perfect. Our team will reach out to you at the confirmed time. Thank you, and have a great day.",
    );
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain("Then use hang_up.");
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain(
      "Do not ask “Is there anything else I can help you with?”",
    );
    expect(HUME_SYSTEM_PROMPT_TEXT).toContain(
      "If asked not to contact again, acknowledge, stop the sales conversation, and end the call.",
    );
    expect(HUME_SYSTEM_PROMPT_TEXT).not.toMatch(/Cursor|BEGIN APPROVED PROMPT|END APPROVED PROMPT/);
    expect(HUME_SYSTEM_PROMPT_TEXT).not.toMatch(
      /HUME_API_KEY|TWILIO_AUTH_TOKEN|WEBHOOK_SIGNING_KEY|sk-[A-Za-z0-9]/,
    );
  });

  it("normalizes line endings and trailing spaces for stable checksum", () => {
    const withCrlf = HUME_SYSTEM_PROMPT_TEXT.replace(/\n/g, "\r\n");
    const withTrailingSpaces = HUME_SYSTEM_PROMPT_TEXT
      .split("\n")
      .map((line) => `${line}   `)
      .join("\n");
    expect(computePromptChecksum(withCrlf)).toBe(HUME_SYSTEM_PROMPT_CHECKSUM);
    expect(computePromptChecksum(withTrailingSpaces)).toBe(HUME_SYSTEM_PROMPT_CHECKSUM);
  });
});
