import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirstMock,
  callUpdateMock,
  conversationUpdateMock,
  customerUpdateMock,
  analysisCreateMock,
  analysisUpdateMock,
  transactionMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  callUpdateMock: vi.fn(),
  conversationUpdateMock: vi.fn(),
  customerUpdateMock: vi.fn(),
  analysisCreateMock: vi.fn(),
  analysisUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    call: {
      findFirst: findFirstMock,
      findUnique: vi.fn(),
    },
    $transaction: transactionMock,
  },
}));

import {
  finalizeCall,
  mapTwilioStatusToCallStatus,
  serializePostCallAnalysis,
  shouldApplyCallStatus,
  TERMINAL_CALL_STATUSES,
} from "../src/services/callFinalization.service";

function makeCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "call_1",
    conversationId: "conv_1",
    status: "LIVE",
    durationSeconds: 12,
    transcript: null,
    startedAt: new Date("2026-07-25T01:00:00Z"),
    endedAt: null,
    endReason: null,
    failureReason: null,
    providerCallId: "CA123",
    direction: "INBOUND",
    metadata: {},
    postAnalysis: null,
    conversation: {
      id: "conv_1",
      companyId: "company_1",
      status: "IN_PROGRESS",
      aiSummary: null,
      intent: null,
      aiConfidence: 0,
      nextAction: null,
      lastMessage: null,
      bookingCreated: false,
      customerId: "cust_1",
      customer: {
        id: "cust_1",
        leadStage: "NEW",
        leadScore: 0,
        notes: null,
      },
      messages: [
        {
          senderType: "CUSTOMER",
          body: "I need a website and WhatsApp automation for my clinic.",
          createdAt: new Date("2026-07-25T01:00:10Z"),
        },
        {
          senderType: "AI",
          body: "I can help with that. What is your timeline?",
          createdAt: new Date("2026-07-25T01:00:20Z"),
        },
      ],
    },
    ...overrides,
  };
}

describe("call status mapping", () => {
  it("maps terminal provider statuses", () => {
    expect(mapTwilioStatusToCallStatus("completed")).toBe("COMPLETED");
    expect(mapTwilioStatusToCallStatus("busy")).toBe("BUSY");
    expect(mapTwilioStatusToCallStatus("failed")).toBe("FAILED");
    expect(mapTwilioStatusToCallStatus("no-answer", "OUTBOUND")).toBe("NO_ANSWER");
    expect(mapTwilioStatusToCallStatus("no-answer", "INBOUND")).toBe("MISSED");
  });

  it("does not treat ringing or in-progress as terminal", () => {
    expect(TERMINAL_CALL_STATUSES.has(mapTwilioStatusToCallStatus("ringing"))).toBe(
      false,
    );
    expect(
      TERMINAL_CALL_STATUSES.has(mapTwilioStatusToCallStatus("in-progress")),
    ).toBe(false);
  });

  it("blocks reopening terminal calls", () => {
    expect(shouldApplyCallStatus("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(shouldApplyCallStatus("LIVE", "COMPLETED")).toBe(true);
  });
});

describe("finalizeCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (fn: any) =>
      fn({
        call: { update: callUpdateMock },
        conversation: { update: conversationUpdateMock },
        customer: { update: customerUpdateMock },
        callPostAnalysis: {
          create: analysisCreateMock,
          update: analysisUpdateMock,
        },
      }),
    );
  });

  it("finalizes an ongoing call from a customer-end event and queues analysis", async () => {
    findFirstMock.mockResolvedValue(makeCall());

    const result = await finalizeCall({
      providerCallId: "CA123",
      endReason: "twilio_media_stream_stopped",
    });

    expect(result.callId).toBe("call_1");
    expect(result.alreadyTerminal).toBe(false);
    expect(result.analysisQueued).toBe(true);
    expect(callUpdateMock).toHaveBeenCalled();
    expect(analysisCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          callId: "call_1",
          companyId: "company_1",
          status: "PENDING",
        }),
      }),
    );
  });

  it("finalizes from an AI hangup reason", async () => {
    findFirstMock.mockResolvedValue(makeCall());

    const result = await finalizeCall({
      providerCallId: "CA123",
      endReason: "ai_goodbye_complete",
    });

    expect(result.status).toBe("COMPLETED");
    expect(callUpdateMock.mock.calls[0]?.[0].data.endReason).toBe(
      "ai_goodbye_complete",
    );
  });

  it("finalizes busy/failed/no-answer provider statuses", async () => {
    for (const [providerStatus, terminalStatus] of [
      ["busy", "BUSY"],
      ["failed", "FAILED"],
      ["no-answer", "MISSED"],
    ] as const) {
      vi.clearAllMocks();
      transactionMock.mockImplementation(async (fn: any) =>
        fn({
          call: { update: callUpdateMock },
          conversation: { update: conversationUpdateMock },
          customer: { update: customerUpdateMock },
          callPostAnalysis: {
            create: analysisCreateMock,
            update: analysisUpdateMock,
          },
        }),
      );
      findFirstMock.mockResolvedValue(makeCall({ status: "RINGING" }));

      const result = await finalizeCall({
        providerCallId: "CA123",
        endReason: `twilio_status_${providerStatus}`,
        providerStatus,
        terminalStatus,
        markCompleted: false,
      });

      expect(result.status).toBe(terminalStatus);
    }
  });

  it("is idempotent and preserves first endedAt and completed analysis", async () => {
    const endedAt = new Date("2026-07-25T01:05:00Z");
    findFirstMock.mockResolvedValue(
      makeCall({
        status: "COMPLETED",
        endedAt,
        endReason: "twilio_media_stream_stopped",
        postAnalysis: {
          id: "analysis_1",
          status: "COMPLETED",
          intentLevel: "HIGH",
          intentScore: 70,
        },
      }),
    );

    const result = await finalizeCall({
      providerCallId: "CA123",
      endReason: "twilio_status_completed",
    });

    expect(result.alreadyTerminal).toBe(true);
    expect(callUpdateMock.mock.calls[0]?.[0].data.endedAt).toEqual(endedAt);
    expect(callUpdateMock.mock.calls[0]?.[0].data.endReason).toBe(
      "twilio_media_stream_stopped",
    );
    expect(analysisCreateMock).not.toHaveBeenCalled();
    expect(analysisUpdateMock).not.toHaveBeenCalled();
  });

  it("does not finalize through the wrong company context", async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await finalizeCall({
      providerCallId: "CA123",
      companyId: "other_company",
      endReason: "twilio_status_completed",
    });

    expect(result.callId).toBeNull();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("performs no OpenAI call during finalization", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    findFirstMock.mockResolvedValue(makeCall());

    await finalizeCall({
      providerCallId: "CA123",
      endReason: "ai_goodbye_complete",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("serializePostCallAnalysis", () => {
  it("serializes pending and completed analysis safely", () => {
    expect(serializePostCallAnalysis(null).analysisStatus).toBe("NONE");
    expect(
      serializePostCallAnalysis({
        status: "PENDING",
        intentLevel: null,
        intentScore: null,
        confidence: null,
        requirementSummary: null,
        requirementDetails: null,
        evidenceSignals: null,
        completedAt: null,
        failureCode: null,
        promptVersion: null,
        callId: "call_1",
      }).analysisStatus,
    ).toBe("PENDING");
  });
});
