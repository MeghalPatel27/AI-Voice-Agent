/**
 * ElevenLabs HTTP streaming TTS for Twilio Media Streams.
 *
 * Phase 1 transport (kept as fallback when WebSocket is unavailable):
 * - Model: eleven_flash_v2_5 (lowest-latency Flash)
 * - Format: ulaw_8000 (native telephony, no transcoding)
 * - Transport: HTTP chunked stream per utterance
 *
 * Phase 2 primary path: elevenlabsWsTts.ts (multi-stream-input WebSocket).
 */

import { VOICE_ENGINE_CONFIG } from "./config";

export type ElevenLabsStreamHandlers = {
  onAudioChunk: (base64Mulaw: string) => void;
  onFirstChunk?: () => void;
  onError?: (error: Error) => void;
};

export function isElevenLabsConfigured() {
  const key = VOICE_ENGINE_CONFIG.elevenLabsApiKey;
  return Boolean(key) && !key.includes("your_") && !key.includes("paste_");
}

/**
 * Stream μ-law audio for a single text utterance.
 * Forwards each binary chunk as base64 suitable for Twilio `media` events.
 */
export async function streamElevenLabsUlaw(input: {
  text: string;
  signal?: AbortSignal;
  handlers: ElevenLabsStreamHandlers;
}) {
  const text = String(input.text || "").trim();
  if (!text) return;

  if (!isElevenLabsConfigured()) {
    throw new Error("ELEVENLABS_API_KEY is not configured");
  }

  console.log(
    JSON.stringify({
      scope: "voice_audio_pipeline",
      event: "elevenlabs_text_chunk",
      at: new Date().toISOString(),
      transport: "http",
      chars: text.length,
      flush: true,
      preview: text.slice(0, 80),
    }),
  );

  const voiceId = encodeURIComponent(VOICE_ENGINE_CONFIG.elevenLabsVoiceId);
  const outputFormat = encodeURIComponent(
    VOICE_ENGINE_CONFIG.elevenLabsOutputFormat,
  );
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}&optimize_streaming_latency=3`;

  const init: RequestInit = {
    method: "POST",
    headers: {
      "xi-api-key": VOICE_ENGINE_CONFIG.elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: "application/octet-stream",
    },
    body: JSON.stringify({
      text,
      model_id: VOICE_ENGINE_CONFIG.elevenLabsModelId,
      voice_settings: {
        stability: VOICE_ENGINE_CONFIG.elevenLabsStability,
        similarity_boost: VOICE_ENGINE_CONFIG.elevenLabsSimilarityBoost,
        style: VOICE_ENGINE_CONFIG.elevenLabsStyle,
        use_speaker_boost: VOICE_ENGINE_CONFIG.elevenLabsSpeakerBoost,
      },
    }),
  };

  if (input.signal) {
    init.signal = input.signal;
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs TTS failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }

  if (!response.body) {
    throw new Error("ElevenLabs TTS returned an empty body");
  }

  const reader = response.body.getReader();
  let sawFirstChunk = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;

    if (!sawFirstChunk) {
      sawFirstChunk = true;
      input.handlers.onFirstChunk?.();
    }

    input.handlers.onAudioChunk(Buffer.from(value).toString("base64"));
  }
}

/**
 * Speak multiple sentence chunks sequentially (used with SentenceStreamer).
 */
export async function streamElevenLabsUtterances(input: {
  texts: string[];
  signal?: AbortSignal;
  handlers: ElevenLabsStreamHandlers;
}) {
  let firstEmitted = false;

  for (const text of input.texts) {
    if (input.signal?.aborted) break;

    const handlers: ElevenLabsStreamHandlers = {
      onAudioChunk: input.handlers.onAudioChunk,
      onFirstChunk: () => {
        if (!firstEmitted) {
          firstEmitted = true;
          input.handlers.onFirstChunk?.();
        }
      },
    };

    if (input.handlers.onError) {
      handlers.onError = input.handlers.onError;
    }

    await streamElevenLabsUlaw({
      text,
      ...(input.signal ? { signal: input.signal } : {}),
      handlers,
    });
  }
}
