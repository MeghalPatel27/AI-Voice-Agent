import type { NextFunction, Request, Response } from "express";
import twilio from "twilio";

export type TwilioWebhookValidationOptions = {
  authToken?: string;
  publicWebhookUrl?: string;
  bypass?: boolean;
};

function env(name: string) {
  return String(process.env[name] || "").trim();
}

export function buildTwilioWebhookUrl(req: Request, publicWebhookUrl?: string) {
  const base = (publicWebhookUrl || env("PUBLIC_WEBHOOK_URL")).replace(/\/$/, "");
  if (!base) return "";
  const originalUrl = req.originalUrl || req.url || "";
  return `${base}${originalUrl}`;
}

export function validateTwilioWebhookRequest(input: {
  authToken: string;
  signature: string;
  url: string;
  params: Record<string, string | string[] | undefined>;
}) {
  if (!input.authToken) {
    return { ok: false as const, reason: "missing_auth_token" };
  }
  if (!input.signature) {
    return { ok: false as const, reason: "missing_signature" };
  }
  if (!input.url) {
    return { ok: false as const, reason: "missing_url" };
  }

  const normalizedParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.params)) {
    if (value === undefined) continue;
    normalizedParams[key] = Array.isArray(value) ? value.join("") : String(value);
  }

  const isValid = twilio.validateRequest(
    input.authToken,
    input.signature,
    input.url,
    normalizedParams,
  );

  if (!isValid) {
    return { ok: false as const, reason: "invalid_signature" };
  }

  return { ok: true as const };
}

export function createTwilioWebhookMiddleware(
  options: TwilioWebhookValidationOptions = {},
) {
  return function twilioWebhookMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const explicitBypass =
      options.bypass === true ||
      (process.env.NODE_ENV === "test" &&
        process.env.TWILIO_WEBHOOK_TEST_BYPASS === "true");
    if (explicitBypass) {
      return next();
    }

    const authToken = options.authToken || env("TWILIO_AUTH_TOKEN");
    const signature = String(req.header("X-Twilio-Signature") || "");
    const url = buildTwilioWebhookUrl(req, options.publicWebhookUrl);

    const verified = validateTwilioWebhookRequest({
      authToken,
      signature,
      url,
      params: (req.body || {}) as Record<string, string | string[] | undefined>,
    });

    if (!verified.ok) {
      return res.status(401).json({ message: "Invalid Twilio webhook signature" });
    }

    return next();
  };
}

export function isTwilioWebhookValidationConfigured() {
  return Boolean(env("TWILIO_AUTH_TOKEN") && env("PUBLIC_WEBHOOK_URL"));
}
