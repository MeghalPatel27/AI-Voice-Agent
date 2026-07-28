import { describe, expect, it } from "vitest";
import {
  HUME_SYSTEM_PROMPT_CHECKSUM,
  HUME_SYSTEM_PROMPT_TEXT,
  HUME_SYSTEM_PROMPT_VERSION,
  computePromptChecksum,
} from "../src/integrations/hume/humeSystemPrompt";

describe("canonical hume system prompt", () => {
  it("has stable version and checksum", () => {
    expect(HUME_SYSTEM_PROMPT_VERSION).toBeTruthy();
    expect(HUME_SYSTEM_PROMPT_CHECKSUM).toBe(
      computePromptChecksum(HUME_SYSTEM_PROMPT_TEXT),
    );
  });

  it("contains required call-context instructions", () => {
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/airadesk_get_call_context/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/collectionGoal/);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/extraNotes/);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/never claim to be human/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/AI-powered virtual calling assistant/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/airadesk_capture_lead_details/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/airadesk_schedule_meeting/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/opt-out/i);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/hang_up/i);
  });
});
