import type { PostCallAnalysisView } from "../lib/postCallAnalysis";

export type CallStatus =
  | "RINGING"
  | "IN_PROGRESS"
  | "LIVE"
  | "COMPLETED"
  | "NO_ANSWER"
  | "BUSY"
  | "CANCELED"
  | "FAILED"
  | "MISSED"
  | "TRANSFERRED";

export type ConversationStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "FOLLOW_UP"
  | "CONVERTED"
  | "HUMAN_REQUIRED"
  | "LOST";

export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type BookingStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

export type BookingAcceptanceStatus =
  | "PENDING_ACCEPTANCE"
  | "ACCEPTED"
  | "DECLINED";

export type BookingOutcome = "PENDING" | "WON" | "LOST" | "FOLLOW_UP";

export type CustomerRef = {
  id: string;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  businessType?: string | null;
  requirementSummary?: string | null;
  notes?: string | null;
};

export type TeamUserRef = {
  id: string;
  name: string;
  email: string;
};

export type HumeTopExpression = {
  name: string;
  score: number;
};

export type HumeExpressionAnalysis = {
  id?: string;
  status?: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | string | null;
  userTurnCount?: number | null;
  averageScores?: Record<string, number> | null;
  topExpressions?: HumeTopExpression[] | null;
  insightSummary?: string | null;
  failureReason?: string | null;
  completedAt?: string | null;
};

export type CallPostAnalysis = PostCallAnalysisView;

export type CallRecord = {
  id: string;
  conversationId: string;
  phone?: string | null;
  durationSeconds?: number | null;
  transcript?: string | null;
  status: CallStatus | string;
  provider?: string | null;
  providerCallId?: string | null;
  direction?: string | null;
  purpose?: string | null;
  summary?: string | null;
  nextAction?: string | null;
  assignedUserId?: string | null;
  assignedUser?: TeamUserRef | null;
  recordingUrl?: string | null;
  recordingMediaUrl?: string | null;
  recordingSid?: string | null;
  recordingStatus?: string | null;
  recordingDurationSeconds?: number | null;
  recordingChannels?: number | null;
  recordingSource?: string | null;
  recordingAvailableAt?: string | null;
  recordingReconstructionStatus?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  failureReason?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt?: string;
  computedTranscript?: string | null;
  postCallAnalysis?: CallPostAnalysis | null;
  humeExpressionAnalysis?: HumeExpressionAnalysis | null;
  conversation?: {
    id?: string;
    customer?: CustomerRef | null;
    aiSummary?: string | null;
    nextAction?: string | null;
  } | null;
};

export type CallBookingRef = {
  id: string;
  title: string;
  status: BookingStatus | string;
  acceptanceStatus?: BookingAcceptanceStatus | string | null;
  dateTime?: string | null;
  timezone?: string | null;
  assignedUserId?: string | null;
  assignedUser?: TeamUserRef | null;
  createdAt: string;
};

export type CallConversation = {
  id: string;
  channel: "AI_CALL" | string;
  status: ConversationStatus | string;
  priority: Priority | string;
  intent?: string | null;
  aiSummary?: string | null;
  nextAction?: string | null;
  aiConfidence?: number | null;
  humanNeeded?: boolean;
  bookingCreated?: boolean;
  provider?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  createdAt: string;
  updatedAt: string;
  computedTranscript?: string | null;
  latestCall?: CallRecord | null;
  latestCallAnalysis?: CallPostAnalysis | null;
  customer?: CustomerRef | null;
  calls: CallRecord[];
  messages?: Array<{
    id: string;
    senderType: "CUSTOMER" | "AI" | "HUMAN" | string;
    body: string;
    createdAt: string;
  }>;
  tasks?: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    description?: string | null;
    dueAt?: string | null;
    createdAt: string;
  }>;
  bookings?: CallBookingRef[];
  outboundMessages?: Array<{
    id: string;
    channel: string;
    toPhone: string;
    body: string;
    status: string;
    createdAt: string;
  }>;
  _count?: {
    messages: number;
    tasks: number;
    calls: number;
    bookings: number;
  };
};

export type BookingRecord = {
  id: string;
  companyId: string;
  customerId?: string | null;
  conversationId?: string | null;
  callId?: string | null;
  title: string;
  dateTime?: string | null;
  timezone?: string | null;
  purpose?: string | null;
  status: BookingStatus | string;
  acceptanceStatus?: BookingAcceptanceStatus | string | null;
  outcome?: BookingOutcome | string | null;
  assignedUserId?: string | null;
  assignedUser?: TeamUserRef | null;
  acceptedByUserId?: string | null;
  acceptedBy?: TeamUserRef | null;
  acceptedAt?: string | null;
  notes?: string | null;
  proposalSent?: boolean | null;
  proposalSentAt?: string | null;
  nextAction?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  customer?: CustomerRef | null;
  call?: {
    id: string;
    status?: string | null;
    direction?: string | null;
    createdAt?: string;
    transcript?: string | null;
    recordingUrl?: string | null;
    recordingSid?: string | null;
    recordingMediaUrl?: string | null;
  } | null;
  conversation?: {
    id: string;
    channel?: string;
    status?: string;
    priority?: string;
    intent?: string | null;
    aiSummary?: string | null;
    nextAction?: string | null;
    lastMessage?: string | null;
    customer?: CustomerRef | null;
    messages?: Array<{
      id: string;
      senderType: string;
      body: string;
      createdAt: string;
    }>;
    tasks?: Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      createdAt: string;
    }>;
  } | null;
  latestCall?: CallRecord | null;
  recordingMediaUrl?: string | null;
  computedTranscript?: string | null;
};

export function formatEnum(value?: string | null) {
  if (!value) return "-";
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatDateTime(value?: string | null, timeZone?: string | null) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return new Date(value).toLocaleString("en-IN");
  }
}

export function formatDuration(seconds?: number | null) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function formatRelative(value?: string | null) {
  if (!value) return "-";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function bookingLifecycleLabel(
  status?: string | null,
  acceptanceStatus?: string | null,
  outcome?: string | null,
) {
  if (status === "CANCELLED") return "Cancelled";
  if (status === "COMPLETED") {
    if (outcome === "WON") return "Completed · Won";
    if (outcome === "LOST") return "Completed · Lost";
    if (outcome === "FOLLOW_UP") return "Completed · Follow-up";
    return "Completed";
  }
  if (status === "NO_SHOW") return "No show";
  if (acceptanceStatus === "PENDING_ACCEPTANCE") return "Pending acceptance";
  if (acceptanceStatus === "ACCEPTED") return "Accepted";
  if (status === "CONFIRMED") return "Scheduled / upcoming";
  if (status === "REQUESTED") return "Requested";
  return formatEnum(status);
}

export function isUpcomingBooking(booking: {
  status?: string | null;
  dateTime?: string | null;
}) {
  if (booking.status === "CANCELLED" || booking.status === "COMPLETED" || booking.status === "NO_SHOW") {
    return false;
  }
  if (!booking.dateTime) return true;
  return new Date(booking.dateTime).getTime() >= Date.now();
}
