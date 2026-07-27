export type RecordingUiState =
  | "available"
  | "preparing"
  | "unavailable"
  | "failed"
  | "legacy"
  | "hume";

export function resolveRecordingUiState(call?: {
  recordingMediaUrl?: string | null;
  recordingUrl?: string | null;
  recordingSid?: string | null;
  recordingStatus?: string | null;
  recordingSource?: string | null;
  recordingReconstructionStatus?: string | null;
  failureReason?: string | null;
} | null): RecordingUiState {
  if (!call) return "unavailable";

  const status = (call.recordingStatus || "").toUpperCase();
  const reconstruction = (call.recordingReconstructionStatus || "").toUpperCase();
  const source = (call.recordingSource || "").toUpperCase();

  if (
    status === "ERROR" ||
    reconstruction === "ERROR" ||
    call.failureReason?.toLowerCase().includes("recording")
  ) {
    return "failed";
  }

  if (
    status === "QUEUED" ||
    status === "IN_PROGRESS" ||
    reconstruction === "QUEUED" ||
    reconstruction === "IN_PROGRESS"
  ) {
    return "preparing";
  }

  if (call.recordingMediaUrl || call.recordingUrl || call.recordingSid) {
    if (source.includes("HUME") || reconstruction === "COMPLETE") return "hume";
    if (source.includes("TWILIO") || call.recordingSid) return "legacy";
    return "available";
  }

  return "unavailable";
}
