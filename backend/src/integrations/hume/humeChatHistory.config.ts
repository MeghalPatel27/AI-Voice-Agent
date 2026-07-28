function envInt(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

export function getHumeChatHistoryConfig() {
  return {
    reconcileLookbackDays: envInt("HUME_CHAT_RECONCILE_LOOKBACK_DAYS", 30, 1, 90),
    matchTimeWindowSeconds: envInt("HUME_CHAT_MATCH_TIME_WINDOW_SECONDS", 7200, 60, 86400),
    syncPageSize: envInt("HUME_CHAT_SYNC_PAGE_SIZE", 100, 10, 200),
    syncMaxPages: envInt("HUME_CHAT_SYNC_MAX_PAGES", 50, 1, 200),
    audioPollMaxAttempts: envInt("HUME_AUDIO_POLL_MAX_ATTEMPTS", 12, 1, 60),
    audioPollBaseMs: envInt("HUME_AUDIO_POLL_BASE_MS", 5000, 1000, 60000),
    requestTimeoutMs: envInt("HUME_CHAT_HISTORY_TIMEOUT_MS", 30000, 5000, 120000),
    maxRetries: envInt("HUME_CHAT_HISTORY_MAX_RETRIES", 3, 0, 10),
  };
}
