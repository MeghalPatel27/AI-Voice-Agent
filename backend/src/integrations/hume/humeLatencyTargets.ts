/** Target latency settings for the live non-production Hume config. */
export const HUME_LATENCY_TARGETS = {
  endOfTurnSilenceMs: 500,
  prefixPaddingMs: 300,
  /** Tuned after Hello?-stall with no USER_MESSAGE; tradeoff: more noise activations. */
  speechDetectionThreshold: 0.45,
  minInterruptionMs: 300,
  /** Hume API minimum inactivity timeout is 30s (12–15s not supported). */
  inactivityTimeoutSecs: 30,
  inactivityMessage: "Hello, are you still there?",
  onNewChatText: "Hello?",
} as const;
