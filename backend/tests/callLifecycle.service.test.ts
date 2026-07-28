import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  callFindFirstMock,
  callUpdateMock,
  taskFindFirstMock,
  taskFindManyMock,
  taskUpdateMock,
  analysisCreateMock,
  analysisUpdateMock,
  conversationUpdateMock,
  customerUpdateMock,
  expressionUpsertMock,
  syncFindUniqueMock,
  syncCreateMock,
  syncUpdateMock,
  transactionMock,
  finalizeCallMock,
} = vi.hoisted(() => ({
  callFindFirstMock: vi.fn(),
  callUpdateMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  analysisCreateMock: vi.fn(),
  analysisUpdateMock: vi.fn(),
  conversationUpdateMock: vi.fn(),
  customerUpdateMock: vi.fn(),
  expressionUpsertMock: vi.fn(),
  syncFindUniqueMock: vi.fn(),
  syncCreateMock: vi.fn(),
  syncUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
  finalizeCallMock: vi.fn(),
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    call: {
      findFirst: callFindFirstMock,
      update: callUpdateMock,
    },
    task: {
      findFirst: taskFindFirstMock,
      findMany: taskFindManyMock,
      update: taskUpdateMock,
    },
    humeExpressionAnalysis: {
      upsert: expressionUpsertMock,
    },
    humeChatSyncJob: {
      findUnique: syncFindUniqueMock,
      create: syncCreateMock,
      update: syncUpdateMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock("../src/services/callFinalization.service", async () => {
  const actual = await vi.importActual<
    typeof import("../src/services/callFinalization.service")
  >("../src/services/callFinalization.service");
  return {
    ...actual,
    finalizeCall: finalizeCallMock,
  };
});

import {
  applyHumeChatEndedLifecycle,
  applyTwilioLifecycleEvent,
  canTransitionCallStatus,
  isTerminalCallStatus,
  mapCallStatusToTaskTerminal,
  normalizeTwilioStatus,
  synchronizeRelatedTask,
} from "../src/services/callLifecycle.service";
import {
  stringifyScheduledCallContext,
} from "../src/services/aiScheduledCallContext";

function scheduledNotes(overrides: Record<string, unknown> = {}) {
  return stringifyScheduledCallContext({
    kind: "AI_SCHEDULED_CALL",
    version: 2,
    status: "RINGING",
    phone: "+15551234567",
    collectionGoal: "Collect website requirements",
    preferredLanguage: "AUTO",
    scheduledAt: "2026-07-28T10:00:00.000Z",
    timezone: "Asia/Kolkata",
    callSid: "CA123",
    conversationId: "conv_1",
    ...overrides,
  } as any);
}

describe("call lifecycle state machine", () => {
  it("maps queued → ringing", () => {
    expect(normalizeTwilioStatus("queued")).toBe("RINGING");
    expect(normalizeTwilioStatus("initiated")).toBe("RINGING");
    expect(normalizeTwilioStatus("ringing")).toBe("RINGING");
  });

  it("maps ringing → in-progress", () => {
    expect(normalizeTwilioStatus("in-progress")).toBe("IN_PROGRESS");
    expect(canTransitionCallStatus("RINGING", "IN_PROGRESS")).toBe(true);
  });

  it("maps in-progress → completed", () => {
    expect(normalizeTwilioStatus("completed")).toBe("COMPLETED");
    expect(canTransitionCallStatus("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  it("blocks completed → ringing", () => {
    expect(canTransitionCallStatus("COMPLETED", "RINGING")).toBe(false);
  });

  it("blocks failed → in-progress", () => {
    expect(canTransitionCallStatus("FAILED", "IN_PROGRESS")).toBe(false);
  });

  it("treats unknown provider status as null (safe ignore)", () => {
    expect(normalizeTwilioStatus("weird-status")).toBeNull();
  });

  it("maps task terminals accurately", () => {
    expect(mapCallStatusToTaskTerminal("COMPLETED")).toEqual({
      taskStatus: "DONE",
      notesStatus: "COMPLETED",
    });
    expect(mapCallStatusToTaskTerminal("BUSY").notesStatus).toBe("BUSY");
    expect(mapCallStatusToTaskTerminal("NO_ANSWER").notesStatus).toBe("NO_ANSWER");
    expect(mapCallStatusToTaskTerminal("FAILED").taskStatus).toBe("BLOCKED");
    expect(mapCallStatusToTaskTerminal("CANCELED").notesStatus).toBe("CANCELED");
  });

  it("recognizes terminal statuses", () => {
    expect(isTerminalCallStatus("COMPLETED")).toBe(true);
    expect(isTerminalCallStatus("NO_ANSWER")).toBe(true);
    expect(isTerminalCallStatus("RINGING")).toBe(false);
  });
});

describe("Twilio lifecycle events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores unknown provider status safely", async () => {
    callFindFirstMock.mockResolvedValue({
      id: "call_1",
      status: "RINGING",
      direction: "OUTBOUND",
      conversationId: "conv_1",
      conversation: { companyId: "company_1" },
      metadata: { taskId: "task_1" },
      durationSeconds: 0,
      endedAt: null,
      startedAt: new Date(),
      failureReason: null,
      providerCallId: "CA123",
      twilioCallSid: "CA123",
      humeChatId: null,
    });

    const result = await applyTwilioLifecycleEvent({
      callSid: "CA123",
      twilioStatus: "totally-unknown",
    });

    expect(result.ignored).toBe(true);
    expect(result.ignoreReason).toBe("unknown_provider_status");
    expect(finalizeCallMock).not.toHaveBeenCalled();
  });

  it("finalizes completed callbacks through lifecycle", async () => {
    callFindFirstMock
      .mockResolvedValueOnce({
        id: "call_1",
        status: "IN_PROGRESS",
        direction: "OUTBOUND",
        conversationId: "conv_1",
        conversation: { companyId: "company_1" },
        metadata: { taskId: "task_1" },
        durationSeconds: 12,
        endedAt: null,
        startedAt: new Date("2026-07-28T10:00:00Z"),
        failureReason: null,
        providerCallId: "CA123",
        twilioCallSid: "CA123",
        humeChatId: "chat_1",
      })
      .mockResolvedValueOnce({
        id: "call_1",
        status: "COMPLETED",
        conversationId: "conv_1",
        conversation: { companyId: "company_1" },
        metadata: { taskId: "task_1" },
        providerCallId: "CA123",
        twilioCallSid: "CA123",
        humeChatId: "chat_1",
        endedAt: new Date("2026-07-28T10:05:00Z"),
        failureReason: null,
        endReason: "twilio_status_completed",
        transcript: null,
        postAnalysis: null,
        humeExpressionAnalysis: null,
        humeSyncJobs: [],
        recordingReconstructionStatus: "NOT_REQUESTED",
      });

    callUpdateMock.mockResolvedValue({});
    syncFindUniqueMock.mockResolvedValue(null);
    syncCreateMock.mockResolvedValue({});
    expressionUpsertMock.mockResolvedValue({});
    finalizeCallMock.mockResolvedValue({
      callId: "call_1",
      conversationId: "conv_1",
      companyId: "company_1",
      alreadyTerminal: false,
      analysisQueued: true,
      status: "COMPLETED",
      transcript: null,
      taskId: "task_1",
      taskStatus: "DONE",
      taskUpdated: true,
    });

    const result = await applyTwilioLifecycleEvent({
      callSid: "CA123",
      twilioStatus: "completed",
      durationSeconds: 42,
    });

    expect(finalizeCallMock).toHaveBeenCalled();
    expect(result.nextStatus).toBe("COMPLETED");
    expect(result.taskStatus).toBe("DONE");
  });

  it("does not downgrade completed to ringing", async () => {
    callFindFirstMock.mockResolvedValue({
      id: "call_1",
      status: "COMPLETED",
      direction: "OUTBOUND",
      conversationId: "conv_1",
      conversation: { companyId: "company_1" },
      metadata: { taskId: "task_1" },
      durationSeconds: 40,
      endedAt: new Date("2026-07-28T10:05:00Z"),
      startedAt: new Date("2026-07-28T10:00:00Z"),
      failureReason: null,
      providerCallId: "CA123",
      twilioCallSid: "CA123",
      humeChatId: "chat_1",
      endReason: "twilio_status_completed",
      transcript: null,
      postAnalysis: { status: "PENDING" },
      humeExpressionAnalysis: { id: "expr_1" },
      humeSyncJobs: [{ chatId: "chat_1", status: "COMPLETED" }],
      recordingReconstructionStatus: "QUEUED",
    });
    callUpdateMock.mockResolvedValue({});
    finalizeCallMock.mockResolvedValue({
      callId: "call_1",
      conversationId: "conv_1",
      companyId: "company_1",
      alreadyTerminal: true,
      analysisQueued: false,
      status: "COMPLETED",
      transcript: null,
      taskId: "task_1",
      taskStatus: "DONE",
      taskUpdated: false,
    });

    // First update for ignored non-terminal path isn't used; ringing on terminal call
    // goes through apply=false then still finalizes with previous terminal.
    const result = await applyTwilioLifecycleEvent({
      callSid: "CA123",
      twilioStatus: "ringing",
    });

    expect(result.ignored || result.nextStatus === "COMPLETED").toBe(true);
    if (result.nextStatus) {
      expect(isTerminalCallStatus(result.nextStatus) || result.ignored).toBe(true);
    }
  });
});

describe("Hume chat_ended lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finalizes when chat_ended arrives first", async () => {
    callFindFirstMock
      .mockResolvedValueOnce({
        id: "call_1",
        status: "IN_PROGRESS",
        conversationId: "conv_1",
        conversation: { companyId: "company_1" },
        metadata: { taskId: "task_1" },
        endedAt: null,
        humeChatId: "chat_1",
        providerCallId: "CA123",
        twilioCallSid: "CA123",
        failureReason: null,
        endReason: null,
      })
      .mockResolvedValueOnce({
        id: "call_1",
        status: "COMPLETED",
        conversationId: "conv_1",
        conversation: { companyId: "company_1" },
        metadata: { taskId: "task_1" },
        endedAt: new Date(),
        humeChatId: "chat_1",
        providerCallId: "CA123",
        twilioCallSid: "CA123",
        failureReason: null,
        endReason: "user_hangup",
        transcript: null,
        postAnalysis: null,
        humeExpressionAnalysis: null,
        humeSyncJobs: [],
        recordingReconstructionStatus: "NOT_REQUESTED",
      });
    callUpdateMock.mockResolvedValue({});
    syncFindUniqueMock.mockResolvedValue(null);
    syncCreateMock.mockResolvedValue({});
    expressionUpsertMock.mockResolvedValue({});
    finalizeCallMock.mockResolvedValue({
      callId: "call_1",
      conversationId: "conv_1",
      companyId: "company_1",
      alreadyTerminal: false,
      analysisQueued: true,
      status: "COMPLETED",
      transcript: null,
      taskId: "task_1",
      taskStatus: "DONE",
      taskUpdated: true,
    });

    const result = await applyHumeChatEndedLifecycle({
      chatId: "chat_1",
      endReason: "user_hangup",
      endTimestamp: 1720000000,
    });

    expect(result.applied).toBe(true);
    expect(result.taskStatus).toBe("DONE");
    expect(finalizeCallMock).toHaveBeenCalled();
  });

  it("preserves non-success Twilio terminal on later chat_ended", async () => {
    callFindFirstMock
      .mockResolvedValueOnce({
        id: "call_1",
        status: "NO_ANSWER",
        conversationId: "conv_1",
        conversation: { companyId: "company_1" },
        metadata: { taskId: "task_1" },
        endedAt: new Date("2026-07-28T10:02:00Z"),
        humeChatId: "chat_1",
        providerCallId: "CA123",
        twilioCallSid: "CA123",
        failureReason: "Twilio call status: no-answer",
        endReason: "twilio_status_no-answer",
      })
      .mockResolvedValueOnce({
        id: "call_1",
        status: "NO_ANSWER",
        conversationId: "conv_1",
        conversation: { companyId: "company_1" },
        metadata: { taskId: "task_1" },
        endedAt: new Date("2026-07-28T10:02:00Z"),
        humeChatId: "chat_1",
        providerCallId: "CA123",
        twilioCallSid: "CA123",
        failureReason: "Twilio call status: no-answer",
        endReason: "twilio_status_no-answer",
        transcript: null,
        postAnalysis: null,
        humeExpressionAnalysis: null,
        humeSyncJobs: [],
        recordingReconstructionStatus: "NOT_REQUESTED",
      });
    callUpdateMock.mockResolvedValue({});
    syncFindUniqueMock.mockResolvedValue(null);
    syncCreateMock.mockResolvedValue({});
    expressionUpsertMock.mockResolvedValue({});
    finalizeCallMock.mockResolvedValue({
      callId: "call_1",
      conversationId: "conv_1",
      companyId: "company_1",
      alreadyTerminal: true,
      analysisQueued: false,
      status: "NO_ANSWER",
      transcript: null,
      taskId: "task_1",
      taskStatus: "BLOCKED",
      taskUpdated: false,
    });

    const result = await applyHumeChatEndedLifecycle({
      chatId: "chat_1",
      endReason: "chat_ended",
    });

    expect(result.nextStatus).toBe("NO_ANSWER");
  });
});

describe("synchronizeRelatedTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("terminalizes DOING task to DONE on completed call", async () => {
    taskFindFirstMock.mockResolvedValue({
      id: "task_1",
      status: "DOING",
      completedAt: null,
      conversationId: "conv_1",
      aiNotes: scheduledNotes(),
    });
    taskUpdateMock.mockResolvedValue({});

    const result = await synchronizeRelatedTask({
      companyId: "company_1",
      conversationId: "conv_1",
      callId: "call_1",
      callStatus: "COMPLETED",
      metadata: { taskId: "task_1" },
      providerCallId: "CA123",
      endedAt: new Date("2026-07-28T10:05:00Z"),
    });

    expect(result.updated).toBe(true);
    expect(result.taskStatus).toBe("DONE");
    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DONE" }),
      }),
    );
  });

  it("does not reopen DONE task from busy event", async () => {
    taskFindFirstMock.mockResolvedValue({
      id: "task_1",
      status: "DONE",
      completedAt: new Date("2026-07-28T10:05:00Z"),
      conversationId: "conv_1",
      aiNotes: scheduledNotes({ status: "COMPLETED", completedAt: "2026-07-28T10:05:00.000Z" }),
    });

    const result = await synchronizeRelatedTask({
      companyId: "company_1",
      conversationId: "conv_1",
      callId: "call_1",
      callStatus: "BUSY",
      metadata: { taskId: "task_1" },
      providerCallId: "CA123",
      endedAt: new Date("2026-07-28T10:06:00Z"),
    });

    expect(result.updated).toBe(false);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("sets completedAt only once", async () => {
    const completedAt = new Date("2026-07-28T10:05:00Z");
    taskFindFirstMock.mockResolvedValue({
      id: "task_1",
      status: "DONE",
      completedAt,
      conversationId: "conv_1",
      aiNotes: scheduledNotes({ status: "COMPLETED", completedAt: completedAt.toISOString() }),
    });

    const result = await synchronizeRelatedTask({
      companyId: "company_1",
      conversationId: "conv_1",
      callId: "call_1",
      callStatus: "COMPLETED",
      metadata: { taskId: "task_1" },
      providerCallId: "CA123",
      endedAt: new Date("2026-07-28T10:10:00Z"),
    });

    expect(result.updated).toBe(false);
  });
});
