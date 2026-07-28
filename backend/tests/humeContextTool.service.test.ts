import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleHumeToolCall } from "../src/integrations/hume/humeTool.service";

const sendHumeToolResponseMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  call: { findFirst: vi.fn() },
  humeToolCallReceipt: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  companySettings: { findUnique: vi.fn() },
  company: { findUnique: vi.fn() },
  knowledgeItem: { findMany: vi.fn() },
  message: { findMany: vi.fn() },
}));

vi.mock("../src/integrations/hume/hume.client", () => ({
  sendHumeToolResponse: sendHumeToolResponseMock,
}));
vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));

describe("airadesk_get_call_context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.humeToolCallReceipt.findUnique.mockResolvedValue(null);
    prismaMock.humeToolCallReceipt.create.mockResolvedValue({});
    prismaMock.humeToolCallReceipt.update.mockResolvedValue({});
  });

  it("returns structured context with private note warning", async () => {
    prismaMock.call.findFirst.mockResolvedValue({
      id: "call-1",
      phone: "+91999",
      purpose: "Collect website scope",
      notes: "Internal note",
      preferredLanguage: "ENGLISH",
      preferredCallTime: new Date("2027-01-01T10:00:00.000Z"),
      direction: "OUTBOUND",
      metadata: { timezone: "Asia/Kolkata" },
      conversationId: "conv-1",
      conversation: {
        companyId: "co-1",
        aiSummary: "Summary",
        customer: { fullName: "Lead", preferredLanguage: "HINDI" },
      },
    });
    prismaMock.companySettings.findUnique.mockResolvedValue({
      businessType: "Agency",
      aiTone: "Warm",
    });
    prismaMock.company.findUnique.mockResolvedValue({ name: "Acme", industry: "OTHER" });
    prismaMock.knowledgeItem.findMany.mockResolvedValue([{ title: "Website design", category: "SERVICES" }]);
    prismaMock.message.findMany.mockResolvedValue([{ senderType: "CUSTOMER", body: "Need ecommerce site" }]);

    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-1",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-1",
        parameters: "{}",
      },
    } as any);

    const payload = sendHumeToolResponseMock.mock.calls[0]?.[1] as any;
    const content = JSON.parse(payload.content);
    expect(content.call.collectionGoal).toBe("Collect website scope");
    expect(content.call.extraNotes).toContain("PRIVATE_INTERNAL_NOTE");
    expect(content.customer.name).toBe("Lead");
  });

  it("returns tool error when chat mapping is missing", async () => {
    prismaMock.call.findFirst.mockResolvedValue(null);
    await handleHumeToolCall({
      event_name: "tool_call",
      chat_id: "chat-missing",
      tool_call_message: {
        name: "airadesk_get_call_context",
        tool_call_id: "tool-404",
        parameters: "{}",
      },
    } as any);
    const payload = sendHumeToolResponseMock.mock.calls[0]?.[1] as any;
    expect(payload.type).toBe("tool_error");
    expect(payload.content).toContain("CALL_CONTEXT_NOT_FOUND");
  });
});
