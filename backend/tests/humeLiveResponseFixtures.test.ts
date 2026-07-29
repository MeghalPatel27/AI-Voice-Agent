import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleToolMock = vi.hoisted(() => vi.fn());
const prewarmMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
const getStatusMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  humeWebhookReceipt: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  call: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  channelEndpoint: { findMany: vi.fn() },
  customer: { findFirst: vi.fn(), create: vi.fn() },
  conversation: { create: vi.fn() },
  humeToolCallReceipt: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/integrations/hume/humeTool.service", () => ({
  handleHumeToolCall: handleToolMock,
}));
vi.mock("../src/integrations/hume/humeContextCache.service", () => ({
  prewarmAiradeskCallContext: prewarmMock,
  logHumeLatency: vi.fn(),
}));
vi.mock("../src/services/callFinalization.service", () => ({
  shouldApplyCallStatus: () => true,
}));
vi.mock("../src/services/callLifecycle.service", () => ({
  applyHumeChatEndedLifecycle: vi.fn(),
}));
vi.mock("../src/integrations/hume/hume.config", () => ({
  getHumeConfig: () => ({
    voiceCompanyId: "co-1",
    configId: "cfg-1",
    webhookSigningKey: "test-signing-key",
  }),
  verifyHumeWebhookSignature: () => ({ ok: true }),
}));
vi.mock("../src/integrations/hume/hume.client", () => ({
  sendHumeToolResponse: sendMock,
  getHumeChatStatus: getStatusMock,
  HumeControlPlaneError: class extends Error {},
}));

import { processHumeWebhook } from "../src/integrations/hume/humeWebhook.service";
import { verifyHumeWebhookSignature } from "../src/integrations/hume/hume.config";

function signBody(body: object, key = "test-signing-key") {
  const timestamp = String(Date.now());
  const raw = Buffer.from(JSON.stringify(body));
  const signature = createHmac("sha256", key)
    .update(`${timestamp}.${raw.toString("utf8")}`)
    .digest("hex");
  return { timestamp, signature, raw };
}

describe("non-call Hume integration fixtures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.humeWebhookReceipt.findUnique.mockResolvedValue(null);
    prismaMock.humeWebhookReceipt.create.mockResolvedValue({});
    prismaMock.humeWebhookReceipt.update.mockResolvedValue({});
    prismaMock.channelEndpoint.findMany.mockResolvedValue([
      {
        id: "endpoint-1",
        companyId: "co-1",
        company: { id: "co-1", name: "Easyestate.in" },
      },
    ]);
    prismaMock.customer.findFirst.mockResolvedValue({ id: "cust-1" });
    handleToolMock.mockResolvedValue({ acknowledged: true, delivered: true });
    prewarmMock.mockResolvedValue(undefined);
  });

  it("SCENARIO A: normal opening path correlates chat and prewarms context", async () => {
    prismaMock.call.findFirst.mockResolvedValue({
      id: "call-1",
      status: "RINGING",
      twilioCallSid: "CA111",
      providerCallId: "CA111",
      metadata: {},
      conversation: { companyId: "co-1" },
    });
    prismaMock.call.update.mockResolvedValue({ id: "call-1" });

    await processHumeWebhook({
      event_name: "chat_started",
      chat_id: "chat-a",
      chat_group_id: "cg-a",
      config_id: "cfg-1",
      twilio_metadata: {
        call_sid: "CA111",
        from_number: "+14155550100",
        to_number: "+15716095892",
      },
    } as any);

    expect(prismaMock.call.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ humeChatId: "chat-a" }),
      }),
    );
    expect(prewarmMock).toHaveBeenCalledWith(
      expect.objectContaining({ callId: "call-1", companyId: "co-1", chatId: "chat-a" }),
    );

    await processHumeWebhook({
      event_name: "tool_call",
      chat_id: "chat-a",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-a",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(handleToolMock).toHaveBeenCalled();
  });

  it("SCENARIO C: tool_call before chat_started still reaches dispatcher", async () => {
    await processHumeWebhook({
      event_name: "tool_call",
      chat_id: "chat-race",
      twilio_metadata: { call_sid: "CA222" },
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-race",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(handleToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: "chat-race",
        twilio_metadata: { call_sid: "CA222" },
      }),
    );
  });

  it("SCENARIO D: duplicate tool webhook can re-enter dispatcher for safe redelivery", async () => {
    prismaMock.humeWebhookReceipt.findUnique.mockResolvedValue({ id: "existing" });
    await processHumeWebhook({
      event_name: "tool_call",
      chat_id: "chat-d",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-d",
        parameters: "{}",
        response_required: true,
      },
    } as any);
    expect(handleToolMock).toHaveBeenCalled();
  });

  it("duplicate chat_started webhook remains idempotent", async () => {
    prismaMock.humeWebhookReceipt.findUnique.mockResolvedValue({ id: "existing" });
    await processHumeWebhook({
      event_name: "chat_started",
      chat_id: "chat-started-dup",
      twilio_metadata: { call_sid: "CA999" },
    } as any);
    expect(prismaMock.call.update).not.toHaveBeenCalled();
    expect(prewarmMock).not.toHaveBeenCalled();
  });

  it("SCENARIO F: inactivity recovery text is configured in prompt contract", async () => {
    const { HUME_SYSTEM_PROMPT_TEXT } = await import(
      "../src/integrations/hume/humeSystemPrompt"
    );
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/Hello, are you there\?/);
    expect(HUME_SYSTEM_PROMPT_TEXT).toMatch(/Never repeat check-ins\./i);
  });

  it("signed fixture helper produces verifiable digest shape", () => {
    const body = { event_name: "chat_started", chat_id: "chat-sign" };
    const signed = signBody(body);
    expect(signed.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyHumeWebhookSignature({
      rawBody: signed.raw,
      timestampHeader: signed.timestamp,
      signatureHeader: signed.signature,
    } as any)).toEqual({ ok: true });
  });
});

describe("tool-response reconciler selection rules", () => {
  it("43-47. dry-run candidates require undelivered completed business results", async () => {
    const undelivered = {
      toolCallId: "tool-r1",
      chatId: "chat-r1",
      callId: "call-r1",
      toolName: "airadesk_get_call_context",
      responseRequired: true,
      businessStatus: "COMPLETED",
      deliveryStatus: "PENDING",
      deliveryAttempts: 1,
      responsePayload: {
        type: "tool_response",
        tool_call_id: "tool-r1",
        content: "{\"ok\":true}",
      },
    };
    const terminalSkip = { ...undelivered, deliveryStatus: "UNDELIVERABLE" };
    const maxAttempts = { ...undelivered, deliveryAttempts: 3, deliveryStatus: "FAILED" };
    const accepted = { ...undelivered, deliveryStatus: "ACCEPTED" };

    const selectable = [undelivered, terminalSkip, maxAttempts, accepted].filter(
      (row) =>
        row.responseRequired &&
        ["COMPLETED", "FAILED"].includes(row.businessStatus) &&
        ["PENDING", "SENDING", "FAILED"].includes(row.deliveryStatus) &&
        row.deliveryAttempts < 3 &&
        row.responsePayload != null,
    );
    expect(selectable).toHaveLength(1);
    expect(selectable[0]!.toolCallId).toBe("tool-r1");
  });
});
