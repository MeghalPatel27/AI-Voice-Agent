import { describe, expect, it } from "vitest";
import {
  HUME_SYSTEM_PROMPT_CHAR_COUNT,
  HUME_SYSTEM_PROMPT_CHECKSUM,
  HUME_SYSTEM_PROMPT_MAX_CHARS,
  HUME_SYSTEM_PROMPT_TEXT,
  HUME_SYSTEM_PROMPT_VERSION,
  computePromptChecksum,
} from "../src/integrations/hume/humeSystemPrompt";

describe("canonical hume system prompt", () => {
  it("28. is under 7,000 characters with stable version/checksum", () => {
    expect(HUME_SYSTEM_PROMPT_VERSION).toBeTruthy();
    expect(HUME_SYSTEM_PROMPT_CHAR_COUNT).toBeLessThanOrEqual(HUME_SYSTEM_PROMPT_MAX_CHARS);
    expect(HUME_SYSTEM_PROMPT_CHAR_COUNT).toBe(HUME_SYSTEM_PROMPT_TEXT.length);
    expect(HUME_SYSTEM_PROMPT_CHECKSUM).toBe(computePromptChecksum(HUME_SYSTEM_PROMPT_TEXT));
  });

  it("29-33. pace, brevity, one-question, recovery, and no indefinite silence", () => {
    const head = HUME_SYSTEM_PROMPT_TEXT.slice(0, 800);
    expect(head).toMatch(/VOICE AND RESPONSE STYLE/);
    expect(head).toMatch(/brisk, natural professional pace/);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/25 spoken words/);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/one question at a time/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(
      /Never remain silent indefinitely waiting for an internal tool/i,
    );
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/If call context is temporarily unavailable|context is temporarily unavailable/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/Hello, are you there\?/);
  });

  it("34. preserves identity, privacy, and tool rules", () => {
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/airadesk_get_call_context/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/collectionGoal/);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/extraNotes/);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/never claim to be human/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/AI-powered virtual calling assistant/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/outbound.*company name.*reason/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/airadesk_capture_lead_details/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/airadesk_schedule_meeting/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/opt-out/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/hang_up/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/\{\{now\}\}/);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/Asia\/Kolkata/);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/Do not wait silently after the caller speaks/i);
  });
});

describe("spoken response style fixtures", () => {
  function assertPreferredStyle(preferred: string, avoid: string) {
    const preferredWords = preferred.trim().split(/\s+/).length;
    const avoidWords = avoid.trim().split(/\s+/).length;
    expect(preferredWords).toBeLessThanOrEqual(30);
    expect(preferredWords).toBeLessThan(avoidWords);
    expect(preferred).not.toMatch(/Certainly, I would be/i);
    expect((preferred.match(/\?/g) || []).length).toBeLessThanOrEqual(1);
  }

  it("prefers concise website discovery reply", () => {
    assertPreferredStyle(
      "Got it. What type of website are you looking for?",
      "Certainly, I would be delighted to assist you in understanding your website requirements today. Could you perhaps explain the type of website that you have in mind?",
    );
  });

  it("prefers concise budget follow-up without recap", () => {
    assertPreferredStyle(
      "Understood. When would you like the website completed?",
      "Thank you so much for sharing that your budget is seventy five thousand rupees. That is very helpful. When would you like the website to be completed if you do not mind me asking?",
    );
  });

  it("meeting confirmation may include exact date time timezone", () => {
    const confirmation =
      "Booked for Tuesday 15 July at 3:00 PM Asia/Kolkata. Does that work?";
    expect(confirmation).toMatch(/Asia\/Kolkata/);
    expect(confirmation.split(/\s+/).length).toBeLessThanOrEqual(30);
  });
});
