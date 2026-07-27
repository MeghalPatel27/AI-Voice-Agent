import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runOnceMock } = vi.hoisted(() => ({
  runOnceMock: vi.fn(),
}));

vi.mock("../src/integrations/hume/humeChatSync.service", () => ({
  runHumeSyncWorkerOnce: runOnceMock,
}));

import {
  getHumeSyncWorkerEnabled,
  getHumeSyncWorkerState,
  parseStrictBoolean,
  resetHumeSyncWorkerStateForTests,
  runHumeSyncWorkerTick,
  startHumeSyncWorker,
} from "../src/integrations/hume/humeSyncWorker.service";

describe("humeSyncWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHumeSyncWorkerStateForTests();
    delete process.env.HUME_SYNC_WORKER_ENABLED;
    runOnceMock.mockResolvedValue({
      processed: 0,
      completed: 0,
      failed: 0,
      retried: 0,
    });
  });

  it("parses strict booleans with default true", () => {
    expect(parseStrictBoolean(undefined, true)).toBe(true);
    expect(parseStrictBoolean("true", false)).toBe(true);
    expect(parseStrictBoolean("false", true)).toBe(false);
    expect(parseStrictBoolean("1", false)).toBe(true);
    expect(parseStrictBoolean("0", true)).toBe(false);
  });

  it("does not query prisma when disabled", async () => {
    process.env.HUME_SYNC_WORKER_ENABLED = "false";
    const result = await runHumeSyncWorkerTick();
    expect(result).toEqual({ skipped: true, reason: "disabled" });
    expect(runOnceMock).not.toHaveBeenCalled();
    expect(getHumeSyncWorkerState().enabled).toBe(false);
    expect(getHumeSyncWorkerState().healthy).toBe(false);
  });

  it("handles P2021 without unhandled rejection and pauses worker", async () => {
    runOnceMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Table does not exist", {
        code: "P2021",
        clientVersion: "7.8.0",
        meta: { table: "public.HumeChatSyncJob" },
      }),
    );

    const result = await runHumeSyncWorkerTick();
    expect(result.skipped).toBe(false);
    expect(result.errorCode).toBe("P2021");
    expect(result.paused).toBe(true);

    const state = getHumeSyncWorkerState();
    expect(state.paused).toBe(true);
    expect(state.healthy).toBe(false);
    expect(state.lastErrorCode).toBe("P2021");

    const second = await runHumeSyncWorkerTick();
    expect(second).toEqual({ skipped: true, reason: "paused" });
    expect(runOnceMock).toHaveBeenCalledTimes(1);
  });

  it("handles P2022 similarly to P2021", async () => {
    runOnceMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Column does not exist", {
        code: "P2022",
        clientVersion: "7.8.0",
        meta: { column: "humeChatId" },
      }),
    );

    await runHumeSyncWorkerTick();
    const state = getHumeSyncWorkerState();
    expect(state.paused).toBe(true);
    expect(state.lastErrorCode).toBe("P2022");
  });

  it("applies bounded retry for transient failures without permanent pause", async () => {
    runOnceMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ processed: 0, completed: 0, failed: 0, retried: 0 });

    const first = await runHumeSyncWorkerTick();
    expect(first.errorCode).toBe("db_connection_refused");
    expect(getHumeSyncWorkerState().consecutiveFailures).toBe(1);
    expect(getHumeSyncWorkerState().paused).toBe(false);

    const skipped = await runHumeSyncWorkerTick();
    expect(skipped).toEqual({ skipped: true, reason: "backoff" });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    const second = await runHumeSyncWorkerTick();
    vi.useRealTimers();

    expect(second.skipped).toBe(false);
    expect(getHumeSyncWorkerState().healthy).toBe(true);
    expect(getHumeSyncWorkerState().consecutiveFailures).toBe(0);
  });

  it("records success metrics and resets failures", async () => {
    runOnceMock.mockResolvedValue({
      processed: 1,
      completed: 1,
      failed: 0,
      retried: 0,
    });

    await runHumeSyncWorkerTick();
    const state = getHumeSyncWorkerState();
    expect(state.lastSucceededAt).toBeTruthy();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.healthy).toBe(true);
  });

  it("skips overlapping interval ticks", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    runOnceMock.mockImplementationOnce(async () => {
      await gate;
      return { processed: 0, completed: 0, failed: 0, retried: 0 };
    });

    const first = runHumeSyncWorkerTick();
    const overlap = await runHumeSyncWorkerTick();
    expect(overlap).toEqual({ skipped: true, reason: "already_running" });

    release();
    await first;
    expect(runOnceMock).toHaveBeenCalledTimes(1);
  });

  it("starts worker only when enabled", () => {
    process.env.HUME_SYNC_WORKER_ENABLED = "false";
    startHumeSyncWorker();
    expect(getHumeSyncWorkerEnabled()).toBe(false);
  });
});

describe("humeChatSync job claiming", () => {
  const {
    findManyMock,
    updateManyMock,
    findUniqueMock,
    updateMock,
    listEventsMock,
  } = vi.hoisted(() => ({
    findManyMock: vi.fn(),
    updateManyMock: vi.fn(),
    findUniqueMock: vi.fn(),
    updateMock: vi.fn(),
    listEventsMock: vi.fn(),
  }));

  vi.mock("../src/db/prisma", () => ({
    prisma: {
      humeChatSyncJob: {
        findMany: findManyMock,
        updateMany: updateManyMock,
        update: updateMock,
      },
      call: { findUnique: findUniqueMock },
      message: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
        cb({
          call: { update: vi.fn() },
          conversation: { update: vi.fn() },
          humeExpressionAnalysis: { upsert: vi.fn() },
          humeChatSyncJob: { update: vi.fn() },
        }),
      ),
    },
  }));

  vi.mock("../src/integrations/hume/hume.client", () => ({
    listHumeChatEvents: listEventsMock,
  }));

  vi.mock("../src/services/callFinalization.service", () => ({
    finalizeCall: vi.fn(),
  }));

  beforeEach(async () => {
    vi.clearAllMocks();
    updateManyMock.mockResolvedValue({ count: 0 });
    findManyMock.mockResolvedValue([]);
    listEventsMock.mockResolvedValue({ events: [], total_pages: 1 });
  });

  it("handles empty HumeChatSyncJob table normally", async () => {
    const { runHumeSyncWorkerOnce } = await import(
      "../src/integrations/hume/humeChatSync.service"
    );
    const result = await runHumeSyncWorkerOnce();
    expect(result).toEqual({ processed: 0, completed: 0, failed: 0, retried: 0 });
  });

  it("prevents duplicate job claiming when updateMany returns zero", async () => {
    const updatedAt = new Date("2026-07-27T10:00:00.000Z");
    findManyMock.mockResolvedValue([
      {
        id: "job_1",
        callId: "call_1",
        chatId: "chat_1",
        companyId: "company_1",
        status: "PENDING",
        attempts: 0,
        updatedAt,
      },
    ]);
    updateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    const { runHumeSyncWorkerOnce } = await import(
      "../src/integrations/hume/humeChatSync.service"
    );
    const result = await runHumeSyncWorkerOnce();
    expect(result.processed).toBe(0);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

describe("server route registration", () => {
  it("registers Twilio status and Hume webhook routes", async () => {
    const voiceRoutes = (await import("../src/routes/voice.routes")).default;
    const humeRoutes = (await import("../src/routes/humeWebhook.routes")).default;

    const voicePaths = voiceRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route!.path,
        methods: Object.keys(
          (layer.route as unknown as { methods: Record<string, boolean> }).methods,
        ),
      }));

    const humePaths = humeRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route!.path,
        methods: Object.keys(
          (layer.route as unknown as { methods: Record<string, boolean> }).methods,
        ),
      }));

    expect(voicePaths).toEqual(
      expect.arrayContaining([{ path: "/twilio/status", methods: ["post"] }]),
    );
    expect(humePaths).toEqual(
      expect.arrayContaining([{ path: "/evi", methods: ["post"] }]),
    );
  });
});

describe("unsigned Hume webhook rejection", () => {
  it("rejects missing signature headers", async () => {
    const { handleHumeEviWebhook } = await import(
      "../src/controllers/humeWebhook.controller"
    );

    const req = {
      header: () => "",
      body: { event_name: "chat_started", chat_id: "chat_1" },
    } as any;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    } as any;

    await handleHumeEviWebhook(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: "Missing signature headers" });
  });
});
