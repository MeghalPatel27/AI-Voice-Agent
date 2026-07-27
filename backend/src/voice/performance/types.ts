import type { CallPerformanceGrade } from "./thresholds";

export type TurnLatencySample = {
  turn: number;
  at: string;
  milestone: "first_audio" | "playback_complete";
  commitToFirstAudioMs?: number;
  commitToOpenAiFirstDeltaMs?: number;
  commitToElevenLabsFirstByteMs?: number;
  commitToFirstTwilioAudioMs?: number;
  endToEndFirstAudioMs?: number;
  playbackCompletionMs?: number;
  stages: Array<{ name: string; ms: number }>;
  slowestStage?: string;
  slowestStageMs?: number;
  bottleneck?: BottleneckReport;
};

export type BottleneckReport = {
  exceedsBudget: true;
  budgetMs: number;
  observedMs: number;
  slowestCriticalStage?: string;
  slowestCriticalStageMs?: number;
  recommendation: string;
};

export type BargeInSample = {
  at: string;
  reason?: string;
  clearLatencyMs: number;
  fullResponseMs?: number;
};

export type ResourceSample = {
  at: string;
  elapsedMs: number;
  cpuPercent: number;
  rssMb: number;
  heapUsedMb: number;
  externalMb: number;
  eventLoopLagMs: number;
};

export type PlaybackBufferSample = {
  at: string;
  framesInFlight: number;
  estimatedBufferMs: number;
};

export type VoicePerfCounters = {
  droppedAudioPackets: number;
  cancelledResponses: number;
  webSocketReconnects: number;
  mediaFramesSent: number;
  inboundMediaFrames: number;
  bargeInCount: number;
  turnCount: number;
  firstAudioTurnCount: number;
  playbackCompleteTurnCount: number;
};

export type StageAggregate = {
  name: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
};

export type VoiceCallPerformanceReport = {
  scope: "voice_performance";
  event: "call_performance_summary";
  at: string;
  callSid?: string;
  conversationId?: string;
  streamSid?: string;
  ttsProvider?: string;
  ttsTransport?: string;
  model?: string;

  callDurationMs: number;
  grade: CallPerformanceGrade;
  gradeReasons: string[];

  /** Metrics 1–5 + aggregates for 6–8 */
  metrics: {
    commitToOpenAiFirstDeltaMs: MetricSummary;
    commitToElevenLabsFirstByteMs: MetricSummary;
    commitToFirstTwilioAudioMs: MetricSummary;
    endToEndFirstAudioLatencyMs: MetricSummary;
    playbackCompletionMs: MetricSummary;
    avgLatencyAcross10MinuteCallMs: number | null;
    avgLatencyAcross100TurnsMs: number | null;
    bargeInResponseMs: MetricSummary;
    droppedAudioPackets: number;
    cancelledResponses: number;
    webSocketReconnects: number;
    twilioPlaybackBufferDepth: {
      peakFrames: number;
      peakEstimatedMs: number;
      avgEstimatedMs: number;
      samples: number;
    };
    cpuUsageDuringActiveCall: {
      avgPercent: number;
      peakPercent: number;
      samples: number;
    };
    memoryUsageOverConversation: {
      startRssMb: number;
      endRssMb: number;
      peakRssMb: number;
      peakHeapUsedMb: number;
      deltaRssMb: number;
      samples: number;
    };
    eventLoopBlocking: {
      avgLagMs: number;
      peakLagMs: number;
      blockedSampleCount: number;
      blockThresholdMs: number;
      samples: number;
    };
  };

  slowestStageOverall?: StageAggregate;
  stageAggregates: StageAggregate[];
  bottleneckTurns: Array<{
    turn: number;
    commitToFirstAudioMs: number;
    bottleneck: BottleneckReport;
  }>;

  turnSamples: TurnLatencySample[];
  bargeInSamples: BargeInSample[];
  counters: VoicePerfCounters;
};

export type MetricSummary = {
  count: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
  valuesMs: number[];
};
