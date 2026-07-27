import { serializePostCallAnalysis } from "./callFinalization.service";

export function withPostCallAnalysis<T extends { id: string; postAnalysis?: any }>(
  call: T,
) {
  const { postAnalysis, ...rest } = call as T & { postAnalysis?: any };
  return {
    ...rest,
    postCallAnalysis: serializePostCallAnalysis(postAnalysis || null),
  };
}

export function pickLatestCompletedCallAnalysis(
  calls: Array<{ id: string; createdAt?: Date; postAnalysis?: any }>,
) {
  const analyzed = calls
    .filter((call) => call.postAnalysis?.status === "COMPLETED")
    .sort((a, b) => {
      const aTime = a.postAnalysis?.completedAt
        ? new Date(a.postAnalysis.completedAt).getTime()
        : a.createdAt
          ? new Date(a.createdAt).getTime()
          : 0;
      const bTime = b.postAnalysis?.completedAt
        ? new Date(b.postAnalysis.completedAt).getTime()
        : b.createdAt
          ? new Date(b.createdAt).getTime()
          : 0;
      return bTime - aTime;
    });

  const latest = analyzed[0];
  if (!latest?.postAnalysis) {
    // Fall back to newest call's analysis state (pending/failed/etc.)
    const newest = [...calls].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    })[0];

    return serializePostCallAnalysis(newest?.postAnalysis || null, {
      isLatestCallAnalysis: true,
    });
  }

  return serializePostCallAnalysis(latest.postAnalysis, {
    isLatestCallAnalysis: true,
  });
}
