/**
 * Production validation thresholds for the realtime voice engine.
 * Classification is measurement-only — never used to change call behaviour.
 */

export type CallPerformanceGrade = "Excellent" | "Good" | "Needs Improvement";

/** Primary UX metric: silence commit → first audio byte to Twilio. */
export const COMMIT_TO_FIRST_AUDIO_BUDGET_MS = 800;

export const GRADE_THRESHOLDS = {
  /**
   * Average commit → first Twilio audio across completed turns.
   * Excellent ≤ 450ms, Good ≤ 800ms, else Needs Improvement.
   */
  avgCommitToFirstAudioMs: {
    excellent: 450,
    good: COMMIT_TO_FIRST_AUDIO_BUDGET_MS,
  },
  /** p95 commit → first audio (when enough turns exist). */
  p95CommitToFirstAudioMs: {
    excellent: 600,
    good: 1000,
  },
  /** Mean barge-in clear time (detection → Twilio clear). */
  avgBargeInResponseMs: {
    excellent: 80,
    good: 200,
  },
  /** Event-loop lag samples that exceed this are counted as blocked. */
  eventLoopBlockThresholdMs: 50,
  /** Soft caps that push a call toward Needs Improvement when exceeded. */
  maxDroppedAudioPackets: 25,
  maxCancelledResponsesSoft: 40,
  maxWebSocketReconnects: 2,
  maxAvgEventLoopLagMs: 40,
  maxPeakRssMb: 768,
} as const;

/** Stages on the commit → first-audio critical path (for bottleneck ID). */
export const CRITICAL_PATH_STAGES = [
  "commit_to_response_create",
  "response_create_to_openai_first_token",
  "openai_first_token_to_elevenlabs_first_audio",
  "response_create_to_elevenlabs_first_audio",
  "elevenlabs_first_audio_to_twilio",
  "response_create_to_first_audio_twilio",
] as const;

/**
 * Leaf stages only — exclude composites that sum multiple hops,
 * so "slowest stage" highlights a real bottleneck.
 */
export const CRITICAL_PATH_LEAF_STAGES = [
  "commit_to_response_create",
  "response_create_to_openai_first_token",
  "openai_first_token_to_elevenlabs_first_audio",
  "elevenlabs_first_audio_to_twilio",
] as const;
