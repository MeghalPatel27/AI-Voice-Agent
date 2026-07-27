/**
 * Measures turn latency on the live voice path.
 * Logs structured events so we can separate VAD vs model vs TTS vs Twilio.
 *
 * Every stage is a real timestamp — never estimated.
 */

export type VoiceLatencyPhase =
  | "caller_speech_started"
  | "caller_speech_ended"
  | "vad_triggered"
  | "caller_turn_committed"
  | "assistant_response_create"
  | "openai_first_token"
  | "openai_final_delta"
  | "openai_completed"
  | "elevenlabs_first_audio"
  | "first_audio_to_twilio"
  | "first_playback_mark"
  | "assistant_first_audio"
  | "assistant_playback_complete";

export type VoiceLatencySnapshot = {
  callSid?: string;
  conversationId?: string;
  streamSid?: string;
  ttsProvider?: string;
  ttsTransport?: string;
  model?: string;
  speechStartedAt?: number;
  speechEndedAt?: number;
  vadTriggeredAt?: number;
  committedAt?: number;
  responseCreateAt?: number;
  openaiFirstTokenAt?: number;
  openaiFinalDeltaAt?: number;
  openaiCompletedAt?: number;
  elevenLabsFirstAudioAt?: number;
  firstAudioToTwilioAt?: number;
  firstPlaybackMarkAt?: number;
  firstAudioAt?: number;
  playbackCompleteAt?: number;
};

type StageMs = {
  name: string;
  ms: number;
};

export class VoiceLatencyTracker {
  private turn = 0;
  private snapshot: VoiceLatencySnapshot = {};

  constructor(
    private readonly log: (
      event: string,
      data: Record<string, unknown>,
    ) => void,
  ) {}

  setContext(ctx: Partial<VoiceLatencySnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...ctx,
    };
  }

  /**
   * Mark a phase at an explicit timestamp (e.g. speech ended = last speech frame).
   */
  markAt(
    phase: VoiceLatencyPhase,
    atMs: number,
    extra: Record<string, unknown> = {},
  ) {
    this.applyMark(phase, atMs, extra);
  }

  mark(phase: VoiceLatencyPhase, extra: Record<string, unknown> = {}) {
    this.applyMark(phase, Date.now(), extra);
  }

  private applyMark(
    phase: VoiceLatencyPhase,
    now: number,
    extra: Record<string, unknown>,
  ) {
    if (phase === "caller_speech_started") {
      this.turn += 1;
      this.snapshot.speechStartedAt = now;
      delete this.snapshot.speechEndedAt;
      delete this.snapshot.vadTriggeredAt;
      delete this.snapshot.committedAt;
      delete this.snapshot.responseCreateAt;
      delete this.snapshot.openaiFirstTokenAt;
      delete this.snapshot.openaiFinalDeltaAt;
      delete this.snapshot.openaiCompletedAt;
      delete this.snapshot.elevenLabsFirstAudioAt;
      delete this.snapshot.firstAudioToTwilioAt;
      delete this.snapshot.firstPlaybackMarkAt;
      delete this.snapshot.firstAudioAt;
      delete this.snapshot.playbackCompleteAt;
    }

    if (phase === "caller_speech_ended") {
      if (!this.snapshot.speechEndedAt) {
        this.snapshot.speechEndedAt = now;
      }
    }

    if (phase === "vad_triggered") {
      if (!this.snapshot.vadTriggeredAt) {
        this.snapshot.vadTriggeredAt = now;
      }
    }

    if (phase === "caller_turn_committed") {
      this.snapshot.committedAt = now;
      if (!this.snapshot.speechEndedAt) {
        this.snapshot.speechEndedAt = now;
      }
      if (!this.snapshot.vadTriggeredAt) {
        this.snapshot.vadTriggeredAt = now;
      }
    }

    if (phase === "assistant_response_create") {
      this.snapshot.responseCreateAt = now;
    }

    if (phase === "openai_first_token") {
      if (this.snapshot.openaiFirstTokenAt) return;
      this.snapshot.openaiFirstTokenAt = now;
    }

    if (phase === "openai_final_delta" || phase === "openai_completed") {
      this.snapshot.openaiFinalDeltaAt = now;
      this.snapshot.openaiCompletedAt = now;
    }

    if (phase === "elevenlabs_first_audio") {
      if (this.snapshot.elevenLabsFirstAudioAt) return;
      this.snapshot.elevenLabsFirstAudioAt = now;
    }

    if (phase === "first_audio_to_twilio" || phase === "assistant_first_audio") {
      if (this.snapshot.firstAudioAt) return;
      this.snapshot.firstAudioToTwilioAt = now;
      this.snapshot.firstAudioAt = now;
      this.logTurnLatency("first_audio", extra);
      return;
    }

    if (phase === "first_playback_mark") {
      if (this.snapshot.firstPlaybackMarkAt) return;
      this.snapshot.firstPlaybackMarkAt = now;
    }

    if (phase === "assistant_playback_complete") {
      this.snapshot.playbackCompleteAt = now;
      this.logTurnLatency("playback_complete", extra);
      return;
    }

    this.log("voice_latency_mark", {
      phase,
      turn: this.turn,
      callSid: this.snapshot.callSid,
      conversationId: this.snapshot.conversationId,
      atMs: now,
      ...extra,
    });
  }

  private buildStages(): StageMs[] {
    const {
      speechStartedAt,
      speechEndedAt,
      vadTriggeredAt,
      committedAt,
      responseCreateAt,
      openaiFirstTokenAt,
      openaiFinalDeltaAt,
      openaiCompletedAt,
      elevenLabsFirstAudioAt,
      firstAudioToTwilioAt,
      firstPlaybackMarkAt,
      firstAudioAt,
      playbackCompleteAt,
    } = this.snapshot;

    const stages: StageMs[] = [];
    const push = (name: string, from?: number, to?: number) => {
      if (from && to && to >= from) {
        stages.push({ name, ms: to - from });
      }
    };

    push("speech_started_to_speech_ended", speechStartedAt, speechEndedAt);
    push("speech_ended_to_vad", speechEndedAt, vadTriggeredAt);
    push("vad_to_commit", vadTriggeredAt, committedAt);
    push("speech_ended_to_commit", speechEndedAt, committedAt);
    push("commit_to_response_create", committedAt, responseCreateAt);
    push(
      "response_create_to_openai_first_token",
      responseCreateAt,
      openaiFirstTokenAt,
    );
    push(
      "openai_first_token_to_final_delta",
      openaiFirstTokenAt,
      openaiFinalDeltaAt || openaiCompletedAt,
    );
    // Critical streaming path: first token → ElevenLabs first byte (not waiting for completed).
    push(
      "openai_first_token_to_elevenlabs_first_audio",
      openaiFirstTokenAt,
      elevenLabsFirstAudioAt,
    );
    push(
      "response_create_to_elevenlabs_first_audio",
      responseCreateAt,
      elevenLabsFirstAudioAt,
    );
    push(
      "elevenlabs_first_audio_to_twilio",
      elevenLabsFirstAudioAt,
      firstAudioToTwilioAt || firstAudioAt,
    );
    push(
      "response_create_to_first_audio_twilio",
      responseCreateAt,
      firstAudioToTwilioAt || firstAudioAt,
    );
    push(
      "first_audio_to_playback_mark",
      firstAudioAt,
      firstPlaybackMarkAt,
    );
    push(
      "first_playback_mark_to_playback_complete",
      firstPlaybackMarkAt,
      playbackCompleteAt,
    );
    push(
      "first_audio_to_playback_complete",
      firstAudioAt,
      playbackCompleteAt,
    );

    return stages;
  }

  private slowestStage(stages: StageMs[]): StageMs | undefined {
    if (stages.length === 0) return undefined;
    return stages.reduce((best, stage) =>
      stage.ms > best.ms ? stage : best,
    );
  }

  private logTurnLatency(
    milestone: "first_audio" | "playback_complete",
    extra: Record<string, unknown>,
  ) {
    const {
      speechStartedAt,
      speechEndedAt,
      vadTriggeredAt,
      committedAt,
      responseCreateAt,
      openaiFirstTokenAt,
      openaiFinalDeltaAt,
      openaiCompletedAt,
      elevenLabsFirstAudioAt,
      firstAudioToTwilioAt,
      firstPlaybackMarkAt,
      firstAudioAt,
      playbackCompleteAt,
    } = this.snapshot;

    const stages = this.buildStages();
    const slowest = this.slowestStage(stages);

    this.log("voice_turn_latency", {
      milestone,
      turn: this.turn,
      callSid: this.snapshot.callSid,
      conversationId: this.snapshot.conversationId,
      streamSid: this.snapshot.streamSid,
      ttsProvider: this.snapshot.ttsProvider,
      ttsTransport: this.snapshot.ttsTransport,
      model: this.snapshot.model,
      speechToCommitMs:
        speechStartedAt && committedAt
          ? committedAt - speechStartedAt
          : undefined,
      speechStartedToSpeechEndedMs:
        speechStartedAt && speechEndedAt
          ? speechEndedAt - speechStartedAt
          : undefined,
      speechEndedToVadMs:
        speechEndedAt && vadTriggeredAt
          ? vadTriggeredAt - speechEndedAt
          : undefined,
      vadToCommitMs:
        vadTriggeredAt && committedAt
          ? committedAt - vadTriggeredAt
          : undefined,
      speechEndedToCommitMs:
        speechEndedAt && committedAt
          ? committedAt - speechEndedAt
          : undefined,
      commitToResponseCreateMs:
        committedAt && responseCreateAt
          ? responseCreateAt - committedAt
          : undefined,
      responseCreateToOpenAiFirstTokenMs:
        responseCreateAt && openaiFirstTokenAt
          ? openaiFirstTokenAt - responseCreateAt
          : undefined,
      openAiFirstTokenToFinalDeltaMs:
        openaiFirstTokenAt && (openaiFinalDeltaAt || openaiCompletedAt)
          ? (openaiFinalDeltaAt || openaiCompletedAt)! - openaiFirstTokenAt
          : undefined,
      openAiFirstTokenToElevenLabsFirstAudioMs:
        openaiFirstTokenAt && elevenLabsFirstAudioAt
          ? elevenLabsFirstAudioAt - openaiFirstTokenAt
          : undefined,
      responseCreateToElevenLabsFirstAudioMs:
        responseCreateAt && elevenLabsFirstAudioAt
          ? elevenLabsFirstAudioAt - responseCreateAt
          : undefined,
      elevenLabsFirstAudioToTwilioMs:
        elevenLabsFirstAudioAt && (firstAudioToTwilioAt || firstAudioAt)
          ? (firstAudioToTwilioAt || firstAudioAt)! - elevenLabsFirstAudioAt
          : undefined,
      responseCreateToFirstAudioMs:
        responseCreateAt && firstAudioAt
          ? firstAudioAt - responseCreateAt
          : undefined,
      firstAudioToPlaybackMarkMs:
        firstAudioAt && firstPlaybackMarkAt
          ? firstPlaybackMarkAt - firstAudioAt
          : undefined,
      /**
       * Primary UX metric: silence commit → first audio byte to Twilio.
       * Target band: ~300–800ms (plus network).
       */
      commitToFirstAudioMs:
        committedAt && firstAudioAt ? firstAudioAt - committedAt : undefined,
      speechEndToFirstAudioMs:
        (speechEndedAt || committedAt) && firstAudioAt
          ? firstAudioAt - (speechEndedAt || committedAt)!
          : undefined,
      firstAudioToPlaybackCompleteMs:
        firstAudioAt && playbackCompleteAt
          ? playbackCompleteAt - firstAudioAt
          : undefined,
      totalFirstResponseLatencyMs:
        (speechEndedAt || committedAt) && firstAudioAt
          ? firstAudioAt - (speechEndedAt || committedAt)!
          : undefined,
      stages,
      slowestStage: slowest?.name,
      slowestStageMs: slowest?.ms,
      ...extra,
    });
  }
}
