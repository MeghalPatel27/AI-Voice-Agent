/**
 * Voice Performance Test Suite — production validation profiler.
 *
 * Measure-only. Does not change barge-in, VAD, TTS, CRM, or business logic.
 * Aggregates per-turn latency marks into a graded call summary.
 */

import {
  aggregateStages,
  classifyCall,
  identifyBottleneck,
  pickHighlightedSlowestStage,
  summarizeMs,
} from "./classify";
import { ResourceMonitor } from "./resourceMonitor";
import { VoicePerfReportWriter } from "./reportWriter";
import { GRADE_THRESHOLDS } from "./thresholds";
import type {
  BargeInSample,
  PlaybackBufferSample,
  TurnLatencySample,
  VoiceCallPerformanceReport,
  VoicePerfCounters,
} from "./types";

export type VoicePerfLog = (
  event: string,
  data: Record<string, unknown>,
) => void;

export type VoicePerformanceSuiteOptions = {
  log?: VoicePerfLog;
  reportWriter?: VoicePerfReportWriter;
  resourceIntervalMs?: number;
  enabled?: boolean;
};

const TEN_MINUTES_MS = 10 * 60 * 1000;
const HUNDRED_TURNS = 100;

export class VoicePerformanceSuite {
  private readonly enabled: boolean;
  private readonly log: VoicePerfLog;
  private readonly writer: VoicePerfReportWriter;
  private readonly resources: ResourceMonitor;

  private startedAt = Date.now();
  private finalized = false;

  private callSid?: string;
  private conversationId?: string;
  private streamSid?: string;
  private ttsProvider?: string;
  private ttsTransport?: string;
  private model?: string;

  private turnSamples: TurnLatencySample[] = [];
  private bargeInSamples: BargeInSample[] = [];
  private bufferSamples: PlaybackBufferSample[] = [];

  private counters: VoicePerfCounters = {
    droppedAudioPackets: 0,
    cancelledResponses: 0,
    webSocketReconnects: 0,
    mediaFramesSent: 0,
    inboundMediaFrames: 0,
    bargeInCount: 0,
    turnCount: 0,
    firstAudioTurnCount: 0,
    playbackCompleteTurnCount: 0,
  };

  private bargeInStartedAt = 0;
  private peakBufferFrames = 0;
  private peakBufferMs = 0;
  private bufferSumMs = 0;
  private bufferSampleCount = 0;

  constructor(options: VoicePerformanceSuiteOptions = {}) {
    this.enabled =
      options.enabled ??
      envBool("VOICE_PERF_SUITE_ENABLED", true);
    this.log = options.log || defaultLog;
    this.writer = options.reportWriter || new VoicePerfReportWriter();
    this.resources = new ResourceMonitor({
      intervalMs: options.resourceIntervalMs ?? 2000,
      eventLoopBlockThresholdMs: GRADE_THRESHOLDS.eventLoopBlockThresholdMs,
    });
  }

  get isEnabled() {
    return this.enabled;
  }

  start(context: {
    callSid?: string;
    conversationId?: string;
    streamSid?: string;
    ttsProvider?: string;
    ttsTransport?: string;
    model?: string;
  } = {}) {
    if (!this.enabled) return;
    this.startedAt = Date.now();
    this.setContext(context);
    this.resources.start();
    this.log("voice_perf_suite_started", {
      callSid: this.callSid,
      conversationId: this.conversationId,
    });
  }

  setContext(ctx: {
    callSid?: string;
    conversationId?: string;
    streamSid?: string;
    ttsProvider?: string;
    ttsTransport?: string;
    model?: string;
  }) {
    if (ctx.callSid) this.callSid = ctx.callSid;
    if (ctx.conversationId) this.conversationId = ctx.conversationId;
    if (ctx.streamSid) this.streamSid = ctx.streamSid;
    if (ctx.ttsProvider) this.ttsProvider = ctx.ttsProvider;
    if (ctx.ttsTransport) this.ttsTransport = ctx.ttsTransport;
    if (ctx.model) this.model = ctx.model;
  }

  /**
   * Wrap VoiceLatencyTracker logging so turn rollups feed the suite
   * without changing tracker internals.
   */
  wrapLatencyLog(inner: VoicePerfLog): VoicePerfLog {
    return (event, data) => {
      this.onLatencyLog(event, data);
      inner(event, data);
    };
  }

  onLatencyLog(event: string, data: Record<string, unknown>) {
    if (!this.enabled) return;

    if (event === "voice_latency_mark") {
      const phase = String(data.phase || "");
      if (phase === "caller_speech_started") {
        this.counters.turnCount += 1;
      }
      return;
    }

    if (event !== "voice_turn_latency") return;

    const milestone =
      data.milestone === "playback_complete" ? "playback_complete" : "first_audio";
    const stages = Array.isArray(data.stages)
      ? (data.stages as Array<{ name: string; ms: number }>).filter(
          (s) => s && typeof s.name === "string" && Number.isFinite(s.ms),
        )
      : [];

    const committedHint = numberOrUndef(data.commitToFirstAudioMs);
    const commitToOpenAi = deriveCommitToOpenAi(data);
    const commitToEleven = deriveCommitToEleven(data);
    const commitToTwilio =
      numberOrUndef(data.commitToFirstAudioMs) ??
      numberOrUndef(data.responseCreateToFirstAudioMs);
    const endToEnd =
      numberOrUndef(data.totalFirstResponseLatencyMs) ??
      numberOrUndef(data.speechEndToFirstAudioMs) ??
      commitToTwilio;
    const playbackCompletion = numberOrUndef(data.firstAudioToPlaybackCompleteMs);

    const bottleneck = identifyBottleneck(committedHint, stages);

    const sample: TurnLatencySample = {
      turn: Number(data.turn) || this.counters.turnCount,
      at: new Date().toISOString(),
      milestone,
      commitToFirstAudioMs: committedHint,
      commitToOpenAiFirstDeltaMs: commitToOpenAi,
      commitToElevenLabsFirstByteMs: commitToEleven,
      commitToFirstTwilioAudioMs: commitToTwilio,
      endToEndFirstAudioMs: endToEnd,
      playbackCompletionMs: playbackCompletion,
      stages,
      slowestStage: typeof data.slowestStage === "string" ? data.slowestStage : undefined,
      slowestStageMs: numberOrUndef(data.slowestStageMs),
      bottleneck,
    };

    // Keep one sample per turn+milestone (last write wins).
    const existingIdx = this.turnSamples.findIndex(
      (t) => t.turn === sample.turn && t.milestone === sample.milestone,
    );
    if (existingIdx >= 0) {
      this.turnSamples[existingIdx] = sample;
    } else {
      this.turnSamples.push(sample);
    }

    if (milestone === "first_audio") {
      this.counters.firstAudioTurnCount = countUniqueTurns(
        this.turnSamples,
        "first_audio",
      );
      this.log("voice_perf_turn", {
        callSid: this.callSid,
        turn: sample.turn,
        milestone,
        commitToFirstAudioMs: sample.commitToFirstAudioMs,
        commitToOpenAiFirstDeltaMs: sample.commitToOpenAiFirstDeltaMs,
        commitToElevenLabsFirstByteMs: sample.commitToElevenLabsFirstByteMs,
        endToEndFirstAudioMs: sample.endToEndFirstAudioMs,
        slowestStage: sample.slowestStage,
        slowestStageMs: sample.slowestStageMs,
        bottleneck: sample.bottleneck,
      });
    }

    if (milestone === "playback_complete") {
      this.counters.playbackCompleteTurnCount = countUniqueTurns(
        this.turnSamples,
        "playback_complete",
      );
      this.log("voice_perf_playback_complete", {
        callSid: this.callSid,
        turn: sample.turn,
        playbackCompletionMs: sample.playbackCompletionMs,
        slowestStage: sample.slowestStage,
      });
    }
  }

  recordInboundMediaFrame() {
    if (!this.enabled) return;
    this.counters.inboundMediaFrames += 1;
  }

  recordMediaFrameSent(buffer?: { framesInFlight: number; estimatedBufferMs: number }) {
    if (!this.enabled) return;
    this.counters.mediaFramesSent += 1;
    if (!buffer) return;

    this.peakBufferFrames = Math.max(this.peakBufferFrames, buffer.framesInFlight);
    this.peakBufferMs = Math.max(this.peakBufferMs, buffer.estimatedBufferMs);
    this.bufferSumMs += buffer.estimatedBufferMs;
    this.bufferSampleCount += 1;

    if (this.bufferSamples.length < 200) {
      this.bufferSamples.push({
        at: new Date().toISOString(),
        framesInFlight: buffer.framesInFlight,
        estimatedBufferMs: buffer.estimatedBufferMs,
      });
    }
  }

  recordDroppedAudioPacket(reason: string) {
    if (!this.enabled) return;
    this.counters.droppedAudioPackets += 1;
    this.log("voice_perf_dropped_audio", {
      callSid: this.callSid,
      reason,
      total: this.counters.droppedAudioPackets,
    });
  }

  recordCancelledResponse(reason: string) {
    if (!this.enabled) return;
    this.counters.cancelledResponses += 1;
    this.log("voice_perf_cancelled_response", {
      callSid: this.callSid,
      reason,
      total: this.counters.cancelledResponses,
    });
  }

  recordWebSocketReconnect(socket: string, reason?: string) {
    if (!this.enabled) return;
    this.counters.webSocketReconnects += 1;
    this.log("voice_perf_ws_reconnect", {
      callSid: this.callSid,
      socket,
      reason,
      total: this.counters.webSocketReconnects,
    });
  }

  /**
   * Call at barge-in detection. Returns a finisher for clear-complete timing.
   */
  beginBargeIn(reason?: string): () => void {
    if (!this.enabled) {
      return () => undefined;
    }

    this.bargeInStartedAt = Date.now();
    this.counters.bargeInCount += 1;
    this.recordCancelledResponse(reason || "barge_in");

    return () => {
      if (!this.bargeInStartedAt) return;
      const clearLatencyMs = Date.now() - this.bargeInStartedAt;
      const sample: BargeInSample = {
        at: new Date().toISOString(),
        reason,
        clearLatencyMs,
      };
      this.bargeInSamples.push(sample);
      this.log("voice_perf_barge_in", {
        callSid: this.callSid,
        reason,
        clearLatencyMs,
        bargeInCount: this.counters.bargeInCount,
      });
      this.bargeInStartedAt = 0;
    };
  }

  /**
   * Optional: when assistant audio resumes after barge-in (full recovery time).
   */
  markBargeInAudioResumed() {
    if (!this.enabled || this.bargeInSamples.length === 0) return;
    const last = this.bargeInSamples[this.bargeInSamples.length - 1];
    if (last.fullResponseMs !== undefined) return;
    const started = Date.parse(last.at);
    if (!Number.isFinite(started)) return;
    last.fullResponseMs = Date.now() - started;
  }

  finalize(reason = "call_ended"): VoiceCallPerformanceReport | null {
    if (!this.enabled || this.finalized) return null;
    this.finalized = true;
    this.resources.stop();

    const report = this.buildReport(reason);
    const reportPath = this.writer.write(report);

    // Structured console summary (compact). Full detail lives in the JSON report file.
    this.log("voice_performance_summary", {
      callSid: report.callSid,
      conversationId: report.conversationId,
      streamSid: report.streamSid,
      ttsProvider: report.ttsProvider,
      ttsTransport: report.ttsTransport,
      model: report.model,
      reason,
      callDurationMs: report.callDurationMs,
      grade: report.grade,
      gradeReasons: report.gradeReasons,
      metrics: report.metrics,
      slowestStageOverall: report.slowestStageOverall,
      bottleneckTurnCount: report.bottleneckTurns.length,
      bottleneckTurns: report.bottleneckTurns.slice(0, 10),
      counters: report.counters,
      turnSampleCount: report.turnSamples.length,
      reportPath: reportPath || undefined,
    });

    return report;
  }

  buildReport(reason = "call_ended"): VoiceCallPerformanceReport {
    const firstAudioTurns = this.turnSamples.filter(
      (t) => t.milestone === "first_audio",
    );
    const playbackTurns = this.turnSamples.filter(
      (t) => t.milestone === "playback_complete",
    );

    const commitToOpenAi = summarizeMs(
      firstAudioTurns
        .map((t) => t.commitToOpenAiFirstDeltaMs)
        .filter((v): v is number => v !== undefined),
    );
    const commitToEleven = summarizeMs(
      firstAudioTurns
        .map((t) => t.commitToElevenLabsFirstByteMs)
        .filter((v): v is number => v !== undefined),
    );
    const commitToTwilio = summarizeMs(
      firstAudioTurns
        .map((t) => t.commitToFirstTwilioAudioMs ?? t.commitToFirstAudioMs)
        .filter((v): v is number => v !== undefined),
    );
    const endToEnd = summarizeMs(
      firstAudioTurns
        .map((t) => t.endToEndFirstAudioMs)
        .filter((v): v is number => v !== undefined),
    );
    const playback = summarizeMs(
      playbackTurns
        .map((t) => t.playbackCompletionMs)
        .filter((v): v is number => v !== undefined),
    );
    const bargeIn = summarizeMs(
      this.bargeInSamples.map((s) => s.clearLatencyMs),
    );

    const callDurationMs = Date.now() - this.startedAt;
    const commitValues = commitToTwilio.valuesMs;

    const avgLatencyAcross10MinuteCallMs =
      callDurationMs >= TEN_MINUTES_MS && commitValues.length > 0
        ? commitToTwilio.avgMs
        : null;

    const avgLatencyAcross100TurnsMs =
      firstAudioTurns.length >= HUNDRED_TURNS && commitValues.length > 0
        ? average(
            firstAudioTurns
              .slice(0, HUNDRED_TURNS)
              .map((t) => t.commitToFirstTwilioAudioMs ?? t.commitToFirstAudioMs)
              .filter((v): v is number => v !== undefined),
          )
        : null;

    const stageAggregates = aggregateStages(firstAudioTurns);
    const slowestStageOverall = pickHighlightedSlowestStage(stageAggregates);

    const bottleneckTurns = firstAudioTurns
      .filter((t) => t.bottleneck && t.commitToFirstAudioMs !== undefined)
      .map((t) => ({
        turn: t.turn,
        commitToFirstAudioMs: t.commitToFirstAudioMs!,
        bottleneck: t.bottleneck!,
      }));

    const resourceSummary = this.resources.getSummary();

    const { grade, reasons } = classifyCall({
      avgCommitToFirstAudioMs: commitToTwilio.avgMs,
      p95CommitToFirstAudioMs: commitToTwilio.p95Ms,
      avgBargeInMs: bargeIn.avgMs,
      droppedAudioPackets: this.counters.droppedAudioPackets,
      cancelledResponses: this.counters.cancelledResponses,
      webSocketReconnects: this.counters.webSocketReconnects,
      avgEventLoopLagMs: resourceSummary.eventLoop.avgLagMs,
      peakRssMb: resourceSummary.memory.peakRssMb,
      bottleneckTurnCount: bottleneckTurns.length,
      firstAudioTurnCount: firstAudioTurns.length,
    });

    return {
      scope: "voice_performance",
      event: "call_performance_summary",
      at: new Date().toISOString(),
      callSid: this.callSid,
      conversationId: this.conversationId,
      streamSid: this.streamSid,
      ttsProvider: this.ttsProvider,
      ttsTransport: this.ttsTransport,
      model: this.model,
      callDurationMs,
      grade,
      gradeReasons: reasons,
      metrics: {
        commitToOpenAiFirstDeltaMs: stripValues(commitToOpenAi),
        commitToElevenLabsFirstByteMs: stripValues(commitToEleven),
        commitToFirstTwilioAudioMs: stripValues(commitToTwilio),
        endToEndFirstAudioLatencyMs: stripValues(endToEnd),
        playbackCompletionMs: stripValues(playback),
        avgLatencyAcross10MinuteCallMs,
        avgLatencyAcross100TurnsMs,
        bargeInResponseMs: stripValues(bargeIn),
        droppedAudioPackets: this.counters.droppedAudioPackets,
        cancelledResponses: this.counters.cancelledResponses,
        webSocketReconnects: this.counters.webSocketReconnects,
        twilioPlaybackBufferDepth: {
          peakFrames: this.peakBufferFrames,
          peakEstimatedMs: this.peakBufferMs,
          avgEstimatedMs:
            this.bufferSampleCount > 0
              ? round1(this.bufferSumMs / this.bufferSampleCount)
              : 0,
          samples: this.bufferSampleCount,
        },
        cpuUsageDuringActiveCall: resourceSummary.cpu,
        memoryUsageOverConversation: resourceSummary.memory,
        eventLoopBlocking: resourceSummary.eventLoop,
      },
      slowestStageOverall,
      stageAggregates,
      bottleneckTurns,
      turnSamples: this.turnSamples,
      bargeInSamples: this.bargeInSamples,
      counters: { ...this.counters },
    };
  }
}

function deriveCommitToOpenAi(data: Record<string, unknown>): number | undefined {
  const commitToResponse = numberOrUndef(data.commitToResponseCreateMs);
  const responseToToken = numberOrUndef(data.responseCreateToOpenAiFirstTokenMs);
  if (commitToResponse !== undefined && responseToToken !== undefined) {
    return commitToResponse + responseToToken;
  }
  return responseToToken;
}

function deriveCommitToEleven(data: Record<string, unknown>): number | undefined {
  const commitToResponse = numberOrUndef(data.commitToResponseCreateMs);
  const responseToEleven = numberOrUndef(
    data.responseCreateToElevenLabsFirstAudioMs,
  );
  if (commitToResponse !== undefined && responseToEleven !== undefined) {
    return commitToResponse + responseToEleven;
  }
  const openAiPath = deriveCommitToOpenAi(data);
  const tokenToEleven = numberOrUndef(data.openAiFirstTokenToElevenLabsFirstAudioMs);
  if (openAiPath !== undefined && tokenToEleven !== undefined) {
    return openAiPath + tokenToEleven;
  }
  return responseToEleven;
}

function countUniqueTurns(
  samples: TurnLatencySample[],
  milestone: TurnLatencySample["milestone"],
) {
  return new Set(
    samples.filter((s) => s.milestone === milestone).map((s) => s.turn),
  ).size;
}

function numberOrUndef(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function stripValues<T extends { valuesMs: number[] }>(summary: T) {
  const { valuesMs: _omit, ...rest } = summary;
  return rest;
}

function defaultLog(event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      scope: "voice_performance",
      event,
      at: new Date().toISOString(),
      ...data,
    }),
  );
}

function envBool(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}
