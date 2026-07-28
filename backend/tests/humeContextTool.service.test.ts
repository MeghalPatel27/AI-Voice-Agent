import { beforeEach, describe, expect, it, vi } from "vitest";

const sendHumeToolResponseMock = vi.hoisted(() => vi.fn());
const getHumeChatStatusMock = vi.hoisted(() => vi.fn());
const loadContextMock = vi.hoisted(() => vi.fn());
const inboundFallbackMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  call: { findFirst: vi.fn(), update: vi.fn() },
  humeToolCallReceipt: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../src/integrations/hume/hume.client", () => ({
  HumeControlPlaneError: class extends Error {},
  sendHumeToolResponse: sendHumeToolResponseMock,
  getHumeChatStatus: getHumeChatStatusMock,
}));
vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/integrations/hume/hume.config", () => ({
  getHumeConfig: () => ({ voiceCompanyId: "co-1", configId: "cfg-1" }),
}));
vi.mock("../src/integrations/hume/humeContextCache.service", () => ({
  loadAiradeskCallContextFast: loadContextMock,
  invalidateAiradeskCallContextCache: vi.fn(),
  logHumeLatency: vi.fn(),
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

import { handleHumeToolCall } from "../src/integrations/hume/humeTool.service";

describe("airadesk_get_call_context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHumeChatStatusMock.mockResolvedValue({ status: "ACTIVE", terminal: false });
    sendHumeToolResponseMock.mockResolvedValue(undefined);
    prismaMock.humeToolCallReceipt.create.mockResolvedValue({});
    prismaMock.humeToolCallReceipt.update.mockResolvedValue({});
    prismaMock.call.update.mockResolvedValue({});
    inboundFallbackMock.mockResolvedValue({
      call: { direction: "INBOUND", collectionGoal: "Discover" },
      company: { name: "Code" },
      customer: { name: null },
      recentContext: { summary: null, knownRequirements: [] },
    });
  });

  it("returns structured context with private note warning", async () => {
    prismaMock.call.findFirst.mockResolvedValue({
      id: "call-1",
      humeChatId: "chat-1",
      conversationId: "conv-1",
      conversation: {
        companyId: "co-1",
        customerId: "cust-1",
        aiSummary: "Summary",
        nextAction: null,
        customer: { fullName: "Lead", metadata: {}, notes: "" },
      },
    });
    loadContextMock.mockResolvedValue({
      context: {
        call: {
          collectionGoal: "Collect website scope",
          extraNotes: "note\n[PRIVATE_INTERNAL_NOTE: never read verbatim to caller]",
        },
        customer: { name: "Lead" },
        company: { name: "Acme" },
        recentContext: { summary: "Summary", knownRequirements: [] },
      },
      source: "database",
    });
    let findCount = 0;
    prismaMock.humeToolCallReceipt.findUnique.mockImplementation(async () => {
      findCount += 1;
      if (findCount === 1) return null;
      return {
        toolCallId: "tool-1",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "COMPLETED",
      };
    });

    const result = await handleHumeToolCall({
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

    expect(result).toMatchObject({ acknowledged: true });
    expect(prismaMock.humeToolCallReceipt.create).toHaveBeenCalled();
    expect(loadContextMock).toHaveBeenCalled();
    expect(sendHumeToolResponseMock).toHaveBeenCalled();
    const payload = sendHumeToolResponseMock.mock.calls[0]?.[1] as any;
    const content = JSON.parse(payload.content);
    expect(content.call.collectionGoal).toBe("Collect website scope");
    expect(content.call.extraNotes).toContain("PRIVATE_INTERNAL_NOTE");
    expect(content.customer.name).toBe("Lead");
  });

  it("soft-fails with inbound fallback when chat mapping is missing", async () => {
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
    const payload = sendHumeToolResponseMock.mock.calls[0]?.[1] as any;
    expect(payload.type).toBe("tool_response");
    const content = JSON.parse(payload.content);
    expect(content.continueSpeaking).toBe(true);
    expect(content.call.direction).toBe("INBOUND");
    expect(content.company.name).toBe("Code");
  });

  it("22. reuses prewarmed context cache", async () => {
    prismaMock.call.findFirst.mockResolvedValue({
      id: "call-1",
      humeChatId: "chat-1",
      conversationId: "conv-1",
      conversation: {
        companyId: "co-1",
        customerId: null,
        aiSummary: null,
        nextAction: null,
        customer: null,
      },
    });
    loadContextMock.mockResolvedValue({
      context: {
        call: { collectionGoal: "Cached goal" },
        company: { name: "Acme" },
        customer: { name: null },
        recentContext: { summary: null, knownRequirements: [] },
      },
      source: "cache",
    });
    let findCount = 0;
    prismaMock.humeToolCallReceipt.findUnique.mockImplementation(async () => {
      findCount += 1;
      if (findCount === 1) return null;
      return {
        toolCallId: "tool-cache",
        deliveryStatus: "PENDING",
        deliveryAttempts: 0,
        businessStatus: "COMPLETED",
      };
    });

    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      config_id: "cfg-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-cache",
        parameters: "{}",
        response_required: true,
      },
    } as any);

    expect(loadContextMock).toHaveBeenCalled();
    const content = JSON.parse(sendHumeToolResponseMock.mock.calls[0]![1].content);
    expect(content.contextSource).toBe("cache");
  });
});
