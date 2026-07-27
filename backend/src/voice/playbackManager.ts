/**
 * Twilio Media Streams playback helpers.
 * Owns media / mark / clear framing so the controller stays thinner.
 */

import WebSocket from "ws";

/** Twilio Media Streams typically deliver ~20ms μ-law frames at 8kHz. */
export const TWILIO_MEDIA_FRAME_MS = 20;

export type PlaybackSendJson = (
  socket: WebSocket,
  payload: Record<string, unknown>,
) => void;

export type PlaybackBufferSnapshot = {
  framesInFlight: number;
  estimatedBufferMs: number;
};

export type PlaybackManagerOptions = {
  twilioSocket: WebSocket;
  sendJson: PlaybackSendJson;
  onFirstMedia?: () => void;
  onMediaSent?: (buffer: PlaybackBufferSnapshot) => void;
};

export class PlaybackManager {
  private streamSid = "";
  private pendingMark = "";
  private playbackActive = false;
  private lastMediaAt = 0;
  private firstMediaEmitted = false;
  /** Frames sent since last clear / playback-complete mark. */
  private framesInFlight = 0;

  constructor(private readonly options: PlaybackManagerOptions) {}

  setStreamSid(streamSid: string) {
    this.streamSid = streamSid;
  }

  getStreamSid() {
    return this.streamSid;
  }

  get isPlaybackActive() {
    return this.playbackActive;
  }

  get lastMediaAtMs() {
    return this.lastMediaAt;
  }

  get pendingPlaybackMark() {
    return this.pendingMark;
  }

  getBufferDepth(): PlaybackBufferSnapshot {
    return {
      framesInFlight: this.framesInFlight,
      estimatedBufferMs: this.framesInFlight * TWILIO_MEDIA_FRAME_MS,
    };
  }

  resetTurnPlayback() {
    this.firstMediaEmitted = false;
  }

  sendMedia(base64Mulaw: string) {
    if (!base64Mulaw || !this.streamSid) return false;

    this.playbackActive = true;
    this.lastMediaAt = Date.now();
    this.framesInFlight += 1;

    if (!this.firstMediaEmitted) {
      this.firstMediaEmitted = true;
      this.options.onFirstMedia?.();
    }

    this.options.onMediaSent?.(this.getBufferDepth());

    this.options.sendJson(this.options.twilioSocket, {
      event: "media",
      streamSid: this.streamSid,
      media: {
        payload: base64Mulaw,
      },
    });

    return true;
  }

  sendMark(name: string) {
    if (!this.streamSid || !name) return false;

    this.options.sendJson(this.options.twilioSocket, {
      event: "mark",
      streamSid: this.streamSid,
      mark: {
        name,
      },
    });

    return true;
  }

  /**
   * Ask Twilio to flush its outbound audio buffer immediately (barge-in).
   */
  clearPlayback() {
    console.log(
      JSON.stringify({
        scope: "voice_audio_pipeline",
        event: "playback_interruption",
        at: new Date().toISOString(),
        reason: "twilio_clear",
        streamSid: this.streamSid || null,
        wasPlaybackActive: this.playbackActive,
        framesInFlight: this.framesInFlight,
        estimatedBufferMs: this.framesInFlight * TWILIO_MEDIA_FRAME_MS,
      }),
    );

    if (!this.streamSid) return false;

    this.options.sendJson(this.options.twilioSocket, {
      event: "clear",
      streamSid: this.streamSid,
    });

    this.playbackActive = false;
    this.pendingMark = "";
    this.firstMediaEmitted = false;
    this.framesInFlight = 0;
    this.lastMediaAt = Date.now();

    return true;
  }

  beginPlaybackMark(markName: string) {
    if (!markName || !this.streamSid || this.pendingMark) return false;
    this.pendingMark = markName;
    return this.sendMark(markName);
  }

  /**
   * @returns true when the mark matches the pending playback mark
   */
  handleMark(markName: string) {
    if (!markName || markName !== this.pendingMark) return false;
    this.pendingMark = "";
    this.playbackActive = false;
    this.framesInFlight = 0;
    this.lastMediaAt = Date.now();
    return true;
  }

  markPlaybackIdle() {
    this.playbackActive = false;
    this.pendingMark = "";
    this.firstMediaEmitted = false;
    this.framesInFlight = 0;
  }
}
