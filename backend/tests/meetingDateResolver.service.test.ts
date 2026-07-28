import { describe, expect, it } from "vitest";
import { resolveMeetingDateTime } from "../src/services/meetingDateResolver.service";

const reference = new Date("2026-07-28T14:00:00.000Z");

describe("meetingDateResolver.service", () => {
  it('resolves "tomorrow at 7 PM" to 29 July 2026 19:00 Asia/Kolkata', () => {
    const result = resolveMeetingDateTime({
      preferredTimeText: "tomorrow at 7 PM",
      timezone: "Asia/Kolkata",
      referenceInstant: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.localDate).toBe("2026-07-29");
    expect(result.localTime).toMatch(/7:00 PM/i);
    expect(result.timezone).toBe("Asia/Kolkata");
    expect(new Date(result.utcTimestamp).toISOString()).toBe("2026-07-29T13:30:00.000Z");
  });

  it("rejects ambiguous missing time for tomorrow", () => {
    const result = resolveMeetingDateTime({
      preferredTimeText: "tomorrow",
      timezone: "Asia/Kolkata",
      referenceInstant: reference,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.needsClarification).toBe(true);
  });

  it("does not trust a model-provided October hint that disagrees with phrase", () => {
    const result = resolveMeetingDateTime({
      preferredTimeText: "tomorrow at 7 PM",
      timezone: "Asia/Kolkata",
      referenceInstant: reference,
      modelResolvedIso: "2026-10-29T13:30:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("preserves original preferredTimeText", () => {
    const result = resolveMeetingDateTime({
      preferredTimeText: "Tomorrow at 7 PM",
      timezone: "Asia/Kolkata",
      referenceInstant: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.originalPhrase).toBe("Tomorrow at 7 PM");
  });

  it("rejects invalid timezone", () => {
    const result = resolveMeetingDateTime({
      preferredTimeText: "tomorrow at 7 PM",
      timezone: "Not/AZone",
      referenceInstant: reference,
    });
    expect(result.ok).toBe(false);
  });
});
