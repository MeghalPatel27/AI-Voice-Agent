import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Headphones,
  Inbox,
  Loader2,
  MessageCircle,
  Mic2,
  Phone,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { API_BASE_URL, apiFetch } from "./lib/api";
import {
  isLiveCallStatus,
  type PostCallAnalysisView,
} from "./lib/postCallAnalysis";

type InboxFilter =
  | "ALL"
  | "NEEDS_HUMAN"
  | "HOT"
  | "MISSED"
  | "FOLLOW_UP"
  | "AI_HANDLING"
  | "RESOLVED";

type ChannelFilter = "ALL" | "WHATSAPP" | "AI_CALL" | "WEBSITE_CHAT" | "EMAIL";

type InboxConversation = {
  id: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  source?: string | null;
  channel: "WHATSAPP" | "AI_CALL" | "WEBSITE_CHAT";
  channelLabel: string;
  status: string;
  displayStatus: string;
  priority: string;
  intent?: string | null;
  aiConfidence: number;
  humanNeeded: boolean;
  ownerLabel: string;
  ownerType: string;
  nextAction: string;
  summary: string;
  lastMessage: string;
  lastActivityAt: string;
  hasMissedCall: boolean;
  hasRecording: boolean;
  hasTranscript: boolean;
  delayed: boolean;
  delayedTaskTitle?: string | null;
  taskCount: number;
  bookingCount: number;
  scheduledCall?: {
    taskId?: string;
    status?: string | null;
    scheduledAt?: string | null;
    scheduledLabel?: string | null;
    phone?: string | null;
    fullName?: string | null;
    purpose?: string | null;
    notes?: string | null;
    preferredLanguage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    callSid?: string | null;
    error?: string | null;
    meetingTime?: string | null;
  } | null;
  leadRequirements?: {
    summary: string;
    raw?: string[];
    meetingTime?: string | null;
    meetingScheduledAt?: string | null;
    meetingStatus?: string | null;
    bookingTitle?: string | null;
    source?: string | null;
    captured?: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  senderType: "CUSTOMER" | "AI" | "HUMAN";
  body: string;
  createdAt: string;
};

type Call = {
  id: string;
  phone: string;
  durationSeconds: number;
  transcript?: string | null;
  status: string;
  provider?: string | null;
  telephonyProvider?: string | null;
  voiceAgentProvider?: string | null;
  providerCallId?: string | null;
  direction?: string | null;
  recordingUrl?: string | null;
  recordingMediaUrl?: string | null;
  recordingSid?: string | null;
  recordingStatus?: string | null;
  recordingDurationSeconds?: number | null;
  recordingChannels?: number | null;
  recordingAvailableAt?: string | null;
  failureReason?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  computedTranscript?: string | null;
  createdAt: string;
  updatedAt?: string;
  postCallAnalysis?: PostCallAnalysisView | null;
  humeExpressionAnalysis?: {
    status?: string;
    userTurnCount?: number;
    topExpressions?: Array<{ name: string; score: number }>;
    averageScores?: Record<string, number>;
    insightSummary?: string | null;
  } | null;
};

type TeamUser = {
  id: string;
  name: string;
  email?: string | null;
  role?: string;
  isActive?: boolean;
};

type Task = {
  id: string;
  title: string;
  description?: string | null;
  owner?: string | null;
  aiNotes?: string | null;
  blockedReason?: string | null;
  dueAt?: string | null;
  priority: string;
  status: string;
  delayed?: boolean;
  assignedUser?: TeamUser | null;
  scheduledCall?: {
    taskId?: string;
    status?: string | null;
    scheduledAt?: string | null;
    scheduledLabel?: string | null;
    phone?: string | null;
    fullName?: string | null;
    purpose?: string | null;
    notes?: string | null;
    preferredLanguage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    callSid?: string | null;
    error?: string | null;
    meetingTime?: string | null;
  } | null;
  leadRequirements?: {
    summary: string;
    raw?: string[];
    meetingTime?: string | null;
    meetingScheduledAt?: string | null;
    meetingStatus?: string | null;
    bookingTitle?: string | null;
    source?: string | null;
    captured?: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type Booking = {
  id: string;
  title: string;
  dateTime?: string | null;
  status: string;
  assignedUserId?: string | null;
  assignedUser?: TeamUser | null;
  owner?: string | null;
  acceptanceStatus?: string | null;
  acceptedAt?: string | null;
  acceptedByUserId?: string | null;
  createdAt: string;
};

type BookingsResponse = {
  bookings: Booking[];
};

type BookingResponse = {
  message?: string;
  booking?: Booking;
};

type TeamResponse = {
  teamMembers?: TeamUser[];
  members?: Array<TeamUser & { type?: string }>;
};

type TimelineItem = {
  id: string;
  type: string;
  title: string;
  description: string;
  createdAt: string;
};

type ConversationDetail = InboxConversation & {
  customer?: {
    id: string;
    fullName?: string | null;
    phone: string;
    email?: string | null;
    source?: string | null;
    createdAt: string;
  } | null;
  messages: Message[];
  calls: Call[];
  tasks: Task[];
  bookings: Booking[];
  timeline: TimelineItem[];
  computedTranscript?: string | null;
  latestCall?: Call | null;
  latestCallAnalysis?: PostCallAnalysisView | null;
};

type InboxResponse = {
  summary: {
    total: number;
    needsHuman: number;
    hot: number;
    missed: number;
    followUp: number;
    resolved: number;
    today: {
      newConversations: number;
    };
  };
  integrationHealth: {
    whatsapp: {
      connected: boolean;
      label: string;
    };
    calls: {
      connected: boolean;
      label: string;
    };
    website: {
      connected: boolean;
      label: string;
    };
    email: {
      connected: boolean;
      label: string;
    };
  };
  conversations: InboxConversation[];
};

type ConversationDetailResponse = {
  conversation: ConversationDetail;
};

type CreateWhatsAppResponse = {
  message: string;
  created: boolean;
  conversation: {
    id: string;
  };
};

type SettingsControlRoomResponse = {
  integrations?: {
    whatsapp?: {
      status?: string;
      mode?: string;
      businessNumber?: string;
    };
    calls?: {
      status?: string;
      mode?: string;
      provider?: string;
      businessPhoneNumber?: string;
      realtimeEnabled?: boolean;
      webhookStatus?: string;
    };
    websiteChat?: {
      status?: string;
      mode?: string;
    };
    email?: {
      status?: string;
      mode?: string;
    };
  };
};

const filters: {
  label: string;
  value: InboxFilter;
}[] = [
  { label: "All", value: "ALL" },
  { label: "Needs Human", value: "NEEDS_HUMAN" },
  { label: "Hot", value: "HOT" },
  { label: "Missed", value: "MISSED" },
  { label: "Follow-up Due", value: "FOLLOW_UP" },
  { label: "AI Handling", value: "AI_HANDLING" },
  { label: "Resolved", value: "RESOLVED" },
];

const channels: {
  label: string;
  value: ChannelFilter;
}[] = [
  { label: "All Channels", value: "ALL" },
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "Calls", value: "AI_CALL" },
  { label: "Website", value: "WEBSITE_CHAT" },
  { label: "Email", value: "EMAIL" },
];

const QUEUE_PAGE_SIZE = 10;

type IntentPresentation = {
  label: string;
  priority: string;
  tone: "normal" | "warning" | "danger" | "success" | "muted";
  emptyMessage?: string;
};

function resolveIntentPresentation(
  analysis: PostCallAnalysisView | null | undefined,
  fallbackIntent?: string | null,
): IntentPresentation {
  const status = String(analysis?.analysisStatus || "NONE").toUpperCase();
  const rawIntent = String(analysis?.intentLevel || fallbackIntent || "").trim();
  const normalized = rawIntent.toUpperCase().replace(/[\s-]+/g, "_");

  if (status === "PENDING" || status === "PROCESSING") {
    return {
      label: "",
      priority: "",
      tone: "warning",
      emptyMessage: "Customer intent is still being analysed.",
    };
  }

  if (status === "FAILED") {
    return {
      label: "",
      priority: "",
      tone: "muted",
      emptyMessage: "Customer intent could not be determined.",
    };
  }

  if (
    status === "INSUFFICIENT_DATA" ||
    !normalized ||
    ["NONE", "UNKNOWN", "NOT_DETECTED", "UNDETERMINED"].includes(normalized)
  ) {
    return {
      label: "",
      priority: "",
      tone: "muted",
      emptyMessage: "No clear customer intent was detected.",
    };
  }

  if (
    /NOT_INTERESTED|NO_INTENT|REJECTED|DECLINED|LOST|DO_NOT_CONTACT/.test(
      normalized,
    )
  ) {
    return {
      label: "Not interested",
      priority: "Do not prioritise this lead.",
      tone: "danger",
    };
  }

  if (/HIGH|HOT|STRONG|READY|PURCHASE_READY|BUYING/.test(normalized)) {
    return {
      label: "High intent",
      priority: "Worth immediate attention.",
      tone: "success",
    };
  }

  if (/MEDIUM|WARM|MODERATE|CONSIDERING|INTERESTED/.test(normalized)) {
    return {
      label: "Medium intent",
      priority: "Worth a focused follow-up.",
      tone: "warning",
    };
  }

  if (/LOW|COLD|WEAK|BROWSING|CASUAL/.test(normalized)) {
    return {
      label: "Low intent",
      priority: "Low priority unless the customer re-engages.",
      tone: "muted",
    };
  }

  if (
    rawIntent.length > 48 ||
    /\b(?:need|needs|want|wants|require|requires|requirement|requirements|purpose)\b/i.test(
      rawIntent,
    )
  ) {
    return {
      label: "",
      priority: "",
      tone: "muted",
      emptyMessage: "No clear customer intent was detected.",
    };
  }

  return {
    label: formatEnum(rawIntent),
    priority: "",
    tone: "normal",
  };
}

function extractPurposeFromJson(value: string): string {
  const trimmed = value.trim();

  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed);

    function visit(item: unknown): string {
      if (!item) return "";
      if (typeof item === "string") return item;
      if (Array.isArray(item)) {
        for (const child of item) {
          const result = visit(child);
          if (result) return result;
        }
        return "";
      }

      if (typeof item === "object") {
        const record = item as Record<string, unknown>;
        const preferredKeys = [
          "primaryNeed",
          "customerNeed",
          "purpose",
          "requirementSummary",
          "requirement",
          "need",
        ];

        for (const key of preferredKeys) {
          if (typeof record[key] === "string" && String(record[key]).trim()) {
            return String(record[key]).trim();
          }
        }

        for (const child of Object.values(record)) {
          const result = visit(child);
          if (result) return result;
        }
      }

      return "";
    }

    return visit(parsed);
  } catch {
    return "";
  }
}

function cleanCustomerNeed(value?: string | null) {
  let candidate = String(value || "").trim();
  if (!candidate) return "";

  const jsonPurpose = extractPurposeFromJson(candidate);
  if (jsonPurpose) candidate = jsonPurpose;

  const labelledPurpose = candidate.match(
    /\b(?:purpose|primary need|customer need|what the customer needs|requirement)\s*[:\-]\s*([\s\S]*?)(?=(?:\n|[;|•·,])\s*(?:phone(?: number)?|number|status|language|scheduled(?: at| for)?|started|completed|call sid|provider|task id|notes?)\s*[:\-]|$)/i,
  );

  if (labelledPurpose?.[1]) {
    candidate = labelledPurpose[1].trim();
  }

  const noiseLine = /^(?:phone(?: number)?|number|status|language|scheduled(?: at| for)?|started|completed|call sid|provider|task id|notes?)\s*[:\-]/i;

  candidate = candidate
    .split(/\r?\n|[|•]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !noiseLine.test(line))
    .join(" ")
    .replace(/^(?:purpose|primary need|customer need|requirement)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return "";

  const operationalNoise = [
    /^customer completed (?:an )?ai (?:voice )?call/i,
    /^(?:outbound\s+)?ai (?:voice )?call (?:was )?(?:requested|completed|scheduled)/i,
    /^call (?:was )?(?:requested|completed|scheduled)/i,
    /^call this (?:lead|customer)/i,
    /^incoming call started/i,
  ];

  if (operationalNoise.some((pattern) => pattern.test(candidate))) {
    return "";
  }

  if (
    /collect (?:the )?.*requirements/i.test(candidate) &&
    /schedule (?:a )?meeting/i.test(candidate)
  ) {
    return "";
  }

  if (/^\+?\d[\d\s()-]{7,}$/.test(candidate)) {
    return "";
  }

  return candidate;
}

function cleanRecommendedNextStep(value?: string | null) {
  const candidate = String(value || "").replace(/\s+/g, " ").trim();
  if (!candidate) return "";

  if (
    /^(?:none|no action|not available|unknown|customer completed an ai voice call)$/i.test(
      candidate,
    )
  ) {
    return "";
  }

  return candidate;
}

function normalizeComparableText(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function uniqueTextItems(values: Array<string | null | undefined>) {
  const seen = new Set<string>();

  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = normalizeComparableText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function startOfLocalDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfLocalDay(value: Date) {
  const result = new Date(value);
  result.setHours(23, 59, 59, 999);
  return result;
}

function isSameLocalDay(value: string | null | undefined, target: Date) {
  if (!value) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

function compareBookingDate(a: Booking, b: Booking) {
  const aTime = a.dateTime ? new Date(a.dateTime).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.dateTime ? new Date(b.dateTime).getTime() : Number.MAX_SAFE_INTEGER;
  return aTime - bTime;
}

function bookingTone(
  status?: string | null,
): "normal" | "warning" | "danger" | "success" | "muted" {
  const value = String(status || "").toUpperCase();

  if (["COMPLETED", "CONFIRMED", "ACCEPTED", "WON"].includes(value)) {
    return "success";
  }

  if (["REQUESTED", "PENDING_ACCEPTANCE", "FOLLOW_UP"].includes(value)) {
    return "warning";
  }

  if (["CANCELLED", "NO_SHOW", "LOST"].includes(value)) {
    return "danger";
  }

  return "muted";
}

function bookingDisplayStatus(status?: string | null) {
  const value = String(status || "").toUpperCase();

  if (value === "REQUESTED") return "Pending acceptance";
  if (value === "CONFIRMED") return "Upcoming";
  return formatEnum(value || "NOT_SCHEDULED");
}

const DEFAULT_MEETING_DURATION_MINUTES = 60;

function isMeetingOpenForAssignment(booking: Booking) {
  const status = String(booking.status || "").toUpperCase();
  return !["CANCELLED", "COMPLETED", "NO_SHOW"].includes(status);
}

function employeeHasMeetingConflict(
  employeeId: string,
  targetBooking: Booking,
  allBookings: Booking[],
) {
  if (!targetBooking.dateTime) return false;

  const targetStart = new Date(targetBooking.dateTime).getTime();
  if (Number.isNaN(targetStart)) return false;

  const targetEnd =
    targetStart + DEFAULT_MEETING_DURATION_MINUTES * 60 * 1000;

  return allBookings.some((booking) => {
    if (
      booking.id === targetBooking.id ||
      booking.assignedUserId !== employeeId ||
      !booking.dateTime ||
      !isMeetingOpenForAssignment(booking)
    ) {
      return false;
    }

    const bookingStart = new Date(booking.dateTime).getTime();
    if (Number.isNaN(bookingStart)) return false;

    const bookingEnd =
      bookingStart + DEFAULT_MEETING_DURATION_MINUTES * 60 * 1000;

    return targetStart < bookingEnd && bookingStart < targetEnd;
  });
}

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  const now = Date.now();
  const diff = now - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "No deadline";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number) {
  if (!seconds) return "0s";

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  if (minutes <= 0) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

function getStatusTone(status: string) {
  if (status === "NEEDS_HUMAN" || status === "FOLLOW_UP") return "warning";
  if (status === "MISSED") return "danger";
  if (status === "WON" || status === "AI_HANDLING") return "success";
  if (status === "LOST") return "muted";
  return "normal";
}

function getChannelIcon(channel: string) {
  if (channel === "WHATSAPP") return <MessageCircle size={16} />;
  if (channel === "AI_CALL") return <Phone size={16} />;
  if (channel === "WEBSITE_CHAT") return <Inbox size={16} />;
  return <MessageCircle size={16} />;
}

function isLiveStatus(status?: string | null) {
  return status === "CONNECTED" || status === "LIVE" || status === "TESTING";
}

function buildIntegrationHealthFromSettings(
  current: InboxResponse["integrationHealth"],
  settings?: SettingsControlRoomResponse | null
): InboxResponse["integrationHealth"] {
  const calls = settings?.integrations?.calls;
  const whatsapp = settings?.integrations?.whatsapp;
  const website = settings?.integrations?.websiteChat;
  const email = settings?.integrations?.email;

  return {
    whatsapp: {
      connected: isLiveStatus(whatsapp?.status) || current.whatsapp.connected,
      label:
        whatsapp?.status === "CONNECTED" || whatsapp?.status === "LIVE"
          ? `WhatsApp ${whatsapp.mode || "LIVE"}`
          : current.whatsapp.label,
    },
    calls: {
      connected: isLiveStatus(calls?.status) || current.calls.connected,
      label:
        calls?.status === "CONNECTED" || calls?.status === "LIVE"
          ? `Twilio telephony + Hume EVI connected${
              calls.businessPhoneNumber ? ` · ${calls.businessPhoneNumber}` : ""
            }`
          : calls?.status === "TESTING"
            ? "Twilio is in testing mode. Finish Hume EVI/public webhook setup."
            : current.calls.label,
    },
    website: {
      connected: isLiveStatus(website?.status) || current.website.connected,
      label: website?.status ? `Website chat ${website.status}` : current.website.label,
    },
    email: {
      connected: isLiveStatus(email?.status) || current.email.connected,
      label: email?.status ? `Email ${email.status}` : current.email.label,
    },
  };
}

function getRecordingPlaybackUrl(call?: Call | null) {
  if (!call) return "";

  if (call.recordingMediaUrl) return call.recordingMediaUrl;

  if (call.id && (call.recordingUrl || call.recordingSid || call.recordingStatus)) {
    return `/api/calls/${call.id}/recording/media`;
  }

  const value = call.recordingUrl || "";
  if (!value) return "";

  if (/\.(mp3|wav)$/i.test(value)) return value;

  if (value.includes("api.twilio.com") && value.includes("/Recordings/")) {
    return `${value}.mp3`;
  }

  return value;
}

function buildTranscriptFromMessages(messages: Message[]) {
  return messages
    .map((message) => {
      const speaker =
        message.senderType === "CUSTOMER"
          ? "Customer"
          : message.senderType === "AI"
            ? "AI"
            : "Human";

      return `${speaker}: ${message.body}`;
    })
    .join("\n\n");
}

export default function InboxPage() {
  const [filter, setFilter] = useState<InboxFilter>("ALL");
  const [channel, setChannel] = useState<ChannelFilter>("ALL");
  const [search, setSearch] = useState("");
  const [queuePage, setQueuePage] = useState(1);

  const [summary, setSummary] = useState<InboxResponse["summary"]>({
    total: 0,
    needsHuman: 0,
    hot: 0,
    missed: 0,
    followUp: 0,
    resolved: 0,
    today: {
      newConversations: 0,
    },
  });

  const [integrationHealth, setIntegrationHealth] =
    useState<InboxResponse["integrationHealth"] | null>(null);

  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationDetail | null>(null);

  const [reply, setReply] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [teamMembers, setTeamMembers] = useState<TeamUser[]>([]);
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [assignmentWorking, setAssignmentWorking] = useState(false);

  const [showWhatsAppStart, setShowWhatsAppStart] = useState(false);
  const [whatsAppName, setWhatsAppName] = useState("");
  const [whatsAppPhone, setWhatsAppPhone] = useState("");
  const [whatsAppInitialMessage, setWhatsAppInitialMessage] = useState("");

  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadInbox = useCallback(async (nextSelectedId?: string) => {
    try {
      setError("");
      setLoadingList(true);

      const params = new URLSearchParams({
        filter,
        channel,
      });

      if (search.trim()) {
        params.set("search", search.trim());
      }

      const [data, settingsHealth] = await Promise.all([
        apiFetch<InboxResponse>(`/api/conversations/inbox?${params.toString()}`),
        apiFetch<SettingsControlRoomResponse>("/api/settings/control-room").catch(
          () => null
        ),
      ]);

      setSummary(data.summary);
      setIntegrationHealth(
        buildIntegrationHealthFromSettings(data.integrationHealth, settingsHealth)
      );
      setConversations(data.conversations);

      const preferredId = nextSelectedId || selectedIdRef.current;
      const nextId =
        (preferredId &&
        data.conversations.some((conversation) => conversation.id === preferredId)
          ? preferredId
          : "") ||
        data.conversations[0]?.id ||
        "";

      const selectedIndex = data.conversations.findIndex(
        (conversation) => conversation.id === nextId,
      );

      setQueuePage(
        selectedIndex >= 0
          ? Math.floor(selectedIndex / QUEUE_PAGE_SIZE) + 1
          : 1,
      );
      setSelectedId(nextId);

      if (nextId) {
        await loadConversation(nextId);
      } else {
        setSelectedConversation(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox");
    } finally {
      setLoadingList(false);
    }
  }, [filter, channel, search]);

  async function loadConversation(id: string) {
    try {
      setLoadingDetail(true);
      setSelectedId(id);

      const data = await apiFetch<ConversationDetailResponse>(
        `/api/conversations/${id}`
      );

      setSelectedConversation(data.conversation);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load conversation"
      );
    } finally {
      setLoadingDetail(false);
    }
  }

  async function loadMeetingAssignmentData() {
    const [teamResult, bookingsResult] = await Promise.allSettled([
      apiFetch<TeamResponse>("/api/team/overview"),
      apiFetch<BookingsResponse>("/api/bookings"),
    ]);

    if (teamResult.status === "fulfilled") {
      const data = teamResult.value;
      const members =
        data.teamMembers ||
        (data.members || []).filter((member) => member.type !== "UNASSIGNED");

      setTeamMembers(
        members.filter((member) => member.isActive !== false),
      );
    }

    if (bookingsResult.status === "fulfilled") {
      setAllBookings(bookingsResult.value.bookings || []);
    }
  }

  async function openConversation(id: string) {
    await loadConversation(id);

    if (window.innerWidth < 1280) {
      window.setTimeout(() => {
        document.getElementById("selected-conversation-panel")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 80);
    }
  }

  async function refreshCurrentConversation() {
    if (!selectedId) {
      await loadInbox();
      return;
    }

    await Promise.all([loadInbox(selectedId), loadConversation(selectedId)]);
  }


  async function createWhatsAppChat(event: FormEvent) {
    event.preventDefault();

    if (!whatsAppPhone.trim()) return;

    try {
      setSending(true);
      setError("");
      setNotice("");

      const data = await apiFetch<CreateWhatsAppResponse>(
        "/api/conversations/whatsapp",
        {
          method: "POST",
          body: JSON.stringify({
            fullName: whatsAppName.trim() || null,
            phone: whatsAppPhone.trim(),
            initialMessage: whatsAppInitialMessage.trim() || null,
          }),
        }
      );

      setNotice(data.message || "WhatsApp chat opened.");
      setWhatsAppName("");
      setWhatsAppPhone("");
      setWhatsAppInitialMessage("");
      setShowWhatsAppStart(false);
      setChannel("WHATSAPP");

      await loadInbox(data.conversation.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create WhatsApp chat"
      );
    } finally {
      setSending(false);
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();

    if (!selectedConversation || !reply.trim()) return;

    try {
      setSending(true);
      setError("");

      await apiFetch(`/api/conversations/${selectedConversation.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body: reply.trim(),
        }),
      });

      setReply("");
      await refreshCurrentConversation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  async function runAction(
    action:
      | "TAKE_OVER"
      | "RETURN_TO_AI"
      | "FOLLOW_UP"
      | "MARK_WON"
      | "MARK_LOST"
  ) {
    if (!selectedConversation) return;

    try {
      setSending(true);
      setError("");

      await apiFetch(`/api/conversations/${selectedConversation.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action,
        }),
      });

      await refreshCurrentConversation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSending(false);
    }
  }

  async function deleteSelectedConversation() {
    if (!selectedConversation) return;

    const confirmed = window.confirm(
      `Delete ${selectedConversation.customerName}? This will remove the conversation, messages, calls, recording links, tasks and bookings connected to this conversation. The customer/lead record will stay.`
    );

    if (!confirmed) return;

    try {
      setSending(true);
      setError("");

      await apiFetch(`/api/conversations/${selectedConversation.id}`, {
        method: "DELETE",
      });

      setSelectedId("");
      setSelectedConversation(null);
      await loadInbox();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete conversation"
      );
    } finally {
      setSending(false);
    }
  }

  async function createTask() {
    if (!selectedConversation) return;

    const title = window.prompt(
      "Task title",
      selectedConversation.nextAction || "Follow up with customer"
    );

    if (!title?.trim()) return;

    try {
      setSending(true);
      setError("");

      await apiFetch(`/api/conversations/${selectedConversation.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          priority:
            selectedConversation.priority === "CRITICAL" ||
            selectedConversation.priority === "HIGH"
              ? selectedConversation.priority
              : "MEDIUM",
          description: selectedConversation.summary,
          dueAt: null,
        }),
      });

      await refreshCurrentConversation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSending(false);
    }
  }

  async function sendEmployeeAvailabilityRequest(
    booking: Booking,
    employee: TeamUser,
  ) {
    try {
      setAssignmentWorking(true);
      setError("");
      setNotice("");

      const data = await apiFetch<BookingResponse>(
        `/api/bookings/${booking.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            assignedUserId: employee.id,
          }),
        },
      );

      setNotice(
        `Availability request sent to ${employee.name}. The meeting is now pending their acceptance.`,
      );

      await Promise.all([
        refreshCurrentConversation(),
        loadMeetingAssignmentData(),
      ]);

      if (data.booking?.id && selectedId) {
        await loadConversation(selectedId);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to send the employee availability request",
      );
    } finally {
      setAssignmentWorking(false);
    }
  }

  async function createBooking() {
    if (!selectedConversation) return;

    const title = window.prompt(
      "Booking title",
      `Booking for ${selectedConversation.customerName}`
    );

    if (!title?.trim()) return;

    const dateTime = window.prompt(
      "Booking date/time in ISO format or leave empty",
      ""
    );

    try {
      setSending(true);
      setError("");

      await apiFetch(`/api/conversations/${selectedConversation.id}/bookings`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          dateTime: dateTime?.trim() || null,
        }),
      });

      await refreshCurrentConversation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create booking");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadInbox();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [loadInbox]);

  useEffect(() => {
    void loadMeetingAssignmentData();
  }, []);

  const latestCallStatus = selectedConversation?.latestCall?.status;
  const firstCallStatus = selectedConversation?.calls?.[0]?.status;
  const latestAnalysisStatus =
    selectedConversation?.latestCallAnalysis?.analysisStatus;
  const firstCallAnalysisStatus =
    selectedConversation?.calls?.[0]?.postCallAnalysis?.analysisStatus;

  useEffect(() => {
    const call =
      selectedConversation?.latestCall || selectedConversation?.calls?.[0];
    const analysis =
      call?.postCallAnalysis || selectedConversation?.latestCallAnalysis || null;
    const needsRefresh =
      isLiveCallStatus(call?.status) ||
      analysis?.analysisStatus === "PENDING" ||
      analysis?.analysisStatus === "PROCESSING";

    if (!selectedId || !needsRefresh) return;

    const timer = window.setInterval(() => {
      void loadConversation(selectedId);
    }, 4000);

    return () => window.clearInterval(timer);
  }, [
    selectedId,
    latestCallStatus,
    firstCallStatus,
    latestAnalysisStatus,
    firstCallAnalysisStatus,
    selectedConversation,
  ]);

  const selectedCall = useMemo(() => {
    return selectedConversation?.latestCall || selectedConversation?.calls?.[0] || null;
  }, [selectedConversation]);

  const queuePageCount = Math.max(
    1,
    Math.ceil(conversations.length / QUEUE_PAGE_SIZE),
  );
  const safeQueuePage = Math.min(queuePage, queuePageCount);
  const queueStart = (safeQueuePage - 1) * QUEUE_PAGE_SIZE;
  const visibleConversations = conversations.slice(
    queueStart,
    queueStart + QUEUE_PAGE_SIZE,
  );

  function goToQueuePage(nextPage: number) {
    const clampedPage = Math.min(Math.max(nextPage, 1), queuePageCount);
    setQueuePage(clampedPage);

    const firstConversation =
      conversations[(clampedPage - 1) * QUEUE_PAGE_SIZE];

    if (firstConversation && firstConversation.id !== selectedId) {
      void loadConversation(firstConversation.id);
    }
  }

  return (
    <section className="space-y-5 pb-8">
      <style>{`
        .inbox-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.18) transparent;
        }

        .inbox-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        .inbox-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .inbox-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.16);
          border-radius: 999px;
        }

        .inbox-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.24);
        }
      `}</style>

      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5 md:p-6">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-cyan-200">
              <Inbox size={14} />
              Omnichannel Customer Command Center
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
              Inbox
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
              Search, select and work on a customer without scrolling through a
              long wall of conversation cards.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setQueuePage(1);
                setChannel("WHATSAPP");
                setShowWhatsAppStart((value) => !value);
              }}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 text-sm font-semibold text-black transition hover:bg-emerald-200"
            >
              <MessageCircle size={16} />
              New WhatsApp Chat
            </button>

            <button
              type="button"
              onClick={() => loadInbox()}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 transition hover:bg-white/[0.07] hover:text-white"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryChip label="Total" value={summary.total} />
          <SummaryChip
            label="Needs Human"
            value={summary.needsHuman}
            tone={summary.needsHuman > 0 ? "warning" : "normal"}
          />
          <SummaryChip
            label="Hot"
            value={summary.hot}
            tone={summary.hot > 0 ? "danger" : "normal"}
          />
          <SummaryChip
            label="Missed"
            value={summary.missed}
            tone={summary.missed > 0 ? "danger" : "normal"}
          />
          <SummaryChip label="Follow-up" value={summary.followUp} />
          <SummaryChip label="Resolved" value={summary.resolved} />
        </div>

        {integrationHealth?.calls.connected === false ? (
          <div className="mt-5 flex flex-col justify-between gap-3 rounded-[26px] border border-amber-500/20 bg-amber-500/10 px-5 py-4 md:flex-row md:items-center">
            <div className="flex items-start gap-3">
              <ShieldAlert
                size={20}
                className="mt-0.5 shrink-0 text-amber-100"
              />
              <div>
                <p className="text-sm font-semibold text-amber-100">
                  Call Agent Not Active
                </p>
                <p className="mt-1 text-sm leading-6 text-amber-100/70">
                  {integrationHealth.calls.label}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                window.location.href = "/settings";
              }}
              className="rounded-2xl bg-amber-100 px-5 py-3 text-sm font-semibold text-black"
            >
              Open Settings
            </button>
          </div>
        ) : null}

        {showWhatsAppStart ? (
          <WhatsAppStartPanel
            name={whatsAppName}
            phone={whatsAppPhone}
            message={whatsAppInitialMessage}
            sending={sending}
            onNameChange={setWhatsAppName}
            onPhoneChange={setWhatsAppPhone}
            onMessageChange={setWhatsAppInitialMessage}
            onCancel={() => setShowWhatsAppStart(false)}
            onSubmit={createWhatsAppChat}
          />
        ) : null}

        <div className="mt-5 space-y-4">
          <div className="inbox-scroll flex gap-2 overflow-x-auto pb-1">
            {filters.map((item) => (
              <button
                type="button"
                key={item.value}
                onClick={() => {
                  setQueuePage(1);
                  setFilter(item.value);
                }}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${
                  filter === item.value
                    ? "border-white bg-white text-black"
                    : "border-white/10 bg-white/[0.05] text-white/55 hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-[1fr_420px]">
            <div className="inbox-scroll flex gap-2 overflow-x-auto pb-1">
              {channels.map((item) => {
                const disabled = item.value === "EMAIL";

                return (
                  <button
                    type="button"
                    key={item.value}
                    disabled={disabled}
                    onClick={() => {
                      setQueuePage(1);
                      setChannel(item.value);
                    }}
                    className={`shrink-0 rounded-full border px-3 py-2 text-xs transition ${
                      channel === item.value
                        ? "border-white bg-white text-black"
                        : disabled
                          ? "border-white/10 bg-white/[0.03] text-white/25"
                          : "border-white/10 bg-white/[0.04] text-white/45 hover:text-white"
                    }`}
                  >
                    {item.label}
                    {disabled ? " · Connect" : ""}
                  </button>
                );
              })}
            </div>

            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
              <Search size={17} className="shrink-0 text-white/30" />
              <input
                value={search}
                onChange={(event) => {
                  setQueuePage(1);
                  setSearch(event.target.value);
                }}
                placeholder="Search customer or phone..."
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25"
              />
            </div>
          </div>
        </div>

        {notice ? (
          <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start">
        <aside className="overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.04] xl:sticky xl:top-5">
          <div className="border-b border-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em]">
                  {channel === "WHATSAPP" ? "WhatsApp Customers" : "Customer Queue"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-white/40">
                  Ten customers per page. Search above to jump directly to anyone.
                </p>
              </div>

              <Badge tone="normal">{conversations.length}</Badge>
            </div>

            {conversations.length > 0 ? (
              <p className="mt-4 text-xs text-white/35">
                Showing {queueStart + 1}–
                {Math.min(queueStart + QUEUE_PAGE_SIZE, conversations.length)} of{" "}
                {conversations.length}
              </p>
            ) : null}
          </div>

          <div className="inbox-scroll max-h-[calc(100vh-280px)] min-h-[420px] overflow-y-auto p-3">
            {loadingList ? (
              <div className="p-3">
                <LoadingState text="Loading customers..." />
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  icon={<Inbox size={28} />}
                  title="No customers found"
                  description={
                    channel === "WHATSAPP"
                      ? "No WhatsApp chats match the current filters."
                      : "No customer conversations match the current filters."
                  }
                />
              </div>
            ) : (
              <div className="space-y-2.5">
                {visibleConversations.map((conversation) => (
                  <ConversationCard
                    key={conversation.id}
                    conversation={conversation}
                    active={selectedId === conversation.id}
                    onClick={() => openConversation(conversation.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {conversations.length > 0 ? (
            <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-black/20 p-4">
              <button
                type="button"
                onClick={() => goToQueuePage(safeQueuePage - 1)}
                disabled={safeQueuePage <= 1}
                className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white/60 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft size={16} />
                Previous
              </button>

              <span className="text-xs text-white/40">
                Page {safeQueuePage} of {queuePageCount}
              </span>

              <button
                type="button"
                onClick={() => goToQueuePage(safeQueuePage + 1)}
                disabled={safeQueuePage >= queuePageCount}
                className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white/60 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          ) : null}
        </aside>

        <main
          id="selected-conversation-panel"
          className="min-w-0 space-y-5 scroll-mt-5"
        >
          {loadingDetail ? (
            <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-8">
              <LoadingState text="Opening customer..." />
            </section>
          ) : selectedConversation ? (
            <>
              <SelectedConversationOverview
                conversation={selectedConversation}
                onTakeOver={() => runAction("TAKE_OVER")}
                onReturnToAi={() => runAction("RETURN_TO_AI")}
                onFollowUp={() => runAction("FOLLOW_UP")}
                onWon={() => runAction("MARK_WON")}
                onLost={() => runAction("MARK_LOST")}
                onDelete={deleteSelectedConversation}
                disabled={sending}
              />

              <section className="grid gap-5 2xl:grid-cols-2">
                <PostCallIntelligenceSection
                  conversation={selectedConversation}
                  analysis={
                    selectedCall?.postCallAnalysis ||
                    selectedConversation.latestCallAnalysis ||
                    null
                  }
                />
                <LeadRequirementsSection
                  conversation={selectedConversation}
                  analysis={
                    selectedCall?.postCallAnalysis ||
                    selectedConversation.latestCallAnalysis ||
                    null
                  }
                />
              </section>

              {selectedConversation.scheduledCall &&
              selectedConversation.calls.length === 0 &&
              !selectedConversation.leadRequirements ? (
                <ScheduledCallSection conversation={selectedConversation} />
              ) : null}

              <TaskBookingSection
                conversation={selectedConversation}
                teamMembers={teamMembers}
                allBookings={allBookings}
                assignmentWorking={assignmentWorking}
                onSendAvailabilityRequest={sendEmployeeAvailabilityRequest}
              />

              <ConversationWorkspace
                conversation={selectedConversation}
                call={selectedCall}
                reply={reply}
                setReply={setReply}
                sending={sending}
                onSendReply={sendReply}
                onCreateTask={createTask}
                onCreateBooking={createBooking}
                onTakeOver={() => runAction("TAKE_OVER")}
                onFollowUp={() => runAction("FOLLOW_UP")}
              />
            </>
          ) : (
            <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-8">
              <EmptyState
                icon={<MessageCircle size={30} />}
                title="Select a customer"
                description="Intent, requirement, tasks, meetings and call details will appear here."
              />
            </section>
          )}
        </main>
      </section>
    </section>
  );
}

function WhatsAppStartPanel({
  name,
  phone,
  message,
  sending,
  onNameChange,
  onPhoneChange,
  onMessageChange,
  onCancel,
  onSubmit,
}: {
  name: string;
  phone: string;
  message: string;
  sending: boolean;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-5 rounded-[30px] border border-emerald-500/20 bg-emerald-500/10 p-5"
    >
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
            <MessageCircle size={14} />
            WhatsApp CRM Chat
          </div>

          <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
            Start a WhatsApp chat
          </h3>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-100/65">
            Add the customer number, open the chat in your software, and send a
            first message from the CRM. The chat will appear in the WhatsApp
            inbox immediately.
          </p>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/60 transition hover:bg-white/[0.08] hover:text-white"
        >
          Cancel
        </button>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_1fr_2fr_auto]">
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Customer name"
          className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25"
        />

        <input
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value)}
          placeholder="WhatsApp number, e.g. +919586410399"
          className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25"
        />

        <input
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          placeholder="First message, optional"
          className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25"
        />

        <button
          disabled={sending || !phone.trim()}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
          Open Chat
        </button>
      </div>
    </form>
  );
}

function ConversationCard({
  conversation,
  active,
  onClick,
}: {
  conversation: InboxConversation;
  active: boolean;
  onClick: () => void;
}) {
  const tone = getStatusTone(conversation.displayStatus);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        active
          ? "border-white bg-white text-black shadow-[0_18px_50px_rgba(255,255,255,0.08)]"
          : "border-white/10 bg-black/20 text-white hover:bg-white/[0.07]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`shrink-0 ${active ? "text-black/55" : "text-white/40"}`}
            >
              {getChannelIcon(conversation.channel)}
            </span>

            <p className="truncate text-base font-semibold tracking-[-0.02em]">
              {conversation.customerName}
            </p>
          </div>

          <p
            className={`mt-1 truncate text-xs ${
              active ? "text-black/45" : "text-white/35"
            }`}
          >
            {conversation.customerPhone || "No phone"}
          </p>
        </div>

        <Badge tone={tone} active={active}>
          {formatEnum(conversation.displayStatus)}
        </Badge>
      </div>

      <div
        className={`mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs ${
          active
            ? "border-black/10 text-black/50"
            : "border-white/8 text-white/35"
        }`}
      >
        <span className="truncate">{conversation.ownerLabel}</span>
        <span className="shrink-0">{formatTime(conversation.lastActivityAt)}</span>
      </div>
    </button>
  );
}

function SelectedConversationOverview({
  conversation,
  onTakeOver,
  onReturnToAi,
  onFollowUp,
  onWon,
  onLost,
  onDelete,
  disabled,
}: {
  conversation: ConversationDetail;
  onTakeOver: () => void;
  onReturnToAi: () => void;
  onFollowUp: () => void;
  onWon: () => void;
  onLost: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5 md:p-6">
      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-white/45">{getChannelIcon(conversation.channel)}</span>

            <h2 className="text-3xl font-semibold tracking-[-0.05em]">
              {conversation.customerName}
            </h2>

            <Badge tone={getStatusTone(conversation.displayStatus)}>
              {formatEnum(conversation.displayStatus)}
            </Badge>

            <Badge
              tone={
                conversation.priority === "CRITICAL" ||
                conversation.priority === "HIGH"
                  ? "danger"
                  : "normal"
              }
            >
              {formatEnum(conversation.priority)}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/42">
            <span>{conversation.customerPhone || "No phone captured"}</span>
            <span>{conversation.channelLabel}</span>
            <span>Owner: {conversation.ownerLabel}</span>
            <span>Updated {formatTime(conversation.lastActivityAt)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 xl:max-w-[520px] xl:justify-end">
          <HeaderAction onClick={onTakeOver} disabled={disabled}>
            Take Over
          </HeaderAction>
          <HeaderAction onClick={onReturnToAi} disabled={disabled}>
            Return to AI
          </HeaderAction>
          <HeaderAction onClick={onFollowUp} disabled={disabled}>
            Follow-up
          </HeaderAction>
          <HeaderAction onClick={onWon} disabled={disabled}>
            Mark Won
          </HeaderAction>
          <HeaderAction onClick={onLost} disabled={disabled}>
            Mark Lost
          </HeaderAction>
          <HeaderAction onClick={onDelete} disabled={disabled} tone="danger">
            Delete
          </HeaderAction>
        </div>
      </div>
    </section>
  );
}

function ScheduledCallSection({
  conversation,
}: {
  conversation: ConversationDetail;
}) {
  const call = conversation.scheduledCall;

  return (
    <PanelCard title="Scheduled AI Call" icon={<Clock3 size={18} />}>
      {call ? (
        <div className="space-y-4">
          <div className="rounded-[26px] border border-cyan-500/20 bg-cyan-500/10 p-5">
            <p className="text-sm text-cyan-100/60">AI call time</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-cyan-50">
              {call.scheduledLabel || formatDateTime(call.scheduledAt)}
            </p>
            <p className="mt-2 text-sm leading-6 text-cyan-100/65">
              AI calls {call.phone || conversation.customerPhone || "this lead"} and collects requirements.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <InfoBox label="Status" value={formatEnum(call.status || "SCHEDULED")} />
            <InfoBox label="Language" value={formatEnum(call.preferredLanguage || "AUTO")} />
            <InfoBox label="Purpose" value={call.purpose || conversation.intent || "Collect requirements"} />
            <InfoBox label="Twilio call" value={call.callSid || "Not started yet"} />
            <InfoBox label="Started" value={call.startedAt ? formatDateTime(call.startedAt) : "Not started yet"} />
            <InfoBox label="Meeting requested" value={call.meetingTime || conversation.leadRequirements?.meetingTime || "Not captured yet"} />
          </div>

          {call.error ? (
            <p className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm leading-6 text-red-100">
              {call.error}
            </p>
          ) : null}
        </div>
      ) : (
        <EmptyMini text="No scheduled AI call linked to this conversation." />
      )}
    </PanelCard>
  );
}

function LeadRequirementsSection({
  conversation,
  analysis,
}: {
  conversation: ConversationDetail;
  analysis: PostCallAnalysisView | null | undefined;
}) {
  const details = analysis?.requirementDetails || null;

  const taskPurpose = conversation.tasks
    .map((task) => task.scheduledCall?.purpose)
    .find((value) => String(value || "").trim());

  const customerNeed = [
    details?.primaryNeed,
    analysis?.requirementSummary,
    conversation.scheduledCall?.purpose,
    taskPurpose,
    conversation.leadRequirements?.summary,
  ]
    .map((value) => cleanCustomerNeed(value))
    .find(Boolean) || "";

  const requestedNextStep = cleanRecommendedNextStep(
    details?.requestedNextStep,
  );
  const conversationNextStep = cleanRecommendedNextStep(
    conversation.nextAction,
  );
  const recommendedNextStep =
    requestedNextStep || conversationNextStep;

  const showRecommendedNextStep =
    Boolean(recommendedNextStep) &&
    normalizeComparableText(recommendedNextStep) !==
      normalizeComparableText(customerNeed);

  return (
    <PanelCard title="Lead Requirement" icon={<Sparkles size={18} />}>
      <div className="space-y-6">
        {customerNeed ? (
          <div className="rounded-[28px] border border-emerald-400/15 bg-emerald-400/[0.07] p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">
              What the customer needs
            </p>
            <p className="mt-3 text-base leading-8 text-white/78">
              {customerNeed}
            </p>
          </div>
        ) : (
          <EmptyMini text="No clear customer requirement was captured." />
        )}

        {showRecommendedNextStep ? (
          <div className="rounded-[28px] border border-amber-400/20 bg-amber-400/[0.08] p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/65">
              Recommended next step
            </p>
            <p className="mt-3 text-base font-semibold leading-8 text-amber-50/90">
              {recommendedNextStep}
            </p>
          </div>
        ) : null}
      </div>
    </PanelCard>
  );
}

function PostCallIntelligenceSection({
  conversation,
  analysis,
}: {
  conversation: ConversationDetail;
  analysis: PostCallAnalysisView | null | undefined;
}) {
  const intent = resolveIntentPresentation(analysis, conversation.intent);

  return (
    <PanelCard title="Customer Intent" icon={<Sparkles size={18} />}>
      {intent.emptyMessage ? (
        <EmptyMini text={intent.emptyMessage} />
      ) : (
        <div className="rounded-[28px] border border-cyan-400/15 bg-cyan-400/[0.07] p-6">
          <Badge tone={intent.tone}>{intent.label}</Badge>

          {intent.priority ? (
            <div className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/60">
                Follow-up priority
              </p>
              <p className="mt-2 text-base font-semibold leading-8 text-white/82">
                {intent.priority}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </PanelCard>
  );
}

function TaskBookingSection({
  conversation,
  teamMembers,
  allBookings,
  assignmentWorking,
  onSendAvailabilityRequest,
}: {
  conversation: ConversationDetail;
  teamMembers: TeamUser[];
  allBookings: Booking[];
  assignmentWorking: boolean;
  onSendAvailabilityRequest: (
    booking: Booking,
    employee: TeamUser,
  ) => void | Promise<void>;
}) {
  const todayMeetings = conversation.bookings
    .filter((booking) => isSameLocalDay(booking.dateTime, new Date()))
    .sort(compareBookingDate);

  const upcomingMeetings = conversation.bookings
    .filter((booking) => {
      if (!booking.dateTime) return false;
      const date = new Date(booking.dateTime);
      if (Number.isNaN(date.getTime())) return false;
      return date.getTime() > endOfLocalDay(new Date()).getTime();
    })
    .sort(compareBookingDate);

  const unscheduledMeetings = conversation.bookings.filter(
    (booking) => !booking.dateTime,
  );

  const closedMeetings = conversation.bookings.filter((booking) => {
    const status = String(booking.status || "").toUpperCase();
    if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(status)) {
      return !todayMeetings.some((item) => item.id === booking.id);
    }

    if (!booking.dateTime) return false;
    const date = new Date(booking.dateTime);
    return (
      !Number.isNaN(date.getTime()) &&
      date.getTime() < startOfLocalDay(new Date()).getTime()
    );
  });

  return (
    <PanelCard title="Tasks & Meetings" icon={<Clock3 size={18} />}>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white/78">Tasks</h3>
              <p className="mt-1 text-xs text-white/35">
                Follow-up work created from this conversation
              </p>
            </div>
            <Badge tone="normal">{conversation.tasks.length}</Badge>
          </div>

          {conversation.tasks.length === 0 ? (
            <div className="mt-4">
              <EmptyMini text="No follow-up tasks have been created." />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {conversation.tasks.slice(0, 6).map((task) => (
                <div
                  key={task.id}
                  className="rounded-[24px] border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium leading-6 text-white/76">
                      {task.title}
                    </p>
                    <Badge tone={task.delayed ? "danger" : "normal"}>
                      {formatEnum(task.status)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-white/36">
                    {task.assignedUser?.name || task.owner || "Unassigned"}
                    {task.dueAt ? ` · ${formatDateTime(task.dueAt)}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white/78">Meetings</h3>
              <p className="mt-1 text-xs text-white/35">
                Today first, then meetings scheduled after today
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/bookings";
              }}
              className="text-xs font-medium text-cyan-100/65 transition hover:text-cyan-100"
            >
              Open all meetings
            </button>
          </div>

          <MeetingAssignmentPrompt
            meetings={conversation.bookings}
            teamMembers={teamMembers}
            allBookings={allBookings}
            working={assignmentWorking}
            onSend={onSendAvailabilityRequest}
          />

          <MeetingGroup
            title="Meetings today"
            meetings={todayMeetings}
            emptyText="No meetings scheduled for today."
          />

          <MeetingGroup
            title="Upcoming meetings"
            meetings={upcomingMeetings}
            emptyText="No meetings scheduled after today."
          />

          {unscheduledMeetings.length > 0 ? (
            <MeetingGroup
              title="Needs scheduling"
              meetings={unscheduledMeetings}
              emptyText=""
            />
          ) : null}

          {closedMeetings.length > 0 ? (
            <p className="mt-5 text-xs text-white/30">
              {closedMeetings.length} past or closed meeting
              {closedMeetings.length === 1 ? "" : "s"} available on the Meetings page.
            </p>
          ) : null}
        </section>
      </div>
    </PanelCard>
  );
}

function MeetingAssignmentPrompt({
  meetings,
  teamMembers,
  allBookings,
  working,
  onSend,
}: {
  meetings: Booking[];
  teamMembers: TeamUser[];
  allBookings: Booking[];
  working: boolean;
  onSend: (booking: Booking, employee: TeamUser) => void | Promise<void>;
}) {
  const meeting = useMemo(() => {
    const conversationMeeting =
      meetings
        .filter((booking) => {
          if (!booking.dateTime || !isMeetingOpenForAssignment(booking)) {
            return false;
          }

          const meetingTime = new Date(booking.dateTime).getTime();
          return !Number.isNaN(meetingTime) && meetingTime >= Date.now();
        })
        .sort(compareBookingDate)[0] || null;

    if (!conversationMeeting) return null;

    return (
      allBookings.find((booking) => booking.id === conversationMeeting.id) ||
      conversationMeeting
    );
  }, [meetings, allBookings]);

  const availableEmployees = useMemo(() => {
    if (!meeting) return [];

    return teamMembers.filter(
      (employee) =>
        employee.isActive !== false &&
        !employeeHasMeetingConflict(employee.id, meeting, allBookings),
    );
  }, [meeting, teamMembers, allBookings]);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");

  useEffect(() => {
    if (!meeting || meeting.assignedUserId) {
      setSelectedEmployeeId("");
      return;
    }

    setSelectedEmployeeId((current) => {
      if (
        current &&
        availableEmployees.some((employee) => employee.id === current)
      ) {
        return current;
      }

      return availableEmployees[0]?.id || "";
    });
  }, [meeting, availableEmployees]);

  if (!meeting) return null;

  const assignedEmployee =
    meeting.assignedUser ||
    teamMembers.find((employee) => employee.id === meeting.assignedUserId) ||
    null;
  const acceptanceStatus = String(
    meeting.acceptanceStatus || "",
  ).toUpperCase();

  if (meeting.assignedUserId && assignedEmployee) {
    const accepted = acceptanceStatus === "ACCEPTED";

    return (
      <div
        className={`mt-6 rounded-[28px] border p-5 ${
          accepted
            ? "border-emerald-400/20 bg-emerald-400/[0.08]"
            : "border-amber-400/20 bg-amber-400/[0.08]"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
              accepted
                ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                : "border-amber-300/20 bg-amber-300/10 text-amber-100"
            }`}
          >
            <UsersRound size={18} />
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">
              Employee confirmation
            </p>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/82">
              {accepted
                ? `${assignedEmployee.name} accepted this meeting.`
                : `Availability request sent to ${assignedEmployee.name}.`}
            </p>
            <p className="mt-2 text-xs leading-5 text-white/40">
              {formatDateTime(meeting.dateTime)} ·{" "}
              {accepted ? "Accepted" : "Pending employee acceptance"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (teamMembers.length === 0) {
    return (
      <div className="mt-6 rounded-[28px] border border-dashed border-white/10 p-5">
        <p className="text-sm font-semibold text-white/72">
          Employee assignment
        </p>
        <p className="mt-2 text-sm leading-6 text-white/38">
          The lead requested {formatDateTime(meeting.dateTime)}. Add active
          employees to AiraDesk before sending an availability request.
        </p>
      </div>
    );
  }

  const selectedEmployee =
    availableEmployees.find(
      (employee) => employee.id === selectedEmployeeId,
    ) || null;

  return (
    <div className="mt-6 rounded-[28px] border border-cyan-400/20 bg-cyan-400/[0.07] p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
          <CalendarCheck size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100/65">
            Meeting requested by the lead
          </p>
          <p className="mt-2 text-base font-semibold leading-7 text-white/86">
            {formatDateTime(meeting.dateTime)}
          </p>
          <p className="mt-2 text-sm leading-6 text-white/48">
            AiraDesk checked the meetings already assigned in the CRM. Choose
            an employee who appears free and send the meeting for confirmation.
          </p>
        </div>
      </div>

      {availableEmployees.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] p-4">
          <p className="text-sm font-semibold text-amber-100">
            No employee appears free at this time.
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-100/55">
            Review the Meetings calendar before assigning this meeting.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/38">
              Employees who appear free
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {availableEmployees.map((employee) => {
                const selected = employee.id === selectedEmployeeId;

                return (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => setSelectedEmployeeId(employee.id)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      selected
                        ? "border-white bg-white text-black"
                        : "border-white/10 bg-black/20 text-white hover:bg-white/[0.07]"
                    }`}
                  >
                    <p className="text-sm font-semibold">{employee.name}</p>
                    <p
                      className={`mt-1 text-xs ${
                        selected ? "text-black/50" : "text-white/35"
                      }`}
                    >
                      Available at the requested time
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            disabled={working || !selectedEmployee}
            onClick={() => {
              if (selectedEmployee) {
                void onSend(meeting, selectedEmployee);
              }
            }}
            className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            {selectedEmployee
              ? `Ask ${selectedEmployee.name} to confirm availability`
              : "Select an employee"}
          </button>
        </>
      )}
    </div>
  );
}

function MeetingGroup({
  title,
  meetings,
  emptyText,
}: {
  title: string;
  meetings: Booking[];
  emptyText: string;
}) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/38">
          {title}
        </p>
        <span className="text-xs text-white/28">{meetings.length}</span>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-4 text-sm text-white/32">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-3">
          {meetings.slice(0, 5).map((booking) => (
            <div
              key={booking.id}
              className="rounded-[24px] border border-white/10 bg-black/20 p-4"
            >
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-6 text-white/76">
                    {booking.title}
                  </p>
                  <p className="mt-2 text-xs text-white/36">
                    {booking.dateTime
                      ? formatDateTime(booking.dateTime)
                      : "Date and time not set"}
                  </p>
                </div>
                <Badge tone={bookingTone(booking.status)}>
                  {bookingDisplayStatus(booking.status)}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationWorkspace({
  conversation,
  call,
  reply,
  setReply,
  sending,
  onSendReply,
  onCreateTask,
  onCreateBooking,
  onTakeOver,
  onFollowUp,
}: {
  conversation: ConversationDetail;
  call: Call | null;
  reply: string;
  setReply: (value: string) => void;
  sending: boolean;
  onSendReply: (event: FormEvent) => void;
  onCreateTask: () => void;
  onCreateBooking: () => void;
  onTakeOver: () => void;
  onFollowUp: () => void;
}) {
  return (
    <section
      id="conversation-workspace"
      className="flex h-[calc(100vh-140px)] min-h-[680px] max-h-[900px] flex-col overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.04]"
    >
      <header className="shrink-0 border-b border-white/10 bg-black/20 p-5">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
          <div>
            <div className="flex items-center gap-2 text-sm text-cyan-200">
              {getChannelIcon(conversation.channel)}
              {conversation.channel === "AI_CALL"
                ? "Call Workspace"
                : conversation.channel === "WHATSAPP"
                  ? "WhatsApp Chat"
                  : "Chat Workspace"}
            </div>

            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.05em]">
              {conversation.channel === "AI_CALL"
                ? "Call Details"
                : conversation.channel === "WHATSAPP"
                  ? "WhatsApp Conversation"
                  : "Customer Chat"}
            </h2>

            <p className="mt-2 text-sm text-white/40">
              {conversation.channel === "WHATSAPP"
                ? "Reply to WhatsApp leads, create tasks, and book meetings from one CRM screen."
                : "Recording, collapsed transcript and technical call details are available here when needed."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <QuickAction onClick={onCreateTask} disabled={sending}>
              Create Task
            </QuickAction>
            <QuickAction onClick={onCreateBooking} disabled={sending}>
              Book Meeting
            </QuickAction>
            <QuickAction onClick={onTakeOver} disabled={sending}>
              Take Over
            </QuickAction>
            <QuickAction onClick={onFollowUp} disabled={sending}>
              Follow-up
            </QuickAction>
          </div>
        </div>
      </header>

      <div className="inbox-scroll min-h-0 flex-1 overflow-y-auto p-5 md:p-8">
        {conversation.channel === "AI_CALL" ? (
          <CallDetail conversation={conversation} call={call} />
        ) : (
          <MessageThread conversation={conversation} />
        )}
      </div>

      {conversation.channel !== "AI_CALL" ? (
        <form
          onSubmit={onSendReply}
          className="shrink-0 border-t border-white/10 bg-black/25 p-4 md:p-5"
        >
          <div className="mx-auto flex max-w-5xl gap-3 rounded-[28px] border border-white/10 bg-black/35 p-2">
            <input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder={
                conversation.channel === "WHATSAPP"
                  ? "Type a WhatsApp reply from the CRM..."
                  : "Type a human reply..."
              }
              className="h-12 min-w-0 flex-1 bg-transparent px-4 text-sm outline-none placeholder:text-white/25"
            />

            <button
              disabled={sending || !reply.trim()}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Send size={16} />
              )}
              Send
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function MessageThread({ conversation }: { conversation: ConversationDetail }) {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {conversation.messages.length === 0 ? (
        <EmptyState
          icon={<MessageCircle size={28} />}
          title="No messages yet"
          description="When the customer, AI or staff replies, the full thread will appear here."
        />
      ) : (
        conversation.messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isWhatsApp={conversation.channel === "WHATSAPP"}
          />
        ))
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isWhatsApp,
}: {
  message: Message;
  isWhatsApp: boolean;
}) {
  const isCustomer = message.senderType === "CUSTOMER";
  const isAi = message.senderType === "AI";

  return (
    <div className={`flex ${isCustomer ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[82%] rounded-[28px] border p-5 ${
          isCustomer
            ? "border-white/10 bg-white/[0.05]"
            : isAi
              ? "border-cyan-500/20 bg-cyan-500/10"
              : isWhatsApp
                ? "border-emerald-300/20 bg-emerald-300/15"
                : "border-white bg-white text-black"
        }`}
      >
        <div
          className={`mb-3 flex items-center gap-2 text-xs font-medium ${
            isCustomer
              ? "text-white/40"
              : isAi
                ? "text-cyan-100/70"
                : isWhatsApp
                ? "text-emerald-100/70"
                : "text-black/50"
          }`}
        >
          {isCustomer ? (
            <UserRound size={14} />
          ) : isAi ? (
            <Bot size={14} />
          ) : (
            <UsersRound size={14} />
          )}

          {isCustomer ? "Customer" : isAi ? "AI" : "Human"}
          <span>·</span>
          <span>{formatTime(message.createdAt)}</span>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-7">{message.body}</p>
      </div>
    </div>
  );
}

function CallDetail({
  conversation,
  call,
}: {
  conversation: ConversationDetail;
  call: Call | null;
}) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const transcript =
    call?.transcript ||
    call?.computedTranscript ||
    conversation.computedTranscript ||
    buildTranscriptFromMessages(conversation.messages) ||
    "";

  useEffect(() => {
    if (!transcriptOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setTranscriptOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [transcriptOpen]);

  if (!call) {
    return (
      <EmptyState
        icon={<Phone size={30} />}
        title="No call record found"
        description="Call information will appear here when the voice provider sends call data to the backend."
      />
    );
  }

  const recordingPlaybackUrl = getRecordingPlaybackUrl(call);

  return (
    <>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-[30px] border border-white/10 bg-black/20 p-6">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
            <div>
              <div className="flex items-center gap-2 text-sm text-white/50">
                <Phone size={16} />
                {formatEnum(call.direction || "INBOUND")} call
              </div>

              <h3 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
                Call with {conversation.customerName}
              </h3>

              <p className="mt-3 text-sm text-white/40">
                {call.phone || conversation.customerPhone} ·{" "}
                {formatDateTime(call.startedAt || call.createdAt)} ·{" "}
                {formatDuration(call.durationSeconds)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              <Badge
                tone={
                  isLiveCallStatus(call.status)
                    ? "warning"
                    : ["MISSED", "NO_ANSWER", "BUSY", "CANCELED", "FAILED"].includes(
                        call.status,
                      )
                      ? "danger"
                      : "success"
                }
              >
                {formatEnum(call.status)}
              </Badge>
              {recordingPlaybackUrl ? (
                <Badge tone="success">Recording available</Badge>
              ) : null}
              {transcript ? <Badge tone="success">Transcript available</Badge> : null}
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-white/10 bg-black/20 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
            <Headphones size={17} />
            Recording
          </div>

          {recordingPlaybackUrl ? (
            <div className="mt-5">
              <AuthenticatedAudioPlayer url={recordingPlaybackUrl} />
            </div>
          ) : (
            <p className="mt-5 text-sm leading-6 text-white/40">
              Recording is not ready yet. It will appear automatically after
              provider processing is complete.
            </p>
          )}
        </div>

        <div className="rounded-[30px] border border-white/10 bg-black/20 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
            <Mic2 size={17} />
            Transcript
          </div>

          <button
            type="button"
            onClick={() => setTranscriptOpen(true)}
            disabled={!transcript}
            className="mt-5 flex w-full items-center justify-between gap-5 rounded-[24px] border border-dashed border-white/15 bg-white/[0.035] px-5 py-5 text-left transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <div>
              <p className="text-sm font-medium text-white/72">
                {transcript ? "Full call transcript" : "Transcript unavailable"}
              </p>
              <p className="mt-1 text-xs text-white/34">
                {transcript
                  ? `${countWords(transcript)} words · collapsed until opened`
                  : "No transcript has been saved for this call."}
              </p>
            </div>

            <span className="flex shrink-0 items-center gap-2 text-sm text-cyan-100/70">
              {transcript ? "Open transcript" : "Not available"}
              {transcript ? <ChevronDown size={16} /> : null}
            </span>
          </button>
        </div>

        <details className="rounded-[30px] border border-white/10 bg-black/20 p-6">
          <summary className="cursor-pointer list-none text-sm font-semibold text-white/62">
            Technical call details
          </summary>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <InfoBox
              label="Telephony"
              value={call.telephonyProvider || call.provider || "TWILIO"}
            />
            <InfoBox
              label="Voice agent"
              value={call.voiceAgentProvider || "HUME_EVI"}
            />
            <InfoBox
              label="Provider call ID"
              value={call.providerCallId || "Not available"}
            />
            <InfoBox
              label="Recording status"
              value={call.recordingStatus || "Not available"}
            />
            <InfoBox
              label="Recording duration"
              value={
                call.recordingDurationSeconds
                  ? formatDuration(call.recordingDurationSeconds)
                  : "Not available"
              }
            />
            <InfoBox
              label="Started"
              value={formatDateTime(call.startedAt || call.createdAt)}
            />
          </div>
        </details>

        {conversation.calls.length > 1 ? (
          <details className="rounded-[30px] border border-white/10 bg-black/20 p-6">
            <summary className="cursor-pointer list-none text-sm font-semibold text-white/62">
              Previous calls ({conversation.calls.length - 1})
            </summary>

            <div className="mt-5 space-y-3">
              {conversation.calls.slice(1).map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                    <div>
                      <p className="text-sm font-medium text-white/70">
                        {item.phone || conversation.customerPhone || "Unknown phone"}
                      </p>
                      <p className="mt-1 text-xs text-white/35">
                        {formatDateTime(item.createdAt)} ·{" "}
                        {formatDuration(item.durationSeconds)}
                      </p>
                    </div>
                    <Badge
                      tone={
                        ["MISSED", "NO_ANSWER", "BUSY", "CANCELED", "FAILED"].includes(
                          item.status,
                        )
                          ? "danger"
                          : "success"
                      }
                    >
                      {formatEnum(item.status)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      {transcriptOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xl md:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`Transcript for ${conversation.customerName}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTranscriptOpen(false);
          }}
        >
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[34px] border border-white/15 bg-[#080b12] shadow-[0_30px_120px_rgba(0,0,0,0.65)]">
            <header className="flex shrink-0 items-start justify-between gap-5 border-b border-white/10 px-6 py-5 md:px-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/55">
                  Full call transcript
                </p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                  {conversation.customerName}
                </h3>
                <p className="mt-2 text-sm text-white/36">
                  {countWords(transcript)} words · {formatDateTime(call.createdAt)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setTranscriptOpen(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-white/60 transition hover:bg-white/[0.10] hover:text-white"
                aria-label="Close transcript"
              >
                <X size={19} />
              </button>
            </header>

            <div className="inbox-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-8 md:py-8">
              <p className="whitespace-pre-wrap text-[15px] leading-8 text-white/68">
                {transcript}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SummaryChip({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: ReactNode;
  tone?: "normal" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/20 bg-red-500/10"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10"
        : "border-white/10 bg-black/20";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function Badge({
  children,
  tone = "normal",
  active = false,
}: {
  children: ReactNode;
  tone?: "normal" | "warning" | "danger" | "success" | "muted";
  active?: boolean;
}) {
  const className = active
    ? "bg-black/10 text-black"
    : tone === "danger"
      ? "bg-red-500/10 text-red-100"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-100"
        : tone === "success"
          ? "bg-emerald-500/10 text-emerald-100"
          : tone === "muted"
            ? "bg-white/5 text-white/35"
            : "bg-white/10 text-white/55";

  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs ${className}`}
    >
      {children}
    </span>
  );
}

function HeaderAction({
  children,
  onClick,
  disabled,
  tone = "normal",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  tone?: "normal" | "danger";
}) {
  const className =
    tone === "danger"
      ? "rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
      : "rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/60 transition hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );
}

function QuickAction({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/60 transition hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function PanelCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5 md:p-6">
      <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-white/70">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-white/75">
        {value || "-"}
      </p>
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-sm text-white/40">
      {text}
    </div>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center">
      <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/50">
        <Loader2 className="animate-spin" size={18} />
        {text}
      </div>
    </div>
  );
}

function AuthenticatedAudioPlayer({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let revoked = false;
    let currentUrl = "";

    async function loadAudio() {
      if (!url) return;

      if (/^https?:/i.test(url) && !url.includes("api.twilio.com")) {
        setBlobUrl(url);
        return;
      }

      try {
        setLoading(true);
        setError("");

        const token = localStorage.getItem("airadesk_token");
        const response = await fetch(url.startsWith("http") ? url : `${API_BASE_URL}${url}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (!response.ok) throw new Error("Recording is not ready yet");

        const blob = await response.blob();
        currentUrl = URL.createObjectURL(blob);

        if (!revoked) setBlobUrl(currentUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load recording");
      } finally {
        setLoading(false);
      }
    }

    loadAudio();

    return () => {
      revoked = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [url]);

  if (loading) {
    return (
      <div className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/40">
        <Loader2 className="animate-spin" size={16} />
        Loading recording...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/80">
        {error}
      </div>
    );
  }

  return blobUrl ? <audio controls src={blobUrl} className="w-full" /> : null;
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white/[0.06] text-white/40">
        {icon}
      </div>

      <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em]">
        {title}
      </h3>

      <p className="mt-2 max-w-sm text-sm leading-6 text-white/38">
        {description}
      </p>
    </div>
  );
}