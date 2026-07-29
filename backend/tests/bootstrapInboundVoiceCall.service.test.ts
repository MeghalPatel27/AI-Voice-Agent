import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({
  prisma: {
    channelEndpoint: { findMany: vi.fn() },
    customer: { findFirst: vi.fn(), create: vi.fn() },
    conversation: { create: vi.fn() },
    call: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../src/integrations/hume/humeContextCache.service", () => ({
  prewarmAiradeskCallContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/services/callFinalization.service", () => ({
  shouldApplyCallStatus: () => true,
}));

import { prisma } from "../src/db/prisma";
import { bootstrapInboundVoiceCall } from "../src/services/bootstrapInboundVoiceCall.service";

describe("bootstrapInboundVoiceCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.channelEndpoint.findMany).mockResolvedValue([
      {
        id: "endpoint-1",
        companyId: "company-1",
        company: { id: "company-1", name: "Easyestate.in" },
      },
    ] as any);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: "cust-1",
      phone: "+15551234567",
    } as any);
    vi.mocked(prisma.call.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.conversation.create).mockResolvedValue({
      id: "conv-1",
    } as any);
    vi.mocked(prisma.call.create).mockResolvedValue({
      id: "call-1",
      conversationId: "conv-1",
      direction: "INBOUND",
      humeChatId: "chat-1",
    } as any);
  });

  it("creates inbound Call with call-specific Conversation", async () => {
    const result = await bootstrapInboundVoiceCall({
      providerCallId: "CA123",
      callerPhone: "+15551234567",
      calledNumber: "+15716095892",
      humeChatId: "chat-1",
      direction: "INBOUND",
    });

    expect(result.created).toBe(true);
    expect(result.call.id).toBe("call-1");
    expect(prisma.conversation.create).toHaveBeenCalled();
    expect(prisma.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "INBOUND",
          providerCallId: "CA123",
          humeChatId: "chat-1",
        }),
      }),
    );
  });

  it("converges on existing Twilio SID", async () => {
    vi.mocked(prisma.call.findFirst).mockResolvedValue({
      id: "call-existing",
      conversationId: "conv-existing",
      status: "IN_PROGRESS",
      metadata: {},
      conversation: { companyId: "company-1" },
    } as any);
    vi.mocked(prisma.call.update).mockResolvedValue({
      id: "call-existing",
      humeChatId: "chat-2",
    } as any);

    const result = await bootstrapInboundVoiceCall({
      providerCallId: "CA123",
      callerPhone: "+15551234567",
      calledNumber: "+15716095892",
      humeChatId: "chat-2",
    });

    expect(result.created).toBe(false);
    expect(prisma.call.update).toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it("rejects foreign-company Call mapping", async () => {
    vi.mocked(prisma.call.findFirst).mockResolvedValue({
      id: "call-existing",
      conversationId: "conv-existing",
      status: "IN_PROGRESS",
      metadata: {},
      conversation: { companyId: "other-company" },
    } as any);

    await expect(
      bootstrapInboundVoiceCall({
        providerCallId: "CA123",
        callerPhone: "+15551234567",
        calledNumber: "+15716095892",
      }),
    ).rejects.toThrow("foreign_tenant_call_mapping");
  });

  it("fails closed when called endpoint is missing", async () => {
    vi.mocked(prisma.channelEndpoint.findMany).mockResolvedValue([] as any);
    await expect(
      bootstrapInboundVoiceCall({
        providerCallId: "CA123",
        callerPhone: "+15551234567",
        calledNumber: "+15716095892",
      }),
    ).rejects.toThrow("inbound_endpoint_not_found");
  });

  it("fails closed for multiple active endpoint matches", async () => {
    vi.mocked(prisma.channelEndpoint.findMany).mockResolvedValue([
      {
        id: "endpoint-1",
        companyId: "company-1",
        company: { id: "company-1", name: "Easyestate.in" },
      },
      {
        id: "endpoint-2",
        companyId: "company-2",
        company: { id: "company-2", name: "Other Co" },
      },
    ] as any);
    await expect(
      bootstrapInboundVoiceCall({
        providerCallId: "CA123",
        callerPhone: "+15551234567",
        calledNumber: "+15716095892",
      }),
    ).rejects.toThrow("inbound_endpoint_multiple_matches");
  });
});
