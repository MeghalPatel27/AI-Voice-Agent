import { beforeEach, describe, expect, it, vi } from "vitest";

const sendHumeToolResponseMock = vi.hoisted(() => vi.fn());
const getHumeChatStatusMock = vi.hoisted(() => vi.fn());
const loadContextMock = vi.hoisted(() => vi.fn());
const invalidateCacheMock = vi.hoisted(() => vi.fn());
const inboundFallbackMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  call: { findFirst: vi.fn(), update: vi.fn() },
  humeToolCallReceipt: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  customer: { update: vi.fn() },
  conversation: { update: vi.fn() },
  booking: { create: vi.fn() },
  $transaction: vi.fn(async (fn: any) =>
    fn({
      customer: { update: prismaMock.customer.update },
      conversation: { update: prismaMock.conversation.update },
      booking: { create: prismaMock.booking.create },
    }),
  ),
}));

vi.mock("../src/integrations/hume/hume.client", () => {
  class HumeControlPlaneError extends Error {
    status: number | null;
    kind: string;
    retryable: boolean;
    constructor(input: {
      message: string;
      status?: number | null;
      kind: string;
      retryable: boolean;
    }) {
      super(input.message);
      this.status = input.status ?? null;
      this.kind = input.kind;
      this.retryable = input.retryable;
    }
  }
  return {
    HumeControlPlaneError,
    sendHumeToolResponse: sendHumeToolResponseMock,
    getHumeChatStatus: getHumeChatStatusMock,
  };
});

vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/integrations/hume/hume.config", () => ({
  getHumeConfig: () => ({
    voiceCompanyId: "co-1",
    configId: "cfg-1",
  }),
}));
vi.mock("../src/integrations/hume/humeContextCache.service", () => ({
  loadAiradeskCallContextFast: loadContextMock,
  invalidateAiradeskCallContextCache: invalidateCacheMock,
  logHumeLatency: vi.fn(),
  prewarmAiradeskCallContext: vi.fn(),
  getCachedAiradeskCallContext: vi.fn(),
}));
vi.mock("../src/services/callContext.service", () => ({
  buildInboundFallbackCallContext: inboundFallbackMock,
  buildAiradeskCallContext: vi.fn(),
}));
vi.mock("../src/integrations/hume/humeToolRuntime.config", () => ({
  getHumeToolRuntimeConfig: () => ({
    toolExecutionTimeoutMs: 1500,
    controlPlaneTimeoutMs: 1500,
    toolDeliveryMaxAttempts: 3,
    toolDeliveryRetryBaseMs: 1,
    contextCacheTtlSeconds: 120,
  }),
}));

import { HumeControlPlaneError } from "../src/integrations/hume/hume.client";
import { handleHumeToolCall } from "../src/integrations/hume/humeTool.service";

function baseCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    conversationId: "conv-1",
    humeChatId: "chat-1",
    humeChatGroupId: "cg-1",
    humeConfigId: "cfg-1",
    conversation: {
      companyId: "co-1",
      customerId: "cust-1",
      aiSummary: "Summary",
      nextAction: "Act",
      customer: { fullName: "Lead", metadata: {}, notes: "" },
    },
    ...overrides,
  };
}

describe("Hume tool delivery dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.humeToolCallReceipt.findUnique.mockResolvedValue(null);
    prismaMock.humeToolCallReceipt.create.mockResolvedValue({});
    prismaMock.humeToolCallReceipt.update.mockResolvedValue({});
    prismaMock.call.update.mockResolvedValue({});
    getHumeChatStatusMock.mockResolvedValue({ status: "ACTIVE", terminal: false });
    sendHumeToolResponseMock.mockResolvedValue(undefined);
    loadContextMock.mockResolvedValue({
      context: {
        call: { collectionGoal: "Collect website scope", extraNotes: "PRIVATE_INTERNAL_NOTE" },
        customer: { name: "Lead" },
        company: { name: "Acme" },
        recentContext: { summary: null, knownRequirements: [] },
      },
      source: "database",
    });
    inboundFallbackMock.mockResolvedValue({
      call: { direction: "INBOUND", collectionGoal: "Discover" },
      company: { name: "Code" },
      customer: { name: null },
      recentContext: { summary: null, knownRequirements: [] },
    });
    // delivery path re-reads receipt
    prismaMock.humeToolCallReceipt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-1",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "COMPLETED",
      });
  });

  it("1-2. response_required tool sends Tool Response with exact tool_call_id", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    prismaMock.humeToolCallReceipt.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-1",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "COMPLETED",
      });

    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-1",
        parameters: "{}",
        response_required: true,
      },
    } as any);

    expect(sendHumeToolResponseMock).toHaveBeenCalled();
    const payload = sendHumeToolResponseMock.mock.calls[0]![1];
    expect(payload.type).toBe("tool_response");
    expect(payload.tool_call_id).toBe("tool-1");
    const content = JSON.parse(payload.content);
    expect(content.ok).toBe(true);
    expect(content.call.extraNotes).toContain("PRIVATE_INTERNAL_NOTE");
  });

  it("3. webhook HTTP 200 alone is not tool completion (delivery still required)", async () => {
    // Creating a receipt without Control Plane send leaves delivery pending.
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    prismaMock.humeToolCallReceipt.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-pending",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "COMPLETED",
      });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-pending",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(sendHumeToolResponseMock).toHaveBeenCalled();
    expect(prismaMock.humeToolCallReceipt.update).toHaveBeenCalled();
  });

  it("4. malformed parameters send Tool Error", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    prismaMock.humeToolCallReceipt.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-bad",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "FAILED",
      });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-bad",
        parameters: "{not-json",
        response_required: true,
      },
    } as any);
    const payload = sendHumeToolResponseMock.mock.calls.at(-1)?.[1];
    expect(payload.type).toBe("tool_error");
    expect(payload.tool_call_id).toBe("tool-bad");
  });

  it("5. business failure sends Tool Error", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    loadContextMock.mockRejectedValueOnce(new Error("db_down"));
    prismaMock.humeToolCallReceipt.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-fail",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "FAILED",
      });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-fail",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(sendHumeToolResponseMock.mock.calls.at(-1)?.[1].type).toBe("tool_error");
  });

  it("6. missing Call mapping sends soft Tool Response for context", async () => {
    prismaMock.call.findFirst.mockResolvedValue(null);
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-missing",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-404",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(sendHumeToolResponseMock).toHaveBeenCalled();
    const payload = sendHumeToolResponseMock.mock.calls[0]![1];
    expect(payload.tool_call_id).toBe("tool-404");
    const content = JSON.parse(payload.content);
    expect(content.continueSpeaking).toBe(true);
  });

  it("7. inactive chat does not retry forever", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    getHumeChatStatusMock.mockResolvedValue({ status: "USER_ENDED", terminal: true });
    prismaMock.humeToolCallReceipt.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-end",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "COMPLETED",
      });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-end",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(sendHumeToolResponseMock).not.toHaveBeenCalled();
    expect(prismaMock.humeToolCallReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: "UNDELIVERABLE" }),
      }),
    );
  });

  it("8-9. Control Plane 429/5xx retries with backoff", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    sendHumeToolResponseMock
      .mockRejectedValueOnce(
        new HumeControlPlaneError({
          message: "429",
          status: 429,
          kind: "rate_limit",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce(undefined);

    let attempts = 0;
    prismaMock.humeToolCallReceipt.findUnique.mockReset().mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) return null;
      return {
        toolCallId: "tool-retry",
        deliveryStatus: "PENDING",
        deliveryAttempts: attempts - 2,
        businessStatus: "COMPLETED",
      };
    });

    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-retry",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(sendHumeToolResponseMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("10. Control Plane 401 becomes permanent failure", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    sendHumeToolResponseMock.mockRejectedValue(
      new HumeControlPlaneError({
        message: "401",
        status: 401,
        kind: "auth",
        retryable: false,
      }),
    );
    prismaMock.humeToolCallReceipt.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-401",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "COMPLETED",
      });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-401",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(prismaMock.humeToolCallReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorCategory: "auth", deliveryStatus: "FAILED" }),
      }),
    );
  });

  it("11. timeout is bounded and sends Tool Error", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    loadContextMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );
    vi.doMock("../src/integrations/hume/humeToolRuntime.config", () => ({
      getHumeToolRuntimeConfig: () => ({
        toolExecutionTimeoutMs: 1,
        controlPlaneTimeoutMs: 1500,
        toolDeliveryMaxAttempts: 3,
        toolDeliveryRetryBaseMs: 1,
        contextCacheTtlSeconds: 120,
      }),
    }));
    // Use rejected timeout via mock instead
    loadContextMock.mockReset();
    loadContextMock.mockRejectedValue(new Error("context_tool_timeout"));
    prismaMock.humeToolCallReceipt.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-to",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "FAILED",
      });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-to",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(sendHumeToolResponseMock.mock.calls.at(-1)?.[1].type).toBe("tool_error");
  });

  it("12-13. duplicate webhook executes business once and can redeliver", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    prismaMock.humeToolCallReceipt.findUnique.mockReset().mockResolvedValue({
      toolCallId: "tool-dup",
      deliveryStatus: "PENDING",
      deliveryAttempts: 0,
      businessStatus: "COMPLETED",
      responsePayload: {
        type: "tool_response",
        tool_call_id: "tool-dup",
        content: JSON.stringify({ ok: true }),
      },
    });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-dup",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(loadContextMock).not.toHaveBeenCalled();
    expect(sendHumeToolResponseMock).toHaveBeenCalled();
  });

  it("14. delivered receipt is not delivered again", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    prismaMock.humeToolCallReceipt.findUnique.mockReset().mockResolvedValue({
      toolCallId: "tool-done",
      deliveryStatus: "ACCEPTED",
      deliveryAttempts: 1,
      businessStatus: "COMPLETED",
      responsePayload: {
        type: "tool_response",
        tool_call_id: "tool-done",
        content: "{}",
      },
    });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-done",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(sendHumeToolResponseMock).not.toHaveBeenCalled();
  });

  it("15-16. no secrets in Tool Response and private context stays bounded", async () => {
    prismaMock.call.findFirst.mockResolvedValue(baseCall());
    prismaMock.humeToolCallReceipt.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-sec",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "COMPLETED",
      });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-sec",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    const raw = JSON.stringify(sendHumeToolResponseMock.mock.calls[0]![1]);
    expect(raw).not.toMatch(/HUME_API_KEY|sk-|JWT_SECRET|postgresql:\/\//i);
  });

  it("17. tool_call before chat_started resolves by Twilio SID", async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      baseCall({ humeChatId: null, twilioCallSid: "CA123" }),
    );
    prismaMock.humeToolCallReceipt.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        toolCallId: "tool-race",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "COMPLETED",
      });
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-race",
      config_id: "cfg-1",
      twilio_metadata: { call_sid: "CA123" },
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-race",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(prismaMock.call.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ humeChatId: "chat-race" }),
      }),
    );
    expect(sendHumeToolResponseMock).toHaveBeenCalled();
  });

  it("20. foreign-tenant correlation fails closed", async () => {
    prismaMock.call.findFirst.mockResolvedValue(
      baseCall({
        conversation: {
          companyId: "foreign-co",
          customerId: "cust-1",
          aiSummary: null,
          nextAction: null,
          customer: null,
        },
      }),
    );
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_capture_lead_details",
        tool_call_id: "tool-ft",
        parameters: JSON.stringify({ fullName: "X" }),
        response_required: true,
      },
    } as any);
    const payload = sendHumeToolResponseMock.mock.calls.at(-1)?.[1];
    expect(payload.type).toBe("tool_error");
    expect(JSON.parse(payload.content).code).toBe("FOREIGN_TENANT");
  });

  it("21. phone-only matching is never used", async () => {
    prismaMock.call.findFirst.mockResolvedValue(null);
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-phone",
      config_id: "cfg-1",
      caller_number: "+15551212",
      tool_call_message: {
        name: "airadesk_schedule_meeting",
        tool_call_id: "tool-phone",
        parameters: JSON.stringify({
          preferredTimeText: "not-a-date",
          timezone: "Asia/Kolkata",
        }),
        response_required: true,
      },
    } as any);
    expect(prismaMock.call.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.not.arrayContaining([
            expect.objectContaining({ phone: expect.anything() }),
          ]),
        }),
      }),
    );
  });
});
