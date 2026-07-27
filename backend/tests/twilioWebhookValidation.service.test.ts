import twilio from "twilio";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTwilioWebhookUrl,
  validateTwilioWebhookRequest,
} from "../src/integrations/twilio/twilioWebhookValidation.service";

const AUTH_TOKEN = "twilio_test_auth_token";
const PUBLIC_URL = "https://example.ngrok-free.dev";

function sign(url: string, params: Record<string, string>) {
  return twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, params);
}

describe("twilioWebhookValidation", () => {
  beforeEach(() => {
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    process.env.PUBLIC_WEBHOOK_URL = PUBLIC_URL;
    delete process.env.TWILIO_WEBHOOK_TEST_BYPASS;
  });

  it("builds canonical callback URL from PUBLIC_WEBHOOK_URL", () => {
    const url = buildTwilioWebhookUrl(
      {
        originalUrl: "/api/voice/twilio/status?foo=bar",
      } as Parameters<typeof buildTwilioWebhookUrl>[0],
      PUBLIC_URL,
    );
    expect(url).toBe(`${PUBLIC_URL}/api/voice/twilio/status?foo=bar`);
  });

  it("rejects missing signature", () => {
    const result = validateTwilioWebhookRequest({
      authToken: AUTH_TOKEN,
      signature: "",
      url: `${PUBLIC_URL}/api/voice/twilio/status`,
      params: { CallSid: "CA123", CallStatus: "completed" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_signature");
  });

  it("rejects invalid signature", () => {
    const result = validateTwilioWebhookRequest({
      authToken: AUTH_TOKEN,
      signature: "bad-signature",
      url: `${PUBLIC_URL}/api/voice/twilio/status`,
      params: { CallSid: "CA123", CallStatus: "completed" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_signature");
  });

  it("accepts correct signature with all form parameters", () => {
    const callbackUrl = `${PUBLIC_URL}/api/voice/twilio/status`;
    const params = {
      CallSid: "CA00000000000000000000000000000001",
      CallStatus: "completed",
      CallDuration: "42",
      AccountSid: "AC00000000000000000000000000000001",
    };
    const signature = sign(callbackUrl, params);
    const result = validateTwilioWebhookRequest({
      authToken: AUTH_TOKEN,
      signature,
      url: callbackUrl,
      params,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects signature generated for a different URL", () => {
    const params = {
      CallSid: "CA00000000000000000000000000000001",
      CallStatus: "completed",
    };
    const wrongUrl = `${PUBLIC_URL}/api/voice/twilio/other`;
    const signature = sign(wrongUrl, params);
    const result = validateTwilioWebhookRequest({
      authToken: AUTH_TOKEN,
      signature,
      url: `${PUBLIC_URL}/api/voice/twilio/status`,
      params,
    });
    expect(result.ok).toBe(false);
  });

  it("handles query strings exactly as received", () => {
    const callbackUrl = `${PUBLIC_URL}/api/voice/twilio/status?source=test`;
    const params = {
      CallSid: "CA00000000000000000000000000000001",
      CallStatus: "ringing",
    };
    const signature = sign(callbackUrl, params);
    const result = validateTwilioWebhookRequest({
      authToken: AUTH_TOKEN,
      signature,
      url: callbackUrl,
      params,
    });
    expect(result.ok).toBe(true);
  });
});