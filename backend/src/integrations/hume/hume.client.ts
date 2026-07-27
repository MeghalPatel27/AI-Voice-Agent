import { getHumeConfig } from "./hume.config";

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
};

async function humeRequest(path: string, options: RequestOptions = {}) {
  const config = getHumeConfig();
  if (!config.apiKey) throw new Error("hume_api_key_missing");
  const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Hume-Api-Key": config.apiKey,
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  return response;
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
  return response.json() as Promise<any>;
}

export async function getHumeChatAudio(chatId: string) {
  const response = await humeRequest(`/v0/evi/chats/${encodeURIComponent(chatId)}/audio`);
  if (!response.ok) {
    throw new Error(`hume_chat_audio_failed:${response.status}`);
  }
  return response.json() as Promise<any>;
}

export async function sendHumeToolResponse(chatId: string, payload: unknown) {
  const response = await humeRequest(`/v0/evi/chat/${encodeURIComponent(chatId)}/send`, {
    method: "POST",
    body: payload,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`hume_send_failed:${response.status}:${text.slice(0, 200)}`);
  }
}
