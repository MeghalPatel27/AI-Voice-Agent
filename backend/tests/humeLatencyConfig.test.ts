import { describe, expect, it } from "vitest";
import {
  assertHumeToolRuntimeConfig,
  resetHumeToolRuntimeConfigForTests,
} from "../src/integrations/hume/humeToolRuntime.config";
import { HUME_LATENCY_TARGETS } from "../src/integrations/hume/humeLatencyTargets";
import { HUME_EVI_ACTIVE_LANGUAGE_MODEL } from "../src/integrations/hume/humeLanguageModel";

describe("hume runtime and configure targets", () => {
  it("validates tool deadline env defaults", () => {
    resetHumeToolRuntimeConfigForTests();
    delete process.env.HUME_TOOL_EXECUTION_TIMEOUT_MS;
    delete process.env.HUME_CONTROL_PLANE_TIMEOUT_MS;
    delete process.env.HUME_TOOL_DELIVERY_MAX_ATTEMPTS;
    delete process.env.HUME_TOOL_DELIVERY_RETRY_BASE_MS;
    delete process.env.HUME_CONTEXT_CACHE_TTL_SECONDS;
    const cfg = assertHumeToolRuntimeConfig();
    expect(cfg.toolExecutionTimeoutMs).toBe(1500);
    expect(cfg.controlPlaneTimeoutMs).toBe(1500);
    expect(cfg.toolDeliveryMaxAttempts).toBe(3);
    expect(cfg.toolDeliveryRetryBaseMs).toBe(200);
    expect(cfg.contextCacheTtlSeconds).toBe(120);
  });

  it("35-42. configure targets preserve voice/model and tune latency fields", () => {
    expect(HUME_LATENCY_TARGETS.endOfTurnSilenceMs).toBe(500);
    expect(HUME_LATENCY_TARGETS.prefixPaddingMs).toBe(300);
    expect(HUME_LATENCY_TARGETS.speechDetectionThreshold).toBe(0.45);
    expect(HUME_LATENCY_TARGETS.minInterruptionMs).toBe(300);
    expect(HUME_LATENCY_TARGETS.inactivityTimeoutSecs).toBe(30);
    expect(HUME_LATENCY_TARGETS.inactivityMessage).toMatch(/still there/i);
    expect(HUME_LATENCY_TARGETS.onNewChatText).toBe("Hello?");
    expect(HUME_EVI_ACTIVE_LANGUAGE_MODEL).toBe("gpt-4o");
  });
});
