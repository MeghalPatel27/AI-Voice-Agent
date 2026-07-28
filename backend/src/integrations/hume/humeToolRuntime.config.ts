function env(name: string) {
  return String(process.env[name] || "").trim();
}

function parsePositiveInt(name: string, fallback: number, opts?: { min?: number; max?: number }) {
  const raw = env(name);
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid_env:${name}`);
  }
  if (opts?.min != null && value < opts.min) throw new Error(`invalid_env:${name}:min`);
  if (opts?.max != null && value > opts.max) throw new Error(`invalid_env:${name}:max`);
  return value;
}

export type HumeToolRuntimeConfig = {
  toolExecutionTimeoutMs: number;
  controlPlaneTimeoutMs: number;
  toolDeliveryMaxAttempts: number;
  toolDeliveryRetryBaseMs: number;
  contextCacheTtlSeconds: number;
};

let cached: HumeToolRuntimeConfig | null = null;

export function getHumeToolRuntimeConfig(): HumeToolRuntimeConfig {
  if (cached) return cached;
  cached = {
    toolExecutionTimeoutMs: parsePositiveInt("HUME_TOOL_EXECUTION_TIMEOUT_MS", 1500, {
      min: 200,
      max: 10_000,
    }),
    controlPlaneTimeoutMs: parsePositiveInt("HUME_CONTROL_PLANE_TIMEOUT_MS", 1500, {
      min: 200,
      max: 10_000,
    }),
    toolDeliveryMaxAttempts: parsePositiveInt("HUME_TOOL_DELIVERY_MAX_ATTEMPTS", 3, {
      min: 1,
      max: 8,
    }),
    toolDeliveryRetryBaseMs: parsePositiveInt("HUME_TOOL_DELIVERY_RETRY_BASE_MS", 200, {
      min: 50,
      max: 5_000,
    }),
    contextCacheTtlSeconds: parsePositiveInt("HUME_CONTEXT_CACHE_TTL_SECONDS", 120, {
      min: 10,
      max: 900,
    }),
  };
  return cached;
}

/** Test-only: clear memoized runtime config. */
export function resetHumeToolRuntimeConfigForTests() {
  cached = null;
}

export function assertHumeToolRuntimeConfig() {
  return getHumeToolRuntimeConfig();
}
