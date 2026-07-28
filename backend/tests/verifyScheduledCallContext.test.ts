import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  $transaction: vi.fn(),
  $disconnect: vi.fn(),
}));

const createScheduledCallTaskMock = vi.hoisted(() => vi.fn());
const findSeedScheduledContextCustomerMock = vi.hoisted(() => vi.fn());
const findSeedScheduledContextTaskMock = vi.hoisted(() => vi.fn());
const prepareScheduledAiCallForTaskMock = vi.hoisted(() => vi.fn());
const buildAiradeskCallContextMock = vi.hoisted(() => vi.fn());
const noDialDialMock = vi.hoisted(() => vi.fn());

vi.mock("../src/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/services/scheduledCallTask.service", () => ({
  SEED_SCHEDULED_CONTEXT_CUSTOMER_NAME: "[SEED] Scheduled Context Verification",
  SEED_SCHEDULED_CONTEXT_MARKER: "DEV_SCHEDULED_CONTEXT_VERIFICATION",
  SEED_SCHEDULED_CONTEXT_PHONE: "+15550100999",
  createScheduledCallTask: createScheduledCallTaskMock,
  findSeedScheduledContextCustomer: findSeedScheduledContextCustomerMock,
  findSeedScheduledContextTask: findSeedScheduledContextTaskMock,
}));
vi.mock("../src/services/aiScheduledCall.service", () => ({
  prepareScheduledAiCallForTask: prepareScheduledAiCallForTaskMock,
}));
vi.mock("../src/services/callContext.service", () => ({
  buildAiradeskCallContext: buildAiradeskCallContextMock,
}));
vi.mock("../src/services/aiScheduledCallDial", () => ({
  noDialScheduledCallAdapter: {
    dial: noDialDialMock,
  },
}));

async function runScript(argv: string[], env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.stubGlobal("process", {
    ...process,
    argv: ["node", "verifyScheduledCallContext.ts", ...argv],
    version: process.version.startsWith("v24.") ? process.version : "v24.18.0",
    env: {
      ...process.env,
      NODE_ENV: "development",
      ALLOW_DEV_SCHEDULED_CONTEXT_SEED: "true",
      VOICE_COMPANY_ID: "co-1",
      DATABASE_URL: "postgresql://postgres.tqmwrmlswbwngblxkibm:secret@host/db",
      ...env,
    },
    exitCode: 0,
  });

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await import("../scripts/verifyScheduledCallContext");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { logSpy, errorSpy };
}

describe("verifyScheduledCallContext script gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noDialDialMock.mockResolvedValue({ ok: false, error: "NO_DIAL_ADAPTER_ACTIVE" });
  });

  it("refuses without --apply", async () => {
    const { logSpy } = await runScript([], {});
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"verificationStatus": "refused"'),
    );
  });

  it("refuses unless NODE_ENV=development", async () => {
    const { errorSpy } = await runScript(["--apply"], { NODE_ENV: "production" });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("refuses without explicit env gate", async () => {
    const { errorSpy } = await runScript(["--apply"], {
      ALLOW_DEV_SCHEDULED_CONTEXT_SEED: "false",
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("refuses against unexpected database project", async () => {
    const { errorSpy } = await runScript(["--apply"], {
      DATABASE_URL: "postgresql://postgres.otherproject:secret@host/db",
    });
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("verifyScheduledCallContext apply flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findSeedScheduledContextCustomerMock.mockResolvedValue(null);
    findSeedScheduledContextTaskMock.mockResolvedValue(null);
    createScheduledCallTaskMock.mockResolvedValue({
      customer: { id: "cust-seed", phone: "+15550100999", fullName: "[SEED] Scheduled Context Verification" },
      task: {
        id: "task-seed",
        aiNotes: JSON.stringify({
          kind: "AI_SCHEDULED_CALL",
          version: 2,
          status: "SCHEDULED",
          phone: "+15550100999",
          collectionGoal: "[SEED] Collect details",
          extraNotes: "[SEED PRIVATE NOTE] hidden",
          preferredLanguage: "ENGLISH",
          scheduledAt: "2027-08-01T10:30:00.000Z",
          timezone: "Asia/Kolkata",
        }),
      },
      context: {
        collectionGoal: "[SEED] Collect details",
        extraNotes: "[SEED PRIVATE NOTE] hidden",
        preferredLanguage: "ENGLISH",
        timezone: "Asia/Kolkata",
      },
    });
    prismaMock.user.findFirst.mockResolvedValue({ id: "user-1" });
    prepareScheduledAiCallForTaskMock.mockResolvedValue({
      skipped: false,
      failed: false,
      taskId: "task-seed",
      conversationId: "conv-seed",
      callId: "call-seed",
      phone: "+15550100999",
      notes: {},
    });
    buildAiradeskCallContextMock.mockResolvedValue({
      call: {
        collectionGoal: "[SEED] Collect details",
        extraNotes: "[SEED PRIVATE NOTE] hidden\n[PRIVATE_INTERNAL_NOTE: never read verbatim to caller]",
        preferredLanguage: "ENGLISH",
        timezone: "Asia/Kolkata",
      },
      customer: { name: "[SEED] Scheduled Context Verification" },
      company: { name: "Demo" },
    });
    noDialDialMock.mockResolvedValue({ ok: false, error: "NO_DIAL_ADAPTER_ACTIVE" });

    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        call: {
          findUnique: vi.fn().mockResolvedValue({
            purpose: "[SEED] Collect details",
            notes: "[SEED PRIVATE NOTE] hidden",
            preferredLanguage: "ENGLISH",
            metadata: { timezone: "Asia/Kolkata" },
            providerCallId: null,
            twilioCallSid: null,
          }),
        },
      };
      return callback(tx);
    });
  });

  it("runs verification summary with no external calls", async () => {
    const originalVersion = process.version;
    Object.defineProperty(process, "version", { value: "v24.18.0" });

    const { logSpy } = await runScript(["--apply"], {});
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"verificationStatus": "passed"'),
    );
    expect(noDialDialMock).toHaveBeenCalled();
    expect(createScheduledCallTaskMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(process, "version", { value: originalVersion });
  });
});
