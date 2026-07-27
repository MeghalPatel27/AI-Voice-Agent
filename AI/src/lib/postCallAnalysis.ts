export type PostCallAnalysisView = {
  analysisStatus:
    | "NONE"
    | "PENDING"
    | "PROCESSING"
    | "COMPLETED"
    | "FAILED"
    | "INSUFFICIENT_DATA";
  intentLevel?: string | null;
  intentScore?: number | null;
  confidence?: number | null;
  requirementSummary?: string | null;
  requirementDetails?: {
    primaryNeed?: string | null;
    businessProblem?: string | null;
    desiredCapabilities?: string[];
    integrationNeeds?: string[];
    currentSolution?: string | null;
    timelineSignal?: string | null;
    budgetSignal?: string | null;
    decisionStage?: string | null;
    objections?: string[];
    requestedNextStep?: string | null;
  } | null;
  evidenceSignals?: string[] | null;
  completedAt?: string | null;
  failureCode?: string | null;
  callId?: string | null;
  isLatestCallAnalysis?: boolean;
};

export function isLiveCallStatus(status?: string | null) {
  return status === "LIVE" || status === "IN_PROGRESS" || status === "RINGING";
}

export function intentLevelLabel(level?: string | null) {
  switch (level) {
    case "VERY_HIGH":
      return "Very high interest";
    case "HIGH":
      return "High interest";
    case "MEDIUM":
      return "Medium interest";
    case "LOW":
      return "Low interest";
    case "NOT_INTERESTED":
      return "Not interested";
    case "UNKNOWN":
      return "Intent unclear";
    default:
      return "Intent unclear";
  }
}

export function analysisStatusLabel(status?: string | null) {
  switch (status) {
    case "PENDING":
      return "Pending analysis";
    case "PROCESSING":
      return "Analyzing call";
    case "COMPLETED":
      return "Analysis complete";
    case "INSUFFICIENT_DATA":
      return "Insufficient conversation data";
    case "FAILED":
      return "Analysis unavailable";
    default:
      return "No analysis yet";
  }
}

export function intentTone(level?: string | null): "success" | "warning" | "danger" | "muted" | "normal" {
  switch (level) {
    case "VERY_HIGH":
    case "HIGH":
      return "success";
    case "MEDIUM":
      return "warning";
    case "LOW":
    case "NOT_INTERESTED":
      return "danger";
    default:
      return "muted";
  }
}
