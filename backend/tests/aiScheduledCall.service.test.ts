import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAiScheduledCallWorkerOnce } from "../src/services/aiScheduledCall.service";

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  customer: {
    findFirst: vi.fn(),
  },
  conversation: {
    create: vi.fn(),
    update: vi.fn(),
  },
  message: {
    create: vi.fn(),
  },
  call: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
}));

const dialMock = vi.hoisted(() => vi.fn());

vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/integrations/hume/hume.config", () => ({
  buildHumeTwilioUrl: vi.fn(() => "https://api.hume.ai/v0/evi/twilio?x=y"),
}));
vi.mock("../src/services/aiScheduledCallDial", async () => {
  const actual = await vi.importActual("../src/services/aiScheduledCallDial");
  return {
    ...actual,
    twilioScheduledCallDialAdapter: {
      dial: dialMock,
    },
  };
});

describe("runAiScheduledCallWorkerOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialMock.mockResolvedValue({ ok: true, callSid: "CA123", initialStatus: "queued" });
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_PHONE_NUMBER = "+11111111111";
    process.env.PUBLIC_WEBHOOK_URL = "https://example.com";
    process.env.HUME_CONFIG_ID = "cfg-1";
    prismaMock.call.findUnique.mockResolvedValue({ metadata: { source: "AI_SCHEDULED_CALL_TASK" } });
  });

  it("copies scheduled context into call canonical fields", async () => {
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        companyId: "co-1",
        customerId: "cust-1",
        dueAt: new Date("2027-01-01T10:00:00.000Z"),
        priority: "HIGH",
        aiNotes: JSON.stringify({
          kind: "AI_SCHEDULED_CALL",
          version: 2,
          status: "SCHEDULED",
          phone: "+919999999999",
          fullName: "Lead",
          collectionGoal: "Collect budget",
          callPurpose: "Website follow-up",
          extraNotes: "Private note",
          preferredLanguage: "HINDI",
          scheduledAt: "2027-01-01T10:00:00.000Z",
          timezone: "Asia/Kolkata",
        }),
        customer: { id: "cust-1", phone: "+919999999999", fullName: "Lead" },
      },
    ]);
    prismaMock.customer.findFirst.mockResolvedValue({
      id: "cust-1",
      companyId: "co-1",
      fullName: "Lead",
      notes: "",
    });
    prismaMock.conversation.create.mockResolvedValue({ id: "conv-1" });
    prismaMock.call.create.mockResolvedValue({ id: "call-1" });
    prismaMock.call.findFirst.mockResolvedValue(null);

    await runAiScheduledCallWorkerOnce(1);

    expect(prismaMock.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purpose: "Collect budget",
          notes: "Private note",
          preferredLanguage: "HINDI",
          preferredCallTime: expect.any(Date),
        }),
      }),
    );
    expect(dialMock).toHaveBeenCalledTimes(1);
  });

  it("does not create duplicate call on retry", async () => {
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        companyId: "co-1",
        dueAt: new Date(),
        priority: "HIGH",
        aiNotes: JSON.stringify({
          kind: "AI_SCHEDULED_CALL",
          version: 2,
          status: "SCHEDULED",
          phone: "+919999999999",
          collectionGoal: "Collect budget",
          preferredLanguage: "AUTO",
          scheduledAt: "2027-01-01T10:00:00.000Z",
          conversationId: "conv-1",
          callSid: "CA_EXISTING",
          timezone: "Asia/Kolkata",
        }),
        customer: { id: "cust-1", phone: "+919999999999" },
      },
    ]);
    prismaMock.call.findFirst.mockResolvedValue({ id: "call-existing" });

    const result = await runAiScheduledCallWorkerOnce(1);
    expect(result.skipped).toBe(1);
    expect(prismaMock.call.create).not.toHaveBeenCalled();
    expect(dialMock).not.toHaveBeenCalled();
  });
});
