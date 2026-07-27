import { createHmac } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyHumeWebhookSignature } from "../src/integrations/hume/hume.config";

const TEST_SIGNING_KEY = "fixture_signing_key_do_not_use_in_prod";

describe("verifyHumeWebhookSignature vectors", () => {
  beforeEach(() => {
    process.env.HUME_API_KEY = "test-key";
    process.env.HUME_CONFIG_ID = "cfg_test";
    process.env.HUME_WEBHOOK_SIGNING_KEY = TEST_SIGNING_KEY;
    process.env.VOICE_COMPANY_ID = "company_1";
  });

  function sign(rawBody: string, timestamp: string) {
    return createHmac("sha256", TEST_SIGNING_KEY)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
  }

  it("accepts a deterministic valid signed fixture", () => {
    const timestamp = String(Date.now());
    const rawBody = JSON.stringify({
      event_name: "chat_started",
      chat_id: "chat_fixture_0001",
      config_id: "cfg_fixture",
    });
    const signature = sign(rawBody, timestamp);
    const result = verifyHumeWebhookSignature({
      rawBody: Buffer.from(rawBody),
      timestampHeader: timestamp,
      signatureHeader: signature,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing signature", () => {
    const timestamp = String(Date.now());
    const body = Buffer.from(JSON.stringify({ event_name: "chat_started", chat_id: "x" }));
    const result = verifyHumeWebhookSignature({
      rawBody: body,
      timestampHeader: timestamp,
      signatureHeader: "",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing timestamp", () => {
    const body = Buffer.from(JSON.stringify({ event_name: "chat_started", chat_id: "x" }));
    const result = verifyHumeWebhookSignature({
      rawBody: body,
      timestampHeader: "",
      signatureHeader: "abc",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects stale timestamp", () => {
    const timestamp = String(Date.now() - 10 * 60 * 1000);
    const rawBody = JSON.stringify({ event_name: "chat_started", chat_id: "x" });
    const signature = sign(rawBody, timestamp);
    const result = verifyHumeWebhookSignature({
      rawBody: Buffer.from(rawBody),
      timestampHeader: timestamp,
      signatureHeader: signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale_timestamp");
  });

  it("rejects future-dated timestamp", () => {
    const timestamp = String(Date.now() + 10 * 60 * 1000);
    const rawBody = JSON.stringify({ event_name: "chat_started", chat_id: "x" });
    const signature = sign(rawBody, timestamp);
    const result = verifyHumeWebhookSignature({
      rawBody: Buffer.from(rawBody),
      timestampHeader: timestamp,
      signatureHeader: signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale_timestamp");
  });

  it("rejects body mutation after signing", () => {
    const timestamp = String(Date.now());
    const rawBody = JSON.stringify({ event_name: "chat_started", chat_id: "x" });
    const signature = sign(rawBody, timestamp);
    const result = verifyHumeWebhookSignature({
      rawBody: Buffer.from(JSON.stringify({ event_name: "chat_started", chat_id: "y" })),
      timestampHeader: timestamp,
      signatureHeader: signature,
    });
    expect(result.ok).toBe(false);
  });

  it("handles unequal signature lengths safely", () => {
    const timestamp = String(Date.now());
    const rawBody = JSON.stringify({ event_name: "chat_started", chat_id: "x" });
    const result = verifyHumeWebhookSignature({
      rawBody: Buffer.from(rawBody),
      timestampHeader: timestamp,
      signatureHeader: "short",
    });
    expect(result.ok).toBe(false);
  });
});
