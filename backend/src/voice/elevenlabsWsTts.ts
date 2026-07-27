/**
 * ElevenLabs multi-context WebSocket TTS for Twilio Media Streams.
 *
 * Production approach (ElevenLabs docs):
 * - Endpoint: /v1/text-to-speech/{voice_id}/multi-stream-input
 * - Model: eleven_flash_v2_5
 * - Format: ulaw_8000
 * - One persistent socket per call; contexts for barge-in
 */

import WebSocket from "ws";
import { VOICE_ENGINE_CONFIG } from "./config";
import { isElevenLabsConfigured } from "./elevenlabsTts";

export type ElevenLabsWsHandlers = {
  onAudioChunk: (base64Mulaw: string, contextId: string) => void;
  onFirstChunk?: (contextId: string) => void;
  onContextFinal?: (contextId: string) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

type PendingContext = {
  initialized: boolean;
  sawFirstChunk: boolean;
};

function buildWebSocketUrl() {
  const voiceId = encodeURIComponent(VOICE_ENGINE_CONFIG.elevenLabsVoiceId);
  const modelId = encodeURIComponent(VOICE_ENGINE_CONFIG.elevenLabsModelId);
  const outputFormat = encodeURIComponent(
    VOICE_ENGINE_CONFIG.elevenLabsOutputFormat,
  );
  const inactivity = encodeURIComponent(
    String(VOICE_ENGINE_CONFIG.elevenLabsInactivityTimeoutSec),
  );

  // Do NOT enable auto_mode when forwarding LLM token deltas.
  // Measured: auto_mode + word-sized deltas → one synthesis per word
  // (choppy / overlapping playback). chunk_length_schedule + flush at
  // turn end is the correct control for this pipeline.
  return (
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/multi-stream-input` +
    `?model_id=${modelId}` +
    `&output_format=${outputFormat}` +
    `&inactivity_timeout=${inactivity}`
  );
}

function voiceSettingsPayload() {
  const settings: Record<string, unknown> = {
    stability: VOICE_ENGINE_CONFIG.elevenLabsStability,
    similarity_boost: VOICE_ENGINE_CONFIG.elevenLabsSimilarityBoost,
    style: VOICE_ENGINE_CONFIG.elevenLabsStyle,
    use_speaker_boost: VOICE_ENGINE_CONFIG.elevenLabsSpeakerBoost,
  };

  const speed = VOICE_ENGINE_CONFIG.elevenLabsSpeed;
  if (Number.isFinite(speed) && speed > 0 && speed !== 1) {
    settings.speed = speed;
  }

  return settings;
}

function generationConfigPayload() {
  return {
    chunk_length_schedule: [...VOICE_ENGINE_CONFIG.elevenLabsChunkLengthSchedule],
  };
}

/**
 * Persistent multi-context TTS client. One instance per Twilio call.
 */
export class ElevenLabsMultiStreamTts {
  private socket: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private connectPromise: Promise<void> | null = null;
  private activeContextId: string | null = null;
  private contexts = new Map<string, PendingContext>();
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private handlers: ElevenLabsWsHandlers;

  constructor(handlers: ElevenLabsWsHandlers) {
    this.handlers = handlers;
  }

  get isReady() {
    return this.ready && !this.closed;
  }

  get currentContextId() {
    return this.activeContextId;
  }

  async connect(): Promise<void> {
    if (this.closed) {
      throw new Error("ElevenLabs WS client is closed");
    }
    if (this.ready) return;
    if (this.connectPromise) return this.connectPromise;

    if (!isElevenLabsConfigured()) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const url = buildWebSocketUrl();
      const socket = new WebSocket(url, {
        headers: {
          "xi-api-key": VOICE_ENGINE_CONFIG.elevenLabsApiKey,
        },
        maxPayload: 16 * 1024 * 1024,
      });

      this.socket = socket;
      let settled = false;

      const settleOk = () => {
        if (settled) return;
        settled = true;
        this.ready = true;
        this.startKeepAlive();
        this.handlers.onOpen?.();
        resolve();
      };

      const settleErr = (error: Error) => {
        if (settled) return;
        settled = true;
        this.ready = false;
        reject(error);
      };

      socket.on("open", () => {
        settleOk();
      });

      socket.on("message", (raw) => {
        this.handleMessage(raw);
      });

      socket.on("error", (error) => {
        const err =
          error instanceof Error ? error : new Error(String(error));
        this.handlers.onError?.(err);
        settleErr(err);
      });

      socket.on("close", () => {
        this.ready = false;
        this.stopKeepAlive();
        this.handlers.onClose?.();
        if (!settled) {
          settleErr(new Error("ElevenLabs WebSocket closed before open"));
        }
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  /**
   * Start (or continue) an utterance context. First text for a new context
   * includes voice_settings + generation_config.
   */
  beginUtterance(contextId: string) {
    if (!contextId) return;
    this.activeContextId = contextId;
    if (!this.contexts.has(contextId)) {
      this.contexts.set(contextId, {
        initialized: false,
        sawFirstChunk: false,
      });
    }
  }

  /**
   * Stream text into the active context.
   * For continuous LLM deltas: call repeatedly with flush:false.
   * Flush only at turn end (or forced) — do not wait for sentences.
   * ElevenLabs buffers until chunk_length_schedule thresholds; do not
   * client-side fragment further.
   */
  sendText(text: string, options?: { flush?: boolean; contextId?: string }) {
    const contextId = options?.contextId || this.activeContextId;
    if (!contextId || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    const cleaned = String(text || "");
    if (!cleaned && !options?.flush) return false;

    let ctx = this.contexts.get(contextId);
    if (!ctx) {
      this.beginUtterance(contextId);
      ctx = this.contexts.get(contextId)!;
    }

    const message: Record<string, unknown> = {
      text: cleaned || " ",
      context_id: contextId,
    };

    if (!ctx.initialized) {
      message.voice_settings = voiceSettingsPayload();
      message.generation_config = generationConfigPayload();
      // Docs: first message establishing a context should end with a space.
      if (cleaned && !cleaned.endsWith(" ")) {
        message.text = `${cleaned} `;
      }
      ctx.initialized = true;
    }
    // Continuous streaming: forward deltas as-is. Do not force trailing
    // spaces on every chunk — that inserts artificial pauses. Spaces from
    // the LLM deltas are preserved by the caller.

    if (options?.flush) {
      message.flush = true;
    }

    const outboundText = String(message.text ?? "");
    console.log(
      JSON.stringify({
        scope: "voice_audio_pipeline",
        event: "elevenlabs_text_chunk",
        at: new Date().toISOString(),
        contextId,
        chars: outboundText.length,
        flush: Boolean(options?.flush),
        contextInit: Boolean(message.voice_settings),
        preview: outboundText.slice(0, 80),
      }),
    );

    this.socket.send(JSON.stringify(message));
    return true;
  }

  /**
   * Forward a raw LLM text delta with no flush (lowest first-audio latency).
   */
  streamDelta(delta: string, contextId?: string) {
    return this.sendText(delta, { flush: false, contextId });
  }

  flush(contextId?: string) {
    const id = contextId || this.activeContextId;
    if (!id || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.socket.send(
      JSON.stringify({
        context_id: id,
        flush: true,
      }),
    );
    return true;
  }

  closeContext(contextId?: string) {
    const id = contextId || this.activeContextId;
    console.log(
      JSON.stringify({
        scope: "voice_audio_pipeline",
        event: "elevenlabs_close_context",
        at: new Date().toISOString(),
        contextId: id,
        socketOpen: Boolean(
          this.socket && this.socket.readyState === WebSocket.OPEN,
        ),
        hadActiveContext: this.activeContextId === id,
      }),
    );

    if (!id || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (this.activeContextId === id) this.activeContextId = null;
      if (id) this.contexts.delete(id);
      return false;
    }

    this.socket.send(
      JSON.stringify({
        context_id: id,
        close_context: true,
      }),
    );

    this.contexts.delete(id);
    if (this.activeContextId === id) {
      this.activeContextId = null;
    }
    return true;
  }

  /**
   * Interrupt current synthesis (barge-in).
   */
  interrupt() {
    console.log(
      JSON.stringify({
        scope: "voice_audio_pipeline",
        event: "playback_interruption",
        at: new Date().toISOString(),
        reason: "elevenlabs_interrupt",
        contextId: this.activeContextId,
      }),
    );
    if (this.activeContextId) {
      this.closeContext(this.activeContextId);
    }
  }

  close() {
    this.closed = true;
    this.stopKeepAlive();
    this.activeContextId = null;
    this.contexts.clear();

    if (!this.socket) return;

    try {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ close_socket: true }));
      }
    } catch {
      // ignore
    }

    try {
      this.socket.close();
    } catch {
      // ignore
    }

    this.socket = null;
    this.ready = false;
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    // Keep contexts alive during LLM thinking gaps (default timeout 20s).
    this.keepAliveTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const contextId = this.activeContextId;
      if (!contextId) return;
      try {
        this.socket.send(
          JSON.stringify({
            context_id: contextId,
            text: "",
          }),
        );
      } catch {
        // ignore
      }
    }, 15000);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private handleMessage(raw: WebSocket.RawData) {
    try {
      const data = JSON.parse(raw.toString());
      const contextId = String(
        data.contextId || data.context_id || this.activeContextId || "default",
      );

      if (data.error) {
        const message =
          typeof data.error === "string"
            ? data.error
            : data.message || JSON.stringify(data.error);
        this.handlers.onError?.(new Error(`ElevenLabs WS: ${message}`));
        return;
      }

      if (data.audio) {
        const ctx = this.contexts.get(contextId);
        if (ctx && !ctx.sawFirstChunk) {
          ctx.sawFirstChunk = true;
          this.handlers.onFirstChunk?.(contextId);
        }
        this.handlers.onAudioChunk(String(data.audio), contextId);
      }

      if (data.isFinal || data.is_final) {
        if (!data.audio) {
          const ctx = this.contexts.get(contextId);
          if (!ctx?.sawFirstChunk) {
            this.handlers.onError?.(
              new Error(
                `ElevenLabs WS returned isFinal with no audio for context ${contextId}. ` +
                  `Often caused by a free-plan restriction on library voices (HTTP 402 paid_plan_required), ` +
                  `an invalid voice_id, or rejected voice_settings.`,
              ),
            );
          }
        }
        this.handlers.onContextFinal?.(contextId);
      }
    } catch (error) {
      this.handlers.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
