import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  callTerminationIntent: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  call: {
    findUnique: vi.fn(),
  },
}));

vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));

import {
  armPostMeetingTermination,
  getPostMeetingTerminationConfig,
  markPostMeetingTerminationSatisfied,
  runPostMeetingTerminationWatchdog,
} from "../src/services/callTermination.service";

describe("callTermination.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.POST_MEETING_HANGUP_GRACE_MS = "10000";
    process.env.POST_MEETING_HANGUP_MAX_ATTEMPTS = "2";
    process.env.POST_MEETING_HANGUP_RETRY_MS = "1";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "token";
  });

  it("arms one intent for committed meeting success", async () => {
    prismaMock.callTerminationIntent.upsert.mockResolvedValue({ id: "intent-1" });
    await armPostMeetingTermination({
      callId: "call-1",
      bookingId: "book-1",
      toolCallId: "tool-1",
      direction: "OUTBOUND",
    });
    expect(prismaMock.callTerminationIntent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { callId_reason: { callId: "call-1", reason: "MEETING_SCHEDULED" } },
      }),
    );
  });

  it("does not fabricate completion without provider proof", async () => {
    prismaMock.callTerminationIntent.findUnique
      .mockResolvedValueOnce({
        id: "intent-1",
        state: "ARMED",
        graceDeadlineAt: new Date(Date.now() - 10),
      })
      .mockResolvedValueOnce({
        id: "intent-1",
        state: "ARMED",
      });
    prismaMock.call.findUnique.mockResolvedValue({
      id: "call-1",
      status: "IN_PROGRESS",
      endedAt: null,
      providerCallId: "CA111",
      direction: "OUTBOUND",
      metadata: {},
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "completed" }),
      } as any);

    await runPostMeetingTerminationWatchdog("call-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.callTerminationIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "CANCELED" }),
      }),
    );
    fetchMock.mockRestore();
  });

  it("uses exact provider SID to request twilio completion", async () => {
    prismaMock.callTerminationIntent.findUnique
      .mockResolvedValueOnce({
        id: "intent-2",
        state: "ARMED",
        graceDeadlineAt: new Date(Date.now() - 10),
      })
      .mockResolvedValueOnce({
        id: "intent-2",
        state: "ARMED",
      });
    prismaMock.call.findUnique.mockResolvedValue({
      id: "call-2",
      status: "IN_PROGRESS",
      endedAt: null,
      providerCallId: "CA_ACTIVE",
      direction: "INBOUND",
      metadata: {},
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "in-progress" }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sid: "CA_ACTIVE" }),
      } as any);

    await runPostMeetingTerminationWatchdog("call-2");
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/CA_ACTIVE\.json/);
    fetchMock.mockRestore();
  });

  it("marks intent satisfied on terminal lifecycle evidence", async () => {
    prismaMock.callTerminationIntent.findUnique.mockResolvedValue({
      id: "intent-3",
      state: "ARMED",
    });
    await markPostMeetingTerminationSatisfied({
      callId: "call-3",
      source: "TWILIO_TERMINAL",
    });
    expect(prismaMock.callTerminationIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "SATISFIED" }),
      }),
    );
  });

  it("validates post-meeting fallback config defaults", () => {
    const cfg = getPostMeetingTerminationConfig();
    expect(cfg.graceMs).toBeGreaterThanOrEqual(1000);
    expect(cfg.maxAttempts).toBeGreaterThan(0);
    expect(cfg.retryMs).toBeGreaterThan(0);
  });
});
