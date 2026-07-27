import {
  COMMIT_TO_FIRST_AUDIO_BUDGET_MS,
  CRITICAL_PATH_STAGES,
  CRITICAL_PATH_LEAF_STAGES,
  GRADE_THRESHOLDS,
  type CallPerformanceGrade,
} from "./thresholds";
import type {
  BottleneckReport,
  MetricSummary,
  StageAggregate,
  TurnLatencySample,
} from "./types";

export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const weight = idx - lo;
  return sortedAsc[lo] * (1 - weight) + sortedAsc[hi] * weight;
}

export function summarizeMs(values: number[]): MetricSummary {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (clean.length === 0) {
    return {
      count: 0,
      avgMs: null,
      p50Ms: null,
      p95Ms: null,
      minMs: null,
      maxMs: null,
      valuesMs: [],
    };
  }

  const sorted = [...clean].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  return {
    count: sorted.length,
    avgMs: round1(sum / sorted.length),
    p50Ms: round1(percentile(sorted, 0.5)!),
    p95Ms: round1(percentile(sorted, 0.95)!),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    valuesMs: sorted,
  };
}

export function identifyBottleneck(
  commitToFirstAudioMs: number | undefined,
  stages: Array<{ name: string; ms: number }>,
): BottleneckReport | undefined {
  if (
    commitToFirstAudioMs === undefined ||
    !Number.isFinite(commitToFirstAudioMs) ||
    commitToFirstAudioMs <= COMMIT_TO_FIRST_AUDIO_BUDGET_MS
  ) {
    return undefined;
  }

  const leaf = stages.filter((s) =>
    (CRITICAL_PATH_LEAF_STAGES as readonly string[]).includes(s.name),
  );
  const critical =
    leaf.length > 0
      ? leaf
      : stages.filter((s) =>
          (CRITICAL_PATH_STAGES as readonly string[]).includes(s.name),
        );
  const pool = critical.length > 0 ? critical : stages;
  const slowest = pool.reduce<{ name: string; ms: number } | undefined>(
    (best, stage) => (!best || stage.ms > best.ms ? stage : best),
    undefined,
  );

  return {
    exceedsBudget: true,
    budgetMs: COMMIT_TO_FIRST_AUDIO_BUDGET_MS,
    observedMs: commitToFirstAudioMs,
    slowestCriticalStage: slowest?.name,
    slowestCriticalStageMs: slowest?.ms,
    recommendation: bottleneckRecommendation(slowest?.name),
  };
}

function bottleneckRecommendation(stageName?: string): string {
  switch (stageName) {
    case "commit_to_response_create":
      return "Local commit → response.create is slow; inspect VAD commit delay and OpenAI socket readiness.";
    case "response_create_to_openai_first_token":
      return "OpenAI first delta is the bottleneck; check Realtime model load, network RTT, and session config.";
    case "openai_first_token_to_elevenlabs_first_audio":
    case "response_create_to_elevenlabs_first_audio":
      return "ElevenLabs first byte is the bottleneck; verify WS warm connection, chunk schedule, and TTS model.";
    case "elevenlabs_first_audio_to_twilio":
      return "Audio reached TTS but Twilio send lagged; inspect PlaybackManager / Twilio Media Stream health.";
    case "response_create_to_first_audio_twilio":
      return "End-to-end synthesis path is slow; compare OpenAI vs ElevenLabs stage marks for this turn.";
    default:
      return "commit→first-audio exceeded 800ms; inspect slowestStage on this turn before changing code.";
  }
}

export function aggregateStages(
  turns: TurnLatencySample[],
): StageAggregate[] {
  const map = new Map<string, StageAggregate>();

  for (const turn of turns) {
    for (const stage of turn.stages) {
      const existing = map.get(stage.name);
      if (!existing) {
        map.set(stage.name, {
          name: stage.name,
          count: 1,
          totalMs: stage.ms,
          avgMs: stage.ms,
          maxMs: stage.ms,
        });
        continue;
      }
      existing.count += 1;
      existing.totalMs += stage.ms;
      existing.avgMs = existing.totalMs / existing.count;
      existing.maxMs = Math.max(existing.maxMs, stage.ms);
    }
  }

  return [...map.values()]
    .map((s) => ({
      ...s,
      avgMs: round1(s.avgMs),
      maxMs: round1(s.maxMs),
      totalMs: round1(s.totalMs),
    }))
    .sort((a, b) => b.avgMs - a.avgMs);
}

/** Prefer commit→first-audio leaf stages when highlighting the slowest stage. */
export function pickHighlightedSlowestStage(
  aggregates: StageAggregate[],
): StageAggregate | undefined {
  const leaf = aggregates.filter((s) =>
    (CRITICAL_PATH_LEAF_STAGES as readonly string[]).includes(s.name),
  );
  if (leaf.length > 0) {
    return leaf.reduce((best, stage) =>
      stage.avgMs > best.avgMs ? stage : best,
    );
  }
  const critical = aggregates.filter((s) =>
    (CRITICAL_PATH_STAGES as readonly string[]).includes(s.name),
  );
  if (critical.length > 0) {
    return critical.reduce((best, stage) =>
      stage.avgMs > best.avgMs ? stage : best,
    );
  }
  return aggregates[0];
}

export function classifyCall(input: {
  avgCommitToFirstAudioMs: number | null;
  p95CommitToFirstAudioMs: number | null;
  avgBargeInMs: number | null;
  droppedAudioPackets: number;
  cancelledResponses: number;
  webSocketReconnects: number;
  avgEventLoopLagMs: number;
  peakRssMb: number;
  bottleneckTurnCount: number;
  firstAudioTurnCount: number;
}): { grade: CallPerformanceGrade; reasons: string[] } {
  const reasons: string[] = [];
  let grade: CallPerformanceGrade = "Excellent";

  const degrade = (next: CallPerformanceGrade, reason: string) => {
    reasons.push(reason);
    if (next === "Needs Improvement") {
      grade = "Needs Improvement";
    } else if (grade === "Excellent" && next === "Good") {
      grade = "Good";
    }
  };

  const avg = input.avgCommitToFirstAudioMs;
  if (avg !== null) {
    if (avg > GRADE_THRESHOLDS.avgCommitToFirstAudioMs.good) {
      degrade(
        "Needs Improvement",
        `avg commit→first-audio ${avg}ms > ${GRADE_THRESHOLDS.avgCommitToFirstAudioMs.good}ms`,
      );
    } else if (avg > GRADE_THRESHOLDS.avgCommitToFirstAudioMs.excellent) {
      degrade(
        "Good",
        `avg commit→first-audio ${avg}ms within budget but above Excellent (${GRADE_THRESHOLDS.avgCommitToFirstAudioMs.excellent}ms)`,
      );
    }
  } else if (input.firstAudioTurnCount === 0) {
    degrade("Needs Improvement", "no first-audio latency samples collected");
  }

  const p95 = input.p95CommitToFirstAudioMs;
  if (p95 !== null && p95 > GRADE_THRESHOLDS.p95CommitToFirstAudioMs.good) {
    degrade(
      "Needs Improvement",
      `p95 commit→first-audio ${p95}ms > ${GRADE_THRESHOLDS.p95CommitToFirstAudioMs.good}ms`,
    );
  } else if (
    p95 !== null &&
    p95 > GRADE_THRESHOLDS.p95CommitToFirstAudioMs.excellent
  ) {
    degrade(
      "Good",
      `p95 commit→first-audio ${p95}ms above Excellent (${GRADE_THRESHOLDS.p95CommitToFirstAudioMs.excellent}ms)`,
    );
  }

  if (
    input.avgBargeInMs !== null &&
    input.avgBargeInMs > GRADE_THRESHOLDS.avgBargeInResponseMs.good
  ) {
    degrade(
      "Needs Improvement",
      `avg barge-in response ${input.avgBargeInMs}ms > ${GRADE_THRESHOLDS.avgBargeInResponseMs.good}ms`,
    );
  } else if (
    input.avgBargeInMs !== null &&
    input.avgBargeInMs > GRADE_THRESHOLDS.avgBargeInResponseMs.excellent
  ) {
    degrade(
      "Good",
      `avg barge-in response ${input.avgBargeInMs}ms above Excellent (${GRADE_THRESHOLDS.avgBargeInResponseMs.excellent}ms)`,
    );
  }

  if (input.droppedAudioPackets > GRADE_THRESHOLDS.maxDroppedAudioPackets) {
    degrade(
      "Needs Improvement",
      `dropped audio packets ${input.droppedAudioPackets} > ${GRADE_THRESHOLDS.maxDroppedAudioPackets}`,
    );
  }

  if (input.webSocketReconnects > GRADE_THRESHOLDS.maxWebSocketReconnects) {
    degrade(
      "Needs Improvement",
      `WebSocket reconnects/recoveries ${input.webSocketReconnects} > ${GRADE_THRESHOLDS.maxWebSocketReconnects}`,
    );
  }

  if (input.avgEventLoopLagMs > GRADE_THRESHOLDS.maxAvgEventLoopLagMs) {
    degrade(
      "Needs Improvement",
      `avg event-loop lag ${input.avgEventLoopLagMs}ms > ${GRADE_THRESHOLDS.maxAvgEventLoopLagMs}ms`,
    );
  }

  if (input.peakRssMb > GRADE_THRESHOLDS.maxPeakRssMb) {
    degrade(
      "Good",
      `peak RSS ${input.peakRssMb}MB exceeds soft cap ${GRADE_THRESHOLDS.maxPeakRssMb}MB`,
    );
  }

  if (input.bottleneckTurnCount > 0) {
    degrade(
      input.bottleneckTurnCount >= 3 ? "Needs Improvement" : "Good",
      `${input.bottleneckTurnCount} turn(s) exceeded ${COMMIT_TO_FIRST_AUDIO_BUDGET_MS}ms commit→first-audio`,
    );
  }

  if (reasons.length === 0) {
    reasons.push("all measured voice latency and health metrics within Excellent band");
  }

  return { grade, reasons };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
