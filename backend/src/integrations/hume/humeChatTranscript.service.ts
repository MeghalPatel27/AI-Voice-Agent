import type { HumeChatEvent } from "./hume.types";
import type { MessageSender } from "@prisma/client";

const EXCLUDED_EVENT_TYPES = new Set([
  "SYSTEM_PROMPT",
  "SESSION_SETTINGS",
  "CHAT_START_MESSAGE",
  "CHAT_END_MESSAGE",
  "USER_RECORDING_START_MESSAGE",
  "ASSISTANT_PROSODY",
  "FUNCTION_CALL",
  "FUNCTION_CALL_RESPONSE",
  "TOOL_CALL",
  "TOOL_RESPONSE",
]);

export type TranscriptLine = {
  speaker: "CUSTOMER" | "AI";
  body: string;
  providerMessageId: string;
  createdAt: Date;
  interrupted?: boolean;
};

export function parseEmotionFeatures(raw: unknown): Record<string, number> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return parseEmotionFeatures(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function eventTimestampMs(event: HumeChatEvent): number {
  const ts = Number(event.timestamp || event.message?.timestamp || 0);
  if (!Number.isFinite(ts) || ts <= 0) return Date.now();
  // Hume EVI v3 uses millisecond timestamps.
  return ts < 1_000_000_000_000 ? ts * 1000 : ts;
}

function extractMessageText(event: HumeChatEvent): string {
  const direct = String(
    (event as { message_text?: string }).message_text ||
      event.message?.content ||
      (event as { text?: string }).text ||
      "",
  ).trim();
  return direct;
}

export function eventToTranscriptLine(event: HumeChatEvent): TranscriptLine | null {
  const type = String(event.type || "").toUpperCase();
  if (EXCLUDED_EVENT_TYPES.has(type)) return null;

  let speaker: MessageSender | null = null;
  if (type === "USER_MESSAGE" || event.role === "USER" || event.role === "user") {
    speaker = "CUSTOMER";
  } else if (
    type === "AGENT_MESSAGE" ||
    event.role === "ASSISTANT" ||
    event.role === "assistant"
  ) {
    speaker = "AI";
  } else if (type === "USER_INTERRUPTION") {
    return {
      speaker: "CUSTOMER",
      body: "[interrupted]",
      providerMessageId: String(event.id || `${type}:${eventTimestampMs(event)}`),
      createdAt: new Date(eventTimestampMs(event)),
      interrupted: true,
    };
  } else {
    return null;
  }

  const body = extractMessageText(event);
  if (!body) return null;

  const providerMessageId = String(event.id || "").trim();
  if (!providerMessageId) return null;

  return {
    speaker,
    body,
    providerMessageId,
    createdAt: new Date(eventTimestampMs(event)),
  };
}

export function buildTranscriptText(lines: TranscriptLine[]): string {
  return lines
    .filter((line) => line.body !== "[interrupted]")
    .map((line) => `${line.speaker === "CUSTOMER" ? "CUSTOMER" : "AI"}: ${line.body}`)
    .join("\n");
}

export function computeExpressionAnalysis(events: HumeChatEvent[]) {
  const userEvents = events
    .filter((e) => String(e.type || "").toUpperCase() === "USER_MESSAGE")
    .map((e) => ({
      timestamp: eventTimestampMs(e),
      scores: parseEmotionFeatures(e.emotion_features),
    }))
    .filter((e) => Object.keys(e.scores).length > 0);

  const totals: Record<string, number> = {};
  const peaks: Record<string, number> = {};
  for (const row of userEvents) {
    for (const [k, v] of Object.entries(row.scores)) {
      totals[k] = (totals[k] || 0) + v;
      peaks[k] = Math.max(peaks[k] || 0, v);
    }
  }
  const count = userEvents.length || 1;
  const averages: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals)) {
    averages[k] = Number((v / count).toFixed(4));
  }
  const topExpressions = Object.entries(averages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, score]) => ({ name, score }));

  return {
    userTurnCount: userEvents.length,
    averages,
    peaks,
    topExpressions,
    timeline: userEvents.map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      top: Object.entries(e.scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, score]) => ({ name, score })),
    })),
  };
}

export function countEventTypes(events: HumeChatEvent[]) {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const type = String(event.type || "unknown").toUpperCase();
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}
