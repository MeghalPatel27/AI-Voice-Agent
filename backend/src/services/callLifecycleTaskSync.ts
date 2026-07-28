import type { CallStatus, TaskStatus } from "@prisma/client";

export type DbCallStatus = CallStatus;

export function extractRelatedTaskId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const taskId = (metadata as Record<string, unknown>).taskId;
  return typeof taskId === "string" && taskId.trim() ? taskId.trim() : null;
}

export function isSuccessfulTerminalStatus(status: DbCallStatus) {
  return status === "COMPLETED" || status === "TRANSFERRED";
}

export function mapCallStatusToTaskTerminal(status: DbCallStatus): {
  taskStatus: TaskStatus;
  notesStatus: string;
} {
  if (isSuccessfulTerminalStatus(status)) {
    return { taskStatus: "DONE", notesStatus: "COMPLETED" };
  }
  if (status === "CANCELED") {
    return { taskStatus: "BLOCKED", notesStatus: "CANCELED" };
  }
  if (status === "BUSY") {
    return { taskStatus: "BLOCKED", notesStatus: "BUSY" };
  }
  if (status === "NO_ANSWER" || status === "MISSED") {
    return { taskStatus: "BLOCKED", notesStatus: "NO_ANSWER" };
  }
  return { taskStatus: "BLOCKED", notesStatus: "FAILED" };
}
