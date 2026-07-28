import { getHumeConfig } from "./hume.config";
import { getHumeChatHistoryConfig } from "./humeChatHistory.config";
import { HumeControlPlaneError } from "./hume.client";
import type { HumeChatEvent } from "./hume.types";

export type HumeChatSummary = {
  id: string;
  chatGroupId: string | null;
  configId: string | null;
  status: string | null;
  startTimestampMs: number | null;
  endTimestampMs: number | null;
  eventCount: number | null;
  twilioCallSid: string | null;
  direction: string | null;
  requestId: string | null;
};

export type HumeChatEventsPage = {
  events: HumeChatEvent[];
  pageNumber: number;
  totalPages: number;
};

function classifyHttpStatus(status: number): { retryable: boolean } {
  if (status === 429 || status >= 500) return { retryable: true };
  return { retryable: false };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTwilioMetadata(raw: unknown): {
  callSid: string | null;
  direction: string | null;
  configId: string | null;
} {
  if (!raw) return { callSid: null, direction: null, configId: null };
  let value: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { callSid: null, direction: null, configId: null };
    }
  } else if (typeof raw === "object") {
    value = raw as Record<string, unknown>;
  }
  const twilio =
    (value.twilio as Record<string, unknown> | undefined) ||
    (value.twilio_metadata as Record<string, unknown> | undefined) ||
    value;
  const callSid = String(twilio.call_sid || twilio.CallSid || "").trim() || null;
  const direction = String(twilio.direction || "").trim() || null;
  const configId = String(twilio.config_id || value.config_id || "").trim() || null;
  return { callSid, direction, configId };
}

function normalizeChatSummary(raw: Record<string, unknown>): HumeChatSummary {
  const twilio = parseTwilioMetadata(raw.metadata ?? raw.twilio_metadata);
  const config =
    (raw.config as Record<string, unknown> | undefined)?.id ||
    raw.config_id ||
    twilio.configId;
  return {
    id: String(raw.id || raw.chat_id || ""),
    chatGroupId: String(raw.chat_group_id || "").trim() || null,
    configId: String(config || "").trim() || null,
    status: String(raw.status || "").trim() || null,
    startTimestampMs: Number(raw.start_timestamp) || null,
    endTimestampMs: Number(raw.end_timestamp) || null,
    eventCount: Number(raw.event_count) || null,
    twilioCallSid: twilio.callSid,
    direction: twilio.direction,
    requestId: String(raw.request_id || "").trim() || null,
  };
}

async function humeHistoryRequest(path: string, init?: RequestInit) {
  const config = getHumeConfig();
  const runtime = getHumeChatHistoryConfig();
  if (!config.apiKey) throw new Error("hume_api_key_missing");

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), runtime.requestTimeoutMs);
    try {
      const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Hume-Api-Key": config.apiKey,
          ...(init?.headers || {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const classified = classifyHttpStatus(response.status);
        if (classified.retryable && attempt < runtime.maxRetries) {
          attempt += 1;
          await sleep(attempt * 1000);
          continue;
        }
        throw new HumeControlPlaneError({
          message: `hume_history_request_failed:${response.status}`,
          status: response.status,
          kind: response.status === 429 ? "rate_limit" : response.status >= 500 ? "server" : "client",
          retryable: classified.retryable,
        });
      }
      return response.json() as Promise<Record<string, unknown>>;
    } catch (error) {
      if (error instanceof HumeControlPlaneError) throw error;
      if (attempt < runtime.maxRetries) {
        attempt += 1;
        await sleep(attempt * 1000);
        continue;
      }
      throw new HumeControlPlaneError({
        message: error instanceof Error ? error.message.slice(0, 120) : "hume_history_network_error",
        kind: "network",
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function listHumeChats(input?: {
  pageNumber?: number;
  pageSize?: number;
  ascendingOrder?: boolean;
}) {
  const runtime = getHumeChatHistoryConfig();
  const search = new URLSearchParams({
    page_number: String(input?.pageNumber ?? 0),
    page_size: String(input?.pageSize ?? runtime.syncPageSize),
    ascending_order: String(input?.ascendingOrder ?? false),
  });
  const body = await humeHistoryRequest(`/v0/evi/chats?${search.toString()}`);
  const chatsRaw = (body.chats_page || body.chats || []) as Record<string, unknown>[];
  return {
    chats: chatsRaw.map(normalizeChatSummary),
    pageNumber: Number(body.page_number ?? input?.pageNumber ?? 0),
    totalPages: Number(body.total_pages ?? 1),
    totalChats: Number(body.total_chats ?? chatsRaw.length),
  };
}

export async function getHumeChat(chatId: string): Promise<HumeChatSummary> {
  const runtime = getHumeChatHistoryConfig();
  const search = new URLSearchParams({
    page_number: "0",
    page_size: "1",
    ascending_order: "true",
  });
  const body = await humeHistoryRequest(
    `/v0/evi/chats/${encodeURIComponent(chatId)}?${search.toString()}`,
  );
  const chatsRaw = (body.chats_page || body.chats || []) as Record<string, unknown>[];
  const first = chatsRaw[0] || body;
  const summary = normalizeChatSummary(first as Record<string, unknown>);
  if (!summary.id) {
    summary.id = chatId;
  }
  return summary;
}

export async function fetchAllHumeChatEvents(chatId: string): Promise<{
  events: HumeChatEvent[];
  totalPages: number;
}> {
  const runtime = getHumeChatHistoryConfig();
  const events: HumeChatEvent[] = [];
  let page = 0;
  let totalPages = 1;
  while (page < totalPages && page < runtime.syncMaxPages) {
    const search = new URLSearchParams({
      page_number: String(page),
      page_size: String(runtime.syncPageSize),
      ascending_order: "true",
    });
    const body = await humeHistoryRequest(
      `/v0/evi/chats/${encodeURIComponent(chatId)}?${search.toString()}`,
    );
    const pageEvents = (body.events_page || body.events || []) as HumeChatEvent[];
    events.push(...pageEvents);
    totalPages = Number(body.total_pages || 1);
    page += 1;
  }
  return { events, totalPages: Math.min(totalPages, runtime.syncMaxPages) };
}

export async function requestHumeChatAudio(chatId: string) {
  const body = await humeHistoryRequest(
    `/v0/evi/chats/${encodeURIComponent(chatId)}/audio`,
    { method: "GET" },
  );
  return body;
}

export { parseTwilioMetadata, normalizeChatSummary };
