import { getHumeConfig } from "./hume.config";
import { getHumeToolRuntimeConfig } from "./humeToolRuntime.config";

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
};

export type HumeControlPlaneErrorKind =
  | "timeout"
  | "network"
  | "auth"
  | "rate_limit"
  | "server"
  | "client"
  | "unknown";

export class HumeControlPlaneError extends Error {
  readonly status: number | null;
  readonly kind: HumeControlPlaneErrorKind;
  readonly retryable: boolean;

  constructor(input: {
    message: string;
    status?: number | null;
    kind: HumeControlPlaneErrorKind;
    retryable: boolean;
  }) {
    super(input.message);
    this.name = "HumeControlPlaneError";
    this.status = input.status ?? null;
    this.kind = input.kind;
    this.retryable = input.retryable;
  }
}

function classifyHttpStatus(status: number): {
  kind: HumeControlPlaneErrorKind;
  retryable: boolean;
} {
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (status === 429) return { kind: "rate_limit", retryable: true };
  if (status >= 500) return { kind: "server", retryable: true };
  if (status >= 400) return { kind: "client", retryable: false };
  return { kind: "unknown", retryable: false };
}

async function humeRequest(path: string, options: RequestOptions = {}) {
  const config = getHumeConfig();
  if (!config.apiKey) throw new Error("hume_api_key_missing");
  const timeoutMs =
    options.timeoutMs ?? getHumeToolRuntimeConfig().controlPlaneTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Hume-Api-Key": config.apiKey,
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new HumeControlPlaneError({
        message: "hume_request_timeout",
        kind: "timeout",
        retryable: true,
      });
    }
    throw new HumeControlPlaneError({
      message: error instanceof Error ? error.message.slice(0, 120) : "hume_network_error",
      kind: "network",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function listHumeChatEvents(chatId: string, pageNumber: number) {
  const search = new URLSearchParams({
    page_number: String(pageNumber),
    page_size: "100",
    ascending_order: "true",
  });
  const response = await humeRequest(`/v0/evi/chats/${encodeURIComponent(chatId)}?${search.toString()}`);
  if (!response.ok) {
    throw new Error(`hume_list_events_failed:${response.status}`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  return {
    ...body,
    events: body.events_page || body.events || [],
  };
}

export async function getHumeChatAudio(chatId: string) {
  const response = await humeRequest(`/v0/evi/chats/${encodeURIComponent(chatId)}/audio`);
  if (!response.ok) {
    throw new Error(`hume_chat_audio_failed:${response.status}`);
  }
  return response.json() as Promise<any>;
}

export type HumeToolControlPlaneMessage = {
  type: "tool_response" | "tool_error";
  tool_call_id: string;
  content: string;
};

export async function sendHumeToolResponse(
  chatId: string,
  payload: HumeToolControlPlaneMessage,
) {
  const response = await humeRequest(`/v0/evi/chat/${encodeURIComponent(chatId)}/send`, {
    method: "POST",
    body: payload,
  });
  if (!response.ok) {
    const text = await response.text();
    const classified = classifyHttpStatus(response.status);
    throw new HumeControlPlaneError({
      message: `hume_send_failed:${response.status}:${text.slice(0, 120)}`,
      status: response.status,
      kind: classified.kind,
      retryable: classified.retryable,
    });
  }
}

export async function getHumeChatStatus(chatId: string): Promise<{
  status: string | null;
  terminal: boolean;
}> {
  const response = await humeRequest(
    `/v0/evi/chats/${encodeURIComponent(chatId)}?page_number=0&page_size=1`,
  );
  if (!response.ok) {
    if (response.status === 404) {
      return { status: "NOT_FOUND", terminal: true };
    }
    const classified = classifyHttpStatus(response.status);
    throw new HumeControlPlaneError({
      message: `hume_chat_status_failed:${response.status}`,
      status: response.status,
      kind: classified.kind,
      retryable: classified.retryable,
    });
  }
  const body = (await response.json()) as { status?: string };
  const status = String(body?.status || "").toUpperCase() || null;
  const terminal = Boolean(
    status &&
      ["USER_ENDED", "AGENT_ENDED", "TIMEOUT", "ERROR", "CLOSED", "NOT_FOUND"].includes(
        status,
      ),
  );
  return { status, terminal };
}
