import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { TERMINAL_CALL_STATUSES } from "./callFinalization.service";

type TerminationConfig = {
  graceMs: number;
  maxAttempts: number;
  retryMs: number;
};

function readNumberEnv(name: string, fallback: number, min: number) {
  const raw = Number(process.env[name] || fallback);
  if (!Number.isFinite(raw) || raw < min) {
    throw new Error(`invalid_env_${name.toLowerCase()}`);
  }
  return Math.floor(raw);
}

export function getPostMeetingTerminationConfig(): TerminationConfig {
  return {
    graceMs: readNumberEnv("POST_MEETING_HANGUP_GRACE_MS", 10_000, 1_000),
    maxAttempts: readNumberEnv("POST_MEETING_HANGUP_MAX_ATTEMPTS", 2, 1),
    retryMs: readNumberEnv("POST_MEETING_HANGUP_RETRY_MS", 2_000, 1),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function twilioAuthHeader() {
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "");
  const token = String(process.env.TWILIO_AUTH_TOKEN || "");
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  return `Basic ${auth}`;
}

function twilioApiBase() {
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "");
  if (!sid) throw new Error("twilio_account_sid_missing");
  return `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls`;
}

function classifyProviderStatus(status?: string | null) {
  const value = String(status || "").toLowerCase().trim();
  if (!value) return "unknown";
  if (["queued", "ringing", "initiated", "in-progress", "answered"].includes(value)) {
    return "active";
  }
  if (["completed", "busy", "failed", "no-answer", "canceled", "cancelled"].includes(value)) {
    return "terminal";
  }
  return "other";
}

function isTransientTwilioStatus(status: number) {
  return status === 429 || status >= 500;
}

async function fetchTwilioCallStatus(callSid: string) {
  const response = await fetch(`${twilioApiBase()}/${encodeURIComponent(callSid)}.json`, {
    method: "GET",
    headers: { Authorization: twilioAuthHeader() },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return {
      ok: false as const,
      httpStatus: response.status,
      retryable: isTransientTwilioStatus(response.status),
      errorCategory:
        response.status === 401 || response.status === 403
          ? "provider_auth"
          : isTransientTwilioStatus(response.status)
            ? "provider_transient"
            : "provider_request_failed",
      providerStatus: null as string | null,
    };
  }
  return {
    ok: true as const,
    providerStatus: typeof body?.status === "string" ? body.status : null,
  };
}

async function requestTwilioCallCompletion(callSid: string) {
  const payload = new URLSearchParams({ Status: "completed" });
  const response = await fetch(`${twilioApiBase()}/${encodeURIComponent(callSid)}.json`, {
    method: "POST",
    headers: {
      Authorization: twilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });
  if (response.ok) {
    return { ok: true as const };
  }
  return {
    ok: false as const,
    httpStatus: response.status,
    retryable: isTransientTwilioStatus(response.status),
    errorCategory:
      response.status === 401 || response.status === 403
        ? "provider_auth"
        : isTransientTwilioStatus(response.status)
          ? "provider_transient"
          : "provider_request_failed",
  };
}

function isTerminalLocalCall(call: { status: string; endedAt: Date | null; metadata: unknown }) {
  if (TERMINAL_CALL_STATUSES.has(call.status as any)) return true;
  if (call.endedAt) return true;
  const meta = (call.metadata as Record<string, unknown> | null) || {};
  return Boolean(meta.humeChatEndedAt);
}

function terminationLog(event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      scope: "post_meeting_termination",
      event,
      at: new Date().toISOString(),
      ...data,
    }),
  );
}

export async function armPostMeetingTermination(input: {
  callId: string;
  bookingId: string;
  toolCallId: string;
  direction: string | null;
}) {
  const config = getPostMeetingTerminationConfig();
  const now = new Date();
  const graceDeadlineAt = new Date(now.getTime() + config.graceMs);

  const intent = await prisma.callTerminationIntent.upsert({
    where: {
      callId_reason: {
        callId: input.callId,
        reason: "MEETING_SCHEDULED",
      },
    },
    create: {
      callId: input.callId,
      bookingId: input.bookingId,
      toolCallId: input.toolCallId,
      reason: "MEETING_SCHEDULED",
      source: "HUME_MEETING_TOOL",
      state: "ARMED",
      requestedAt: now,
      graceDeadlineAt,
      metadata: {
        source: "meeting_tool_success",
      } as Prisma.InputJsonValue,
    },
    update: {
      bookingId: input.bookingId,
      toolCallId: input.toolCallId,
      source: "HUME_MEETING_TOOL",
      state: "ARMED",
      requestedAt: now,
      graceDeadlineAt,
    },
  });

  terminationLog("post_meeting_termination_armed", {
    callId: redactId(input.callId),
    toolCallId: redactId(input.toolCallId),
    direction: input.direction,
    graceDeadlineAt: graceDeadlineAt.toISOString(),
  });

  return intent;
}

export async function markPostMeetingTerminationSatisfied(input: {
  callId: string;
  source: "HUME_CHAT_ENDED" | "TWILIO_TERMINAL" | "MANUAL";
}) {
  const repo = (prisma as any).callTerminationIntent;
  if (!repo?.findUnique || !repo?.update) return;
  const existing = await repo.findUnique({
    where: { callId_reason: { callId: input.callId, reason: "MEETING_SCHEDULED" } },
  });
  if (!existing) return;
  if (existing.state === "SATISFIED" || existing.state === "CANCELED") return;
  await repo.update({
    where: { id: existing.id },
    data: {
      state: "SATISFIED",
      lastErrorCategory: null,
    },
  });
  terminationLog("post_meeting_termination_satisfied", {
    callId: redactId(input.callId),
    previousState: existing.state,
    nextState: "SATISFIED",
    source: input.source,
  });
}

async function runSingleFallbackAttempt(callId: string, intentId: string, attempt: number) {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: {
      id: true,
      status: true,
      endedAt: true,
      providerCallId: true,
      direction: true,
      metadata: true,
    },
  });
  if (!call) return { done: true as const, reason: "call_missing" };
  if (isTerminalLocalCall(call)) return { done: true as const, reason: "already_terminal" };
  if (!call.providerCallId) {
    await prisma.callTerminationIntent.update({
      where: { id: intentId },
      data: { state: "CANCELED", lastErrorCategory: "provider_sid_missing" },
    });
    terminationLog("post_meeting_termination_skipped", {
      callId: redactId(callId),
      reason: "provider_sid_missing",
    });
    return { done: true as const, reason: "provider_sid_missing" };
  }

  const current = await fetchTwilioCallStatus(call.providerCallId);
  if (!current.ok) {
    await prisma.callTerminationIntent.update({
      where: { id: intentId },
      data: {
        attemptCount: attempt,
        lastAttemptAt: new Date(),
        lastErrorCategory: current.errorCategory,
      },
    });
    terminationLog("twilio_fallback_hangup_failed", {
      callId: redactId(callId),
      attempt,
      errorCategory: current.errorCategory,
      providerStatusCategory: "unknown",
    });
    return { done: !current.retryable, reason: current.errorCategory };
  }

  const providerStatusCategory = classifyProviderStatus(current.providerStatus);
  terminationLog("twilio_fallback_check", {
    callId: redactId(callId),
    attempt,
    providerStatusCategory,
  });

  if (providerStatusCategory !== "active") {
    await prisma.callTerminationIntent.update({
      where: { id: intentId },
      data: {
        state: "CANCELED",
        lastProviderState: current.providerStatus || null,
        lastErrorCategory: null,
      },
    });
    terminationLog("post_meeting_termination_skipped", {
      callId: redactId(callId),
      reason: "provider_not_active",
      providerStatusCategory,
    });
    return { done: true as const, reason: "provider_not_active" };
  }

  terminationLog("twilio_fallback_hangup_requested", {
    callId: redactId(callId),
    attempt,
    providerStatusCategory,
  });
  const completion = await requestTwilioCallCompletion(call.providerCallId);
  if (!completion.ok) {
    await prisma.callTerminationIntent.update({
      where: { id: intentId },
      data: {
        attemptCount: attempt,
        lastAttemptAt: new Date(),
        lastProviderState: current.providerStatus || null,
        lastErrorCategory: completion.errorCategory,
      },
    });
    terminationLog("twilio_fallback_hangup_failed", {
      callId: redactId(callId),
      attempt,
      errorCategory: completion.errorCategory,
      providerStatusCategory,
    });
    return { done: !completion.retryable, reason: completion.errorCategory };
  }

  await prisma.callTerminationIntent.update({
    where: { id: intentId },
    data: {
      attemptCount: attempt,
      lastAttemptAt: new Date(),
      lastProviderState: current.providerStatus || null,
      lastErrorCategory: null,
    },
  });
  terminationLog("twilio_fallback_hangup_succeeded", {
    callId: redactId(callId),
    attempt,
    providerStatusCategory,
  });
  return { done: true as const, reason: "hangup_requested" };
}

export async function runPostMeetingTerminationWatchdog(callId: string) {
  const config = getPostMeetingTerminationConfig();
  const intent = await prisma.callTerminationIntent.findUnique({
    where: { callId_reason: { callId, reason: "MEETING_SCHEDULED" } },
  });
  if (!intent || intent.state !== "ARMED") return;

  const waitMs = Math.max(0, intent.graceDeadlineAt.getTime() - Date.now());
  if (waitMs > 0) {
    await sleep(waitMs);
  }

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const latest = await prisma.callTerminationIntent.findUnique({ where: { id: intent.id } });
    if (!latest || latest.state !== "ARMED") return;
    const result = await runSingleFallbackAttempt(callId, intent.id, attempt);
    if (result.done) {
      if (result.reason !== "hangup_requested" && result.reason !== "already_terminal") {
        await prisma.callTerminationIntent.update({
          where: { id: intent.id },
          data: { state: result.reason === "provider_auth" ? "FAILED" : latest.state },
        });
      }
      return;
    }
    if (attempt < config.maxAttempts) {
      await sleep(config.retryMs);
    }
  }

  await prisma.callTerminationIntent.update({
    where: { id: intent.id },
    data: { state: "FAILED", lastErrorCategory: "max_attempts" },
  });
}
