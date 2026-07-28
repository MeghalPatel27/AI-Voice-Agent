import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { cleanup, render, screen, waitFor, renderHook } from "@testing-library/react";
import TasksPage from "./tasks";
import { isLiveCallStatus } from "./lib/postCallAnalysis";
import {
  isActiveTaskStatus,
  useBoundedLivePoll,
} from "./lib/livePoll";

vi.mock("./lib/api", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./lib/api";

const mockedApiFetch = vi.mocked(apiFetch);

function makeOperationsPayload(tasks: Array<Record<string, unknown>>) {
  const doing = tasks.filter((task) => task.status === "DOING").length;
  const done = tasks.filter((task) => task.status === "DONE").length;
  const blocked = tasks.filter((task) => task.status === "BLOCKED").length;
  return {
    summary: {
      total: tasks.length,
      open: tasks.filter((task) => task.status === "OPEN").length,
      doing,
      dueToday: 0,
      overdue: 0,
      unassigned: 0,
      blocked,
      critical: 0,
      completedToday: done,
      completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    },
    tasks,
    todayFocus: tasks.slice(0, 3),
    teamMembers: [],
    taskTypes: [],
  };
}

const doingTask = {
  id: "task-doing",
  title: "AI call Meghal",
  description: "Collect requirements",
  status: "DOING",
  priority: "HIGH",
  taskType: "AI_CALL",
  taskTypeLabel: "AI Call",
  source: "AI Scheduled Call",
  assignedUserId: null,
  manualOwner: "AI Caller",
  ownerLabel: "AI Caller",
  ownerType: "AI",
  customerId: null,
  customerName: "Meghal",
  customerPhone: "+919999999999",
  conversationId: "conv-1",
  conversationChannel: "AI_CALL",
  dueAt: "2026-07-28T10:00:00.000Z",
  dueLabel: "Today",
  delayLabel: "",
  slaLabel: "On track",
  nextAction: "Wait for call",
  warnings: [],
  aiNotes: "AI scheduled call",
  scheduledCall: {
    status: "RINGING",
    latestCallStatus: "IN_PROGRESS",
    relatedCallId: "call-1",
    callSid: "CA123",
    phone: "+919999999999",
    preferredLanguage: "AUTO",
    purpose: "Collect requirements",
    meetingTime: null,
    error: null,
    analysisStatus: null,
    transcriptSyncStatus: null,
    recordingReconstructionStatus: null,
  },
  leadRequirements: null,
  blockedReason: "",
  isEmergency: false,
  isOverdue: false,
  isDueToday: true,
  isUnassigned: true,
  createdAt: "2026-07-28T09:00:00.000Z",
  updatedAt: "2026-07-28T10:00:00.000Z",
  completedAt: null,
  timeline: [],
};

describe("task lifecycle UI updates", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("changes Doing to Completed from a lifecycle refresh", async () => {
    let payload = makeOperationsPayload([doingTask]);
    mockedApiFetch.mockImplementation(async (path: string) => {
      if (String(path).startsWith("/api/tasks/operations")) return payload;
      throw new Error(`Unexpected path ${path}`);
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Doing").length).toBeGreaterThan(0);
    });

    payload = makeOperationsPayload([
      {
        ...doingTask,
        status: "DONE",
        completedAt: "2026-07-28T10:05:00.000Z",
        scheduledCall: {
          ...doingTask.scheduledCall,
          status: "COMPLETED",
          latestCallStatus: "COMPLETED",
          analysisStatus: "PENDING",
          transcriptSyncStatus: "PENDING",
        },
      },
    ]);

    await vi.advanceTimersByTimeAsync(4500);

    await waitFor(() => {
      expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
    });
  });

  it("changes Doing to Failed/Blocked from a lifecycle refresh", async () => {
    let payload = makeOperationsPayload([doingTask]);
    mockedApiFetch.mockImplementation(async (path: string) => {
      if (String(path).startsWith("/api/tasks/operations")) return payload;
      throw new Error(`Unexpected path ${path}`);
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Doing").length).toBeGreaterThan(0);
    });

    payload = makeOperationsPayload([
      {
        ...doingTask,
        status: "BLOCKED",
        blockedReason: "Twilio call status: no-answer",
        scheduledCall: {
          ...doingTask.scheduledCall,
          status: "NO_ANSWER",
          latestCallStatus: "NO_ANSWER",
          error: "Twilio call status: no-answer",
        },
      },
    ]);

    await vi.advanceTimersByTimeAsync(4500);

    await waitFor(() => {
      expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    });
  });

  it("does not display no-answer as successful completion", () => {
    expect(isLiveCallStatus("NO_ANSWER")).toBe(false);
    expect(isActiveTaskStatus("DONE")).toBe(false);
  });

  it("stops polling when all tasks are terminal", () => {
    const tick = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useBoundedLivePoll(enabled, tick, 1000),
      { initialProps: { enabled: true } },
    );

    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalled();

    rerender({ enabled: false });
    tick.mockClear();
    vi.advanceTimersByTime(3000);
    expect(tick).not.toHaveBeenCalled();
    unmount();
  });

  it("cleans up poll subscription on unmount", () => {
    const tick = vi.fn();
    const { unmount } = renderHook(() => useBoundedLivePoll(true, tick, 1000));
    unmount();
    tick.mockClear();
    vi.advanceTimersByTime(3000);
    expect(tick).not.toHaveBeenCalled();
  });
});
