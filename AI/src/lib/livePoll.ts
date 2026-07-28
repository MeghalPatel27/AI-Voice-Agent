import { useEffect, useRef } from "react";

/**
 * Bounded polling while active records exist.
 * Stops automatically when `enabled` becomes false (e.g. all tasks/calls terminal).
 */
export function useBoundedLivePoll(
  enabled: boolean,
  onTick: () => void | Promise<void>,
  intervalMs = 4000,
) {
  const onTickRef = useRef(onTick);

  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    if (!enabled) return;

    const timer = window.setInterval(() => {
      void onTickRef.current();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
}

export function isActiveTaskStatus(status?: string | null) {
  return status === "DOING";
}

export function isActiveScheduledCallNotesStatus(status?: string | null) {
  const value = String(status || "").toUpperCase();
  return ["CALLING", "RINGING", "IN_PROGRESS", "CONNECTED", "ENDING"].includes(
    value,
  );
}
