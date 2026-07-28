import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAiradeskCallContext } from "../src/services/callContext.service";
import { parseScheduledCallContext } from "../src/services/aiScheduledCallContext";

const prismaMock = vi.hoisted(() => ({
  call: {
    findFirst: vi.fn(),
  },
  companySettings: { findUnique: vi.fn() },
  company: { findUnique: vi.fn() },
  knowledgeItem: { findMany: vi.fn() },
  message: { findMany: vi.fn() },
}));

vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));

describe("buildAiradeskCallContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.call.findFirst.mockResolvedValue({
      id: "call-1",
      purpose: "Collect website scope",
      notes: "Internal note",
      preferredLanguage: "ENGLISH",
      preferredCallTime: new Date("2027-01-01T10:00:00.000Z"),
      direction: "OUTBOUND",
      metadata: { timezone: "Asia/Kolkata", callPurpose: "Follow-up" },
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
    prismaMock.knowledgeItem.findMany.mockResolvedValue([
      { title: "Website design", category: "SERVICES" },
    ]);
    prismaMock.message.findMany.mockResolvedValue([
      { senderType: "CUSTOMER", body: "Need ecommerce site" },
    ]);
  });

  it("returns exact objective and private note marker", async () => {
    const context = await buildAiradeskCallContext("call-1", "co-1");
    expect(context.call.collectionGoal).toBe("Collect website scope");
    expect(context.call.extraNotes).toContain("PRIVATE_INTERNAL_NOTE");
    expect(context.call.timezone).toBe("Asia/Kolkata");
    expect(JSON.stringify(context)).not.toMatch(/postgresql:\/\//i);
  });

  it("enforces tenant scope", async () => {
    prismaMock.call.findFirst.mockResolvedValue(null);
    await expect(buildAiradeskCallContext("call-1", "co-1")).rejects.toThrow(
      "call_context_not_found",
    );
  });
});

describe("parseScheduledCallContext privacy contract", () => {
  it("parses structured seed context", () => {
    const parsed = parseScheduledCallContext(
      JSON.stringify({
        kind: "AI_SCHEDULED_CALL",
        version: 2,
        status: "SCHEDULED",
        phone: "+15550100999",
        collectionGoal: "[SEED] Collect details",
        extraNotes: "[SEED PRIVATE NOTE] hidden",
        preferredLanguage: "ENGLISH",
        scheduledAt: "2027-08-01T10:30:00.000Z",
        timezone: "Asia/Kolkata",
        verificationSeed: "DEV_SCHEDULED_CONTEXT_VERIFICATION",
      }),
    );

    expect(parsed?.collectionGoal).toBe("[SEED] Collect details");
    expect(parsed?.extraNotes).toContain("PRIVATE NOTE");
    expect(parsed?.verificationSeed).toBe("DEV_SCHEDULED_CONTEXT_VERIFICATION");
  });
});
