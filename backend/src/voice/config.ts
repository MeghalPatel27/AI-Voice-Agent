/**
 * Voice Engine V2 configuration.
 * Isolated from CRM / auth / dashboard settings.
 */

export type VoiceTtsProvider = "openai" | "elevenlabs";
export type ElevenLabsTtsTransport = "websocket" | "http";

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envString(name: string, fallback: string) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function envBool(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function envNumberList(name: string, fallback: number[]) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const values = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length > 0 ? values : fallback;
}

/**
 * ElevenLabs requires each schedule entry in 50–500.
 * Values below 50 are rejected/clamped — they cause low-quality early synthesis.
 */
function sanitizeChunkLengthSchedule(values: number[]) {
  const clamped = values
    .map((value) => Math.min(500, Math.max(50, Math.round(value))))
    .filter((value) => Number.isFinite(value));
  return clamped.length > 0 ? clamped : [120, 160, 250, 290];
}

/**
 * Prefer OpenAI Realtime Mini for responsiveness.
 * Override with OPENAI_REALTIME_MODEL if needed.
 */
export const VOICE_ENGINE_CONFIG = {
  openaiRealtimeModel: envString(
    "OPENAI_REALTIME_MODEL",
    "gpt-realtime-2.1-mini",
  ),
  openaiRealtimeVoice: envString("OPENAI_REALTIME_VOICE", "marin"),
  openaiRealtimeOutputTokenLimit: envNumber(
    "OPENAI_REALTIME_OUTPUT_TOKEN_LIMIT",
    1200,
  ),

  /**
   * openai = current speech-to-speech path (OpenAI audio out → Twilio)
   * elevenlabs = OpenAI text out → ElevenLabs Flash streaming TTS → Twilio
   */
  ttsProvider: ((): VoiceTtsProvider => {
    const raw = envString("VOICE_TTS_PROVIDER", "").toLowerCase();
    if (raw === "elevenlabs" || raw === "openai") return raw;
    // Auto-enable ElevenLabs when key is present and not a placeholder.
    const key = process.env.ELEVENLABS_API_KEY || "";
    if (
      key &&
      !key.includes("your_") &&
      !key.includes("paste_") &&
      key.length > 10
    ) {
      return "elevenlabs";
    }
    return "openai";
  })(),

  /**
   * Phase 2 default: persistent multi-context WebSocket.
   * Set ELEVENLABS_TTS_TRANSPORT=http to force Phase 1 HTTP streaming.
   */
  elevenLabsTransport: ((): ElevenLabsTtsTransport => {
    const raw = envString("ELEVENLABS_TTS_TRANSPORT", "websocket").toLowerCase();
    return raw === "http" ? "http" : "websocket";
  })(),

  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || "",
  elevenLabsVoiceId: envString(
    "ELEVENLABS_VOICE_ID",
    // Rachel — clear, natural default from ElevenLabs library
    "21m00Tcm4TlvDq8ikWAM",
  ),
  /**
   * Flash v2.5 is the current low-latency production model for telephony.
   * ~75ms inference; supports ulaw_8000 for Twilio Media Streams.
   * Docs recommend Flash over Turbo for lower latency.
   */
  elevenLabsModelId: envString("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5"),
  elevenLabsOutputFormat: envString(
    "ELEVENLABS_OUTPUT_FORMAT",
    "ulaw_8000",
  ),
  /**
   * Receptionist voice tuning (natural + low latency, not cost-optimised).
   * Docs baseline: stability 0.5 / similarity 0.8.
   * Slightly lower style keeps phone delivery calm and clear.
   */
  elevenLabsStability: envNumber("ELEVENLABS_STABILITY", 0.45),
  elevenLabsSimilarityBoost: envNumber("ELEVENLABS_SIMILARITY_BOOST", 0.8),
  elevenLabsStyle: envNumber("ELEVENLABS_STYLE", 0.12),
  elevenLabsSpeakerBoost: envBool("ELEVENLABS_SPEAKER_BOOST", true),
  /** Slightly under 1.0 improves intelligibility on μ-law telephony. */
  elevenLabsSpeed: envNumber("ELEVENLABS_SPEED", 0.98),
  elevenLabsInactivityTimeoutSec: envNumber(
    "ELEVENLABS_INACTIVITY_TIMEOUT_SEC",
    180,
  ),
  /**
   * ElevenLabs default generation schedule.
   * Docs: each value must be 50–500; default is [120, 160, 250, 290].
   * Used without auto_mode so LLM token deltas buffer into real phrases
   * instead of synthesizing word-by-word. flush:true at turn end.
   */
  elevenLabsChunkLengthSchedule: sanitizeChunkLengthSchedule(
    envNumberList("ELEVENLABS_CHUNK_LENGTH_SCHEDULE", [120, 160, 250, 290]),
  ),

  /**
   * Local VAD defaults. Adaptive turn detection scales end-silence
   * around localVadEndSilenceMs based on speech behaviour.
   */
  localVadThreshold: envNumber("VOICE_LOCAL_VAD_THRESHOLD", 950),
  localVadPeakThreshold: envNumber("VOICE_LOCAL_VAD_PEAK_THRESHOLD", 3600),
  localVadEndSilenceMs: envNumber("VOICE_LOCAL_VAD_END_SILENCE_MS", 700),
  localVadMinSpeechMs: envNumber("VOICE_LOCAL_VAD_MIN_SPEECH_MS", 280),
  localVadMaxTurnMs: envNumber("VOICE_LOCAL_VAD_MAX_TURN_MS", 18000),
  localVadCommitDelayMs: envNumber("VOICE_LOCAL_VAD_COMMIT_DELAY_MS", 80),
  localVadShortSilenceMs: envNumber("VOICE_LOCAL_VAD_SHORT_SILENCE_MS", 380),
  localVadMediumSilenceMs: envNumber("VOICE_LOCAL_VAD_MEDIUM_SILENCE_MS", 650),
  localVadLongSilenceMs: envNumber("VOICE_LOCAL_VAD_LONG_SILENCE_MS", 1000),
  localVadShortSpeechMs: envNumber("VOICE_LOCAL_VAD_SHORT_SPEECH_MS", 800),
  localVadLongSpeechMs: envNumber("VOICE_LOCAL_VAD_LONG_SPEECH_MS", 2500),
  echoGuardMs: envNumber("VOICE_ECHO_GUARD_MS", 700),
  bargeInEchoGuardMs: envNumber("VOICE_BARGE_IN_ECHO_GUARD_MS", 280),
  bargeInEnabled: envBool("VOICE_BARGE_IN_ENABLED", true),
  assistantPostPlaybackGraceMs: envNumber(
    "VOICE_ASSISTANT_POST_PLAYBACK_GRACE_MS",
    350,
  ),
} as const;

export function isElevenLabsTtsEnabled() {
  return (
    VOICE_ENGINE_CONFIG.ttsProvider === "elevenlabs" &&
    Boolean(VOICE_ENGINE_CONFIG.elevenLabsApiKey) &&
    !VOICE_ENGINE_CONFIG.elevenLabsApiKey.includes("your_") &&
    !VOICE_ENGINE_CONFIG.elevenLabsApiKey.includes("paste_")
  );
}

export function preferElevenLabsWebSocket() {
  return (
    isElevenLabsTtsEnabled() &&
    VOICE_ENGINE_CONFIG.elevenLabsTransport === "websocket"
  );
}
