import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateCallAssignment } from "../src/controllers/call.controller";

const prismaMock = vi.hoisted(() => ({
  call: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
  conversation: {
    update: vi.fn(),
  },
  booking: {
    findMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("updateCallAssignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.call.update.mockResolvedValue({
      id: "call-1",
      assignedUserId: "user-2",
      assignedUser: { id: "user-2", name: "Alex", email: "alex@example.com" },
    });
    prismaMock.booking.findMany.mockResolvedValue([
      { id: "booking-1", assignedUserId: "user-3" },
    ]);
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  it("rejects unauthorized roles", async () => {
    const req: any = {
      user: { userId: "user-1", companyId: "company-1", role: "STAFF" },
      params: { callId: "call-1" },
      body: { assignedUserId: "00000000-0000-4000-8000-000000000002" },
    };
    const res = mockRes();
    await updateCallAssignment(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("rejects foreign-company assignee", async () => {
    prismaMock.call.findFirst.mockResolvedValue({
      id: "call-1",
      conversationId: "conv-1",
      conversation: { bookings: [] },
    });
    prismaMock.user.findFirst.mockResolvedValue(null);

    const req: any = {
      user: { userId: "user-1", companyId: "company-1", role: "ADMIN" },
      params: { callId: "call-1" },
      body: { assignedUserId: "00000000-0000-4000-8000-000000000099" },
    };
    const res = mockRes();
    await updateCallAssignment(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updates call and conversation ownership without altering bookings", async () => {
    prismaMock.call.findFirst.mockResolvedValue({
      id: "call-1",
      conversationId: "conv-1",
      conversation: {
        bookings: [{ id: "booking-1", assignedUserId: "user-3" }],
      },
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000002",
      companyId: "company-1",
      isActive: true,
    });

    const req: any = {
      user: { userId: "user-1", companyId: "company-1", role: "ADMIN" },
      params: { callId: "call-1" },
      body: { assignedUserId: "00000000-0000-4000-8000-000000000002" },
    };
    const res = mockRes();
    await updateCallAssignment(req, res);

    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { assignedUserId: "00000000-0000-4000-8000-000000000002" },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingOwnershipUnchanged: true,
      }),
    );
  });
});
