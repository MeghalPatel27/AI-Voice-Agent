import { beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleAiCallTask } from "../src/controllers/task.controller";

const prismaMock = vi.hoisted(() => ({
  customer: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  task: {
    create: vi.fn(),
  },
}));

vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));

function resMock() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("scheduleAiCallTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.customer.findFirst.mockResolvedValue(null);
    prismaMock.customer.create.mockResolvedValue({
      id: "cust-1",
      fullName: "Lead",
      phone: "+919999999999",
    });
    prismaMock.task.create.mockResolvedValue({ id: "task-1" });
  });

  it("saves collectionGoal, extraNotes and preferredLanguage in task context", async () => {
    const req: any = {
      user: { companyId: "co-1", userId: "u-1" },
      body: {
        fullName: "Lead",
        phone: "+919999999999",
        scheduledAt: "2027-01-01T10:00:00.000Z",
        timezone: "Asia/Kolkata",
        collectionGoal: "Collect budget and timeline",
        callPurpose: "Website follow up",
        extraNotes: "Private background",
        preferredLanguage: "HINDI",
        priority: "HIGH",
      },
    };
    const res = resMock();

    await scheduleAiCallTask(req, res);

    expect(prismaMock.task.create).toHaveBeenCalled();
    const createArg = prismaMock.task.create.mock.calls[0]?.[0] as any;
    const aiNotes = JSON.parse(createArg.data.aiNotes);
    expect(aiNotes.collectionGoal).toBe("Collect budget and timeline");
    expect(aiNotes.extraNotes).toBe("Private background");
    expect(aiNotes.preferredLanguage).toBe("HINDI");
    expect(aiNotes.timezone).toBe("Asia/Kolkata");
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects empty collectionGoal", async () => {
    const req: any = {
      user: { companyId: "co-1", userId: "u-1" },
      body: {
        phone: "+919999999999",
        scheduledAt: "2027-01-01T10:00:00.000Z",
        collectionGoal: " ",
      },
    };
    const res = resMock();
    await scheduleAiCallTask(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects foreign-company customer", async () => {
    prismaMock.customer.findFirst
      .mockResolvedValueOnce(null) // explicit customer lookup
      .mockResolvedValueOnce(null); // phone lookup
    const req: any = {
      user: { companyId: "co-1", userId: "u-1" },
      body: {
        customerId: "foreign-customer",
        phone: "+919999999999",
        scheduledAt: "2027-01-01T10:00:00.000Z",
        collectionGoal: "Collect requirements",
      },
    };
    const res = resMock();
    await scheduleAiCallTask(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
