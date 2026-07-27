/**
 * Offline Voice Performance Test Suite harness.
 *
 * Simulates turn latency marks without Twilio/OpenAI/CRM.
 * Validates grading, bottleneck identification, and report generation.
 *
 * Usage: npx tsx src/voice/performance/runValidationHarness.ts
 */

import {
  VoicePerformanceSuite,
  COMMIT_TO_FIRST_AUDIO_BUDGET_MS,
  identifyBottleneck,
  classifyCall,
} from "./index";
import { VoicePerfReportWriter } from "./reportWriter";
import path from "path";

type Scenario = {
  name: string;
  expectedGrade: "Excellent" | "Good" | "Needs Improvement";
  turns: Array<{
    commitToResponseCreateMs: number;
    responseCreateToOpenAiFirstTokenMs: number;
    openAiFirstTokenToElevenLabsFirstAudioMs: number;
    elevenLabsFirstAudioToTwilioMs: number;
    playbackCompleteMs: number;
  }>;
  bargeInsMs?: number[];
  droppedPackets?: number;
  cancelledResponses?: number;
  wsReconnects?: number;
};

const SCENARIOS: Scenario[] = [
  {
    name: "excellent_low_latency",
    expectedGrade: "Excellent",
    turns: Array.from({ length: 12 }, () => ({
      commitToResponseCreateMs: 20,
      responseCreateToOpenAiFirstTokenMs: 140,
      openAiFirstTokenToElevenLabsFirstAudioMs: 90,
      elevenLabsFirstAudioToTwilioMs: 15,
      playbackCompleteMs: 1800,
    })),
    bargeInsMs: [35, 42],
  },
  {
    name: "good_within_budget",
    expectedGrade: "Good",
    turns: Array.from({ length: 10 }, () => ({
      commitToResponseCreateMs: 40,
      responseCreateToOpenAiFirstTokenMs: 320,
      openAiFirstTokenToElevenLabsFirstAudioMs: 220,
      elevenLabsFirstAudioToTwilioMs: 30,
      playbackCompleteMs: 2100,
    })),
  },
  {
    name: "needs_improvement_openai_bottleneck",
    expectedGrade: "Needs Improvement",
    turns: Array.from({ length: 8 }, () => ({
      commitToResponseCreateMs: 30,
      responseCreateToOpenAiFirstTokenMs: 950,
      openAiFirstTokenToElevenLabsFirstAudioMs: 120,
      elevenLabsFirstAudioToTwilioMs: 20,
      playbackCompleteMs: 2400,
    })),
    droppedPackets: 30,
  },
];

function feedTurn(
  suite: VoicePerformanceSuite,
  turn: number,
  sample: Scenario["turns"][number],
) {
  const committedAt = 1_000_000 + turn * 10_000;
  const responseCreateAt = committedAt + sample.commitToResponseCreateMs;
  const openAiFirstAt =
    responseCreateAt + sample.responseCreateToOpenAiFirstTokenMs;
  const elevenAt =
    openAiFirstAt + sample.openAiFirstTokenToElevenLabsFirstAudioMs;
  const twilioAt = elevenAt + sample.elevenLabsFirstAudioToTwilioMs;
  const playbackAt = twilioAt + sample.playbackCompleteMs;

  const commitToFirstAudioMs = twilioAt - committedAt;
  const stages = [
    {
      name: "commit_to_response_create",
      ms: sample.commitToResponseCreateMs,
    },
    {
      name: "response_create_to_openai_first_token",
      ms: sample.responseCreateToOpenAiFirstTokenMs,
    },
    {
      name: "openai_first_token_to_elevenlabs_first_audio",
      ms: sample.openAiFirstTokenToElevenLabsFirstAudioMs,
    },
    {
      name: "elevenlabs_first_audio_to_twilio",
      ms: sample.elevenLabsFirstAudioToTwilioMs,
    },
    {
      name: "response_create_to_first_audio_twilio",
      ms: twilioAt - responseCreateAt,
    },
    {
      name: "first_audio_to_playback_complete",
      ms: sample.playbackCompleteMs,
    },
  ];

  const slowest = stages.reduce((best, stage) =>
    stage.ms > best.ms ? stage : best,
  );

  suite.onLatencyLog("voice_latency_mark", {
    phase: "caller_speech_started",
    turn,
  });

  suite.onLatencyLog("voice_turn_latency", {
    milestone: "first_audio",
    turn,
    commitToResponseCreateMs: sample.commitToResponseCreateMs,
    responseCreateToOpenAiFirstTokenMs:
      sample.responseCreateToOpenAiFirstTokenMs,
    openAiFirstTokenToElevenLabsFirstAudioMs:
      sample.openAiFirstTokenToElevenLabsFirstAudioMs,
    responseCreateToElevenLabsFirstAudioMs:
      sample.responseCreateToOpenAiFirstTokenMs +
      sample.openAiFirstTokenToElevenLabsFirstAudioMs,
    elevenLabsFirstAudioToTwilioMs: sample.elevenLabsFirstAudioToTwilioMs,
    responseCreateToFirstAudioMs: twilioAt - responseCreateAt,
    commitToFirstAudioMs,
    totalFirstResponseLatencyMs: commitToFirstAudioMs,
    firstAudioToPlaybackCompleteMs: sample.playbackCompleteMs,
    stages,
    slowestStage: slowest.name,
    slowestStageMs: slowest.ms,
  });

  suite.onLatencyLog("voice_turn_latency", {
    milestone: "playback_complete",
    turn,
    commitToFirstAudioMs,
    firstAudioToPlaybackCompleteMs: sample.playbackCompleteMs,
    stages,
    slowestStage: slowest.name,
    slowestStageMs: slowest.ms,
  });

  // Silence unused timestamps (kept for readability of the timeline).
  void playbackAt;
}

function runScenario(scenario: Scenario) {
  const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
  const suite = new VoicePerformanceSuite({
    enabled: true,
    resourceIntervalMs: 50,
    log: (event, data) => {
      logs.push({ event, data });
    },
    reportWriter: new VoicePerfReportWriter({
      enabled: true,
      directory: path.join(process.cwd(), "voice-perf-reports", "harness"),
    }),
  });

  suite.start({
    callSid: `HARNESS_${scenario.name}`,
    conversationId: `conv_${scenario.name}`,
    streamSid: `MZ_${scenario.name}`,
    ttsProvider: "elevenlabs",
    ttsTransport: "websocket",
    model: "gpt-realtime-2.1-mini",
  });

  scenario.turns.forEach((turn, index) => feedTurn(suite, index + 1, turn));

  for (const ms of scenario.bargeInsMs || []) {
    const finish = suite.beginBargeIn("harness_barge_in");
    const start = Date.now();
    while (Date.now() - start < Math.min(ms, 5)) {
      // busy-wait briefly so clearLatencyMs is measurable in harness
    }
    finish();
  }

  for (let i = 0; i < (scenario.droppedPackets || 0); i += 1) {
    suite.recordDroppedAudioPacket("harness");
  }
  for (let i = 0; i < (scenario.cancelledResponses || 0); i += 1) {
    suite.recordCancelledResponse("harness");
  }
  for (let i = 0; i < (scenario.wsReconnects || 0); i += 1) {
    suite.recordWebSocketReconnect("elevenlabs", "harness");
  }

  // Emit buffer depth samples
  for (let i = 1; i <= 5; i += 1) {
    suite.recordMediaFrameSent({
      framesInFlight: i * 3,
      estimatedBufferMs: i * 3 * 20,
    });
  }

  // Allow resource monitor to take at least one sample.
  const started = Date.now();
  while (Date.now() - started < 80) {
    // wait
  }

  const report = suite.finalize(`harness_${scenario.name}`);
  if (!report) {
    throw new Error(`No report for scenario ${scenario.name}`);
  }

  const summaryLog = logs.find((l) => l.event === "voice_performance_summary");
  if (!summaryLog) {
    throw new Error(`Missing voice_performance_summary for ${scenario.name}`);
  }

  if (report.grade !== scenario.expectedGrade) {
    throw new Error(
      `${scenario.name}: expected grade ${scenario.expectedGrade}, got ${report.grade} (${report.gradeReasons.join("; ")})`,
    );
  }

  const avg = report.metrics.commitToFirstTwilioAudioMs.avgMs;
  if (avg === null) {
    throw new Error(`${scenario.name}: missing avg commit→first Twilio audio`);
  }

  if (avg > COMMIT_TO_FIRST_AUDIO_BUDGET_MS) {
    if (report.bottleneckTurns.length === 0) {
      throw new Error(
        `${scenario.name}: expected bottleneck identification when avg ${avg}ms > ${COMMIT_TO_FIRST_AUDIO_BUDGET_MS}ms`,
      );
    }
    const bottleneck = report.bottleneckTurns[0].bottleneck;
    if (!bottleneck.slowestCriticalStage) {
      throw new Error(`${scenario.name}: bottleneck missing slowestCriticalStage`);
    }
  }

  return report;
}

function unitChecks() {
  const bottleneck = identifyBottleneck(1200, [
    { name: "commit_to_response_create", ms: 20 },
    { name: "response_create_to_openai_first_token", ms: 900 },
    { name: "elevenlabs_first_audio_to_twilio", ms: 10 },
  ]);
  if (!bottleneck || bottleneck.slowestCriticalStage !== "response_create_to_openai_first_token") {
    throw new Error("identifyBottleneck failed to flag OpenAI first-token stage");
  }

  const underBudget = identifyBottleneck(400, [
    { name: "response_create_to_openai_first_token", ms: 200 },
  ]);
  if (underBudget) {
    throw new Error("identifyBottleneck should not fire under 800ms");
  }

  const excellent = classifyCall({
    avgCommitToFirstAudioMs: 350,
    p95CommitToFirstAudioMs: 420,
    avgBargeInMs: 40,
    droppedAudioPackets: 0,
    cancelledResponses: 0,
    webSocketReconnects: 0,
    avgEventLoopLagMs: 5,
    peakRssMb: 200,
    bottleneckTurnCount: 0,
    firstAudioTurnCount: 10,
  });
  if (excellent.grade !== "Excellent") {
    throw new Error(`Expected Excellent, got ${excellent.grade}`);
  }
}

function main() {
  console.log(
    JSON.stringify({
      scope: "voice_performance",
      event: "harness_started",
      at: new Date().toISOString(),
      scenarios: SCENARIOS.map((s) => s.name),
    }),
  );

  unitChecks();

  const reports = SCENARIOS.map((scenario) => {
    const report = runScenario(scenario);
    console.log(
      JSON.stringify({
        scope: "voice_performance",
        event: "harness_scenario_passed",
        at: new Date().toISOString(),
        scenario: scenario.name,
        grade: report.grade,
        avgCommitToFirstTwilioAudioMs:
          report.metrics.commitToFirstTwilioAudioMs.avgMs,
        slowestStageOverall: report.slowestStageOverall?.name,
        bottleneckTurnCount: report.bottleneckTurns.length,
      }),
    );
    return report;
  });

  console.log(
    JSON.stringify({
      scope: "voice_performance",
      event: "harness_completed",
      at: new Date().toISOString(),
      passed: reports.length,
      grades: reports.map((r) => r.grade),
    }),
  );
}

main();
