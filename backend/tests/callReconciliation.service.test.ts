import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  taskFindManyMock,
  callFindManyMock,
  findRelatedMock,
  syncTaskMock,
  finalizeLifecycleMock,
  enqueueMock,
} = vi.hoisted(() => ({
  taskFindManyMock: vi.fn(),
  callFindManyMock: vi.fn(),
  findRelatedMock: vi.fn(),
  syncTaskMock: vi.fn(),
  finalizeLifecycleMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    task: { findMany: taskFindManyMock },
    call: { findMany: callFindManyMock, findFirst: vi.fn() },
  },
}));

vi.mock("../src/services/callLifecycle.service", async () => {
  const actual = await vi.importActual<
    typeof import("../src/services/callLifecycle.service")
  >("../src/services/callLifecycle.service");
  return {
    ...actual,
    findRelatedScheduledTask: findRelatedMock,
    synchronizeRelatedTask: syncTaskMock,
    finalizeCallLifecycle: finalizeLifecycleMock,
    enqueuePostCallProcessing: enqueueMock,
  };
});

import { reconcileCallLifecycle } from "../src/services/callReconciliation.service";

describe("call reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindManyMock.mockResolvedValue([]);
    callFindManyMock.mockResolvedValue([]);
    findRelatedMock.mockResolvedValue(null);
    syncTaskMock.mockResolvedValue({ updated: true, taskId: "task_1", taskStatus: "DONE" });
    finalizeLifecycleMock.mockResolvedValue({});
    enqueueMock.mockResolvedValue(["hume_chat_sync"]);
  });

  it("dry-run performs no writes", async () => {
    callFindManyMock
      .mockResolvedValueOnce([]) // active calls
      .mockResolvedValueOnce([
        {
          id: "call_1",
          status: "COMPLETED",
          conversationId: "conv_1",
          conversation: { companyId: "company_1", status: "IN_PROGRESS" },
          metadata: { taskId: "task_1" },
          providerCallId: "CA123",
          twilioCallSid: "CA123",
          humeChatId: "chat_1",
          endedAt: new Date(),
          updatedAt: new Date(),
          failureReason: null,
          endReason: "twilio_status_completed",
          transcript: "AI: hello",
          postAnalysis: null,
          humeSyncJobs: [],
          humeExpressionAnalysis: null,
          recordingReconstructionStatus: "NOT_REQUESTED",
        },
      ]);
    findRelatedMock.mockResolvedValue({
      id: "task_1",
      status: "DOING",
      aiNotes: JSON.stringify({ kind: "AI_SCHEDULED_CALL", status: "RINGING", phone: "+1", collectionGoal: "x", scheduledAt: "2026-07-28T10:00:00.000Z", timezone: "Asia/Kolkata", version: 2 }),
    });

    const report = await reconcileCallLifecycle({ apply: false });

    expect(report.dryRun).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(syncTaskMock).not.toHaveBeenCalled();
    expect(finalizeLifecycleMock).not.toHaveBeenCalled();
    expect(report.applied).toEqual([]);
  });

  it("apply repairs terminal call + active task", async () => {
    callFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "call_1",
          status: "COMPLETED",
          conversationId: "conv_1",
          conversation: { companyId: "company_1", status: "FOLLOW_UP" },
          metadata: { taskId: "task_1" },
          providerCallId: "CA123",
          twilioCallSid: "CA123",
          humeChatId: null,
          endedAt: new Date(),
          updatedAt: new Date(),
          failureReason: null,
          endReason: "twilio_status_completed",
          transcript: null,
          postAnalysis: { status: "PENDING" },
          humeSyncJobs: [],
          humeExpressionAnalysis: null,
          recordingReconstructionStatus: "NOT_REQUESTED",
        },
      ]);
    findRelatedMock.mockResolvedValue({
      id: "task_1",
      status: "DOING",
    });

    const report = await reconcileCallLifecycle({ apply: true });

    expect(report.dryRun).toBe(false);
    expect(syncTaskMock).toHaveBeenCalled();
    expect(report.applied.some((item) => item.kind === "terminal_call_active_task")).toBe(
      true,
    );
  });

  it("does not fabricate completion for unverified stale active calls", async () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    callFindManyMock
      .mockResolvedValueOnce([
        {
          id: "call_stale",
          status: "RINGING",
          conversationId: "conv_2",
          conversation: { companyId: "company_1" },
          updatedAt: old,
          createdAt: old,
          postAnalysis: null,
          humeSyncJobs: [],
        },
      ])
      .mockResolvedValueOnce([]);

    const report = await reconcileCallLifecycle({
      apply: true,
      staleActiveCallMinutes: 45,
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.kind === "stale_active_call" && finding.repairable === false,
      ),
    ).toBe(true);
    expect(finalizeLifecycleMock).not.toHaveBeenCalled();
  });
});
