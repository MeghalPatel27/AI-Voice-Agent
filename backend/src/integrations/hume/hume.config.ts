import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_HUME_BASE_URL = "https://api.hume.ai";
const DEFAULT_REPLAY_WINDOW_MS = 3 * 60 * 1000;

function env(name: string) {
  return String(process.env[name] || "").trim();
}

export function getHumeConfig() {
  return {
    apiKey: env("HUME_API_KEY"),
    configId: env("HUME_CONFIG_ID"),
    webhookSigningKey: env("HUME_WEBHOOK_SIGNING_KEY"),
    apiBaseUrl: env("HUME_API_BASE_URL") || DEFAULT_HUME_BASE_URL,
    webhookPublicUrl: env("HUME_WEBHOOK_PUBLIC_URL") || env("PUBLIC_WEBHOOK_URL"),
    voiceCompanyId: env("VOICE_COMPANY_ID"),
  };
}

export function assertHumeRuntimeReady() {
  const config = getHumeConfig();
  const missing: string[] = [];
  if (!config.apiKey) missing.push("HUME_API_KEY");
  if (!config.configId) missing.push("HUME_CONFIG_ID");
  if (!config.webhookSigningKey) missing.push("HUME_WEBHOOK_SIGNING_KEY");
  if (!config.voiceCompanyId) missing.push("VOICE_COMPANY_ID");
  if (missing.length) {
    throw new Error(`hume_config_missing:${missing.join(",")}`);
  }
  return config;
}

export function buildHumeTwilioUrl() {
  const { apiBaseUrl, apiKey, configId } = assertHumeRuntimeReady();
  const base = `${apiBaseUrl.replace(/\/$/, "")}/v0/evi/twilio`;
  const query = new URLSearchParams({
    config_id: configId,
    api_key: apiKey,
  });
  return `${base}?${query.toString()}`;
}

export function redactUrlForLogs(url: string) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "invalid_url";
  }
}

export function verifyHumeWebhookSignature(input: {
  rawBody: Buffer;
  timestampHeader: string;
  signatureHeader: string;
}) {
  const { webhookSigningKey } = assertHumeRuntimeReady();
  const now = Date.now();
  const timestampMs = Number(input.timestampHeader);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false as const, reason: "invalid_timestamp" };
  }
  if (Math.abs(now - timestampMs) > DEFAULT_REPLAY_WINDOW_MS) {
    return { ok: false as const, reason: "stale_timestamp" };
  }

  const payload = `${input.timestampHeader}.${input.rawBody.toString("utf8")}`;
  const digest = createHmac("sha256", webhookSigningKey).update(payload).digest("hex");
  const expected = Buffer.from(digest, "utf8");
  const provided = Buffer.from(String(input.signatureHeader || "").trim(), "utf8");
  if (expected.length !== provided.length) {
    return { ok: false as const, reason: "invalid_signature" };
  }
  if (!timingSafeEqual(expected, provided)) {
    return { ok: false as const, reason: "invalid_signature" };
  }
  return { ok: true as const };
}
