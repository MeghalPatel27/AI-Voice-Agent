/**
 * Adaptive end-of-turn detection for natural conversation.
 *
 * Short confirmations ("Yes.") commit quickly.
 * Longer utterances wait longer so mid-sentence pauses are not cut off.
 */

import { VOICE_ENGINE_CONFIG } from "./config";

export type AdaptiveVadInput = {
  speechMs: number;
  silenceMs: number;
  speechFrameCount: number;
  totalFrameCount: number;
  /** Optional: recent peak energy trend; reserved for future tuning */
  recentPeak?: number;
};

export type AdaptiveVadDecision = {
  shouldCommit: boolean;
  endSilenceMs: number;
  reason: "short" | "medium" | "long" | "max_turn" | "none";
};

/**
 * Choose an end-silence timeout based on how long / how confidently
 * the caller has been speaking.
 */
export function resolveAdaptiveEndSilenceMs(input: {
  speechMs: number;
  speechFrameCount: number;
}): number {
  const {
    localVadShortSilenceMs,
    localVadMediumSilenceMs,
    localVadLongSilenceMs,
    localVadShortSpeechMs,
    localVadLongSpeechMs,
    localVadEndSilenceMs,
  } = VOICE_ENGINE_CONFIG;

  const { speechMs, speechFrameCount } = input;

  // Very short utterance (e.g. "Yes.", "Okay.") — respond almost immediately.
  if (speechMs <= localVadShortSpeechMs && speechFrameCount <= 18) {
    return localVadShortSilenceMs;
  }

  // Long / narrative turn — wait for a clearer pause.
  if (speechMs >= localVadLongSpeechMs || speechFrameCount >= 60) {
    return localVadLongSilenceMs;
  }

  // Default medium band around the Phase 1 baseline.
  return localVadMediumSilenceMs || localVadEndSilenceMs;
}

export function evaluateAdaptiveTurn(input: AdaptiveVadInput): AdaptiveVadDecision {
  const {
    localVadMinSpeechMs,
    localVadMaxTurnMs,
  } = VOICE_ENGINE_CONFIG;

  const endSilenceMs = resolveAdaptiveEndSilenceMs({
    speechMs: input.speechMs,
    speechFrameCount: input.speechFrameCount,
  });

  if (input.speechMs >= localVadMaxTurnMs) {
    return {
      shouldCommit: true,
      endSilenceMs,
      reason: "max_turn",
    };
  }

  if (
    input.silenceMs >= endSilenceMs &&
    input.speechMs >= localVadMinSpeechMs
  ) {
    const reason =
      endSilenceMs <= VOICE_ENGINE_CONFIG.localVadShortSilenceMs
        ? "short"
        : endSilenceMs >= VOICE_ENGINE_CONFIG.localVadLongSilenceMs
          ? "long"
          : "medium";

    return {
      shouldCommit: true,
      endSilenceMs,
      reason,
    };
  }

  return {
    shouldCommit: false,
    endSilenceMs,
    reason: "none",
  };
}

/**
 * Timer backup delay: adaptive silence + small slack.
 */
export function adaptiveVadTimerDelayMs(input: {
  speechMs: number;
  speechFrameCount: number;
}) {
  return resolveAdaptiveEndSilenceMs(input) + 80;
}
