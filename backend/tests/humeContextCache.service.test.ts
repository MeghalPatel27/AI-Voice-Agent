import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
const deleteMany = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());

vi.mock("../src/db/prisma", () => ({
  prisma: {
    humeCallContextCache: {
      findUnique,
      delete: del,
      deleteMany,
      upsert: vi.fn(),
    },
  },
}));

vi.mock("../src/integrations/hume/humeToolRuntime.config", () => ({
  getHumeToolRuntimeConfig: () => ({
    contextCacheTtlSeconds: 120,
    toolExecutionTimeoutMs: 1500,
    controlPlaneTimeoutMs: 1500,
    toolDeliveryMaxAttempts: 3,
    toolDeliveryRetryBaseMs: 200,
  }),
}));

vi.mock("../src/services/callContext.service", () => ({
  buildAiradeskCallContext: vi.fn(),
}));

import {
  getCachedAiradeskCallContext,
  invalidateAiradeskCallContextCache,
} from "../src/integrations/hume/humeContextCache.service";

describe("context cache tenancy and expiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("23-24. expired cache falls back and lookups are tenant-scoped", async () => {
    findUnique.mockResolvedValueOnce({
      id: "row-1",
      expiresAt: new Date(Date.now() - 1000),
      payload: { call: { collectionGoal: "stale" } },
    });
    del.mockResolvedValue({});
    const expired = await getCachedAiradeskCallContext({
      callId: "call-1",
      companyId: "co-1",
    });
    expect(expired).toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { companyId_callId: { companyId: "co-1", callId: "call-1" } },
    });

    findUnique.mockResolvedValueOnce({
      id: "row-2",
      expiresAt: new Date(Date.now() + 60_000),
      payload: { call: { collectionGoal: "fresh" } },
    });
    const fresh = await getCachedAiradeskCallContext({
      callId: "call-1",
      companyId: "co-1",
    });
    expect(fresh?.call.collectionGoal).toBe("fresh");

    deleteMany.mockResolvedValue({ count: 1 });
    await invalidateAiradeskCallContextCache({ callId: "call-1", companyId: "co-1" });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { callId: "call-1", companyId: "co-1" },
    });
  });
});
