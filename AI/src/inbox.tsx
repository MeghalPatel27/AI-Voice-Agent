import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
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
} from "lucide-react";
import { API_BASE_URL, apiFetch } from "./lib/api";
import {
  analysisStatusLabel,
  intentLevelLabel,
  intentTone,
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
  assignedUser?: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
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
  createdAt: string;
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
          ? `Twilio realtime voice connected${
              calls.businessPhoneNumber ? ` · ${calls.businessPhoneNumber}` : ""
            }`
          : calls?.status === "TESTING"
            ? "Twilio is in testing mode. Finish OpenAI realtime/public webhook setup."
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

  const [showWhatsAppStart, setShowWhatsAppStart] = useState(false);
  const [whatsAppName, setWhatsAppName] = useState("");
  const [whatsAppPhone, setWhatsAppPhone] = useState("");
  const [whatsAppInitialMessage, setWhatsAppInitialMessage] = useState("");

  async function loadInbox(nextSelectedId?: string) {
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

      const nextId =
        nextSelectedId ||
        selectedId ||
        data.conversations[0]?.id ||
        "";

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
  }

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

  async function openConversation(id: string) {
    await loadConversation(id);

    window.setTimeout(() => {
      document.getElementById("conversation-workspace")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
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
      loadInbox();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [filter, channel, search]);

  useEffect(() => {
    const call = selectedConversation?.latestCall || selectedConversation?.calls?.[0];
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
    selectedConversation?.latestCall?.status,
    selectedConversation?.calls?.[0]?.status,
    selectedConversation?.latestCallAnalysis?.analysisStatus,
    selectedConversation?.calls?.[0]?.postCallAnalysis?.analysisStatus,
  ]);

  const selectedCall = useMemo(() => {
    return selectedConversation?.latestCall || selectedConversation?.calls?.[0] || null;
  }, [selectedConversation]);

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
              All customer conversations, calls, handoffs, follow-ups and next
              actions in one clean workspace.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setChannel("WHATSAPP");
                setShowWhatsAppStart((value) => !value);
              }}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 text-sm font-semibold text-black transition hover:bg-emerald-200"
            >
              <MessageCircle size={16} />
              New WhatsApp Chat
            </button>

            <button
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
                key={item.value}
                onClick={() => setFilter(item.value)}
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
                    key={item.value}
                    disabled={disabled}
                    onClick={() => setChannel(item.value)}
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
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customer, phone, summary..."
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

      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5 md:p-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.04em]">
              {channel === "WHATSAPP" ? "WhatsApp Chats" : "Conversation Queue"}
            </h2>
            <p className="mt-2 text-sm text-white/40">
              {channel === "WHATSAPP"
                ? "Manage WhatsApp leads, replies, tasks and meeting requests inside the CRM."
                : "Pick a customer first. The full chat and call workspace opens below with more space."}
            </p>
          </div>

          <p className="text-sm text-white/35">
            Showing {conversations.length} conversation
            {conversations.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="mt-5">
          {loadingList ? (
            <LoadingState text="Loading conversations..." />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={<Inbox size={28} />}
              title="No conversations found"
              description={
                channel === "WHATSAPP"
                  ? "No WhatsApp chats yet. Click New WhatsApp Chat to start a CRM chat."
                  : "New customer conversations will appear here based on your selected filters."
              }
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {conversations.map((conversation) => (
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
      </section>

      {loadingDetail ? (
        <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-8">
          <LoadingState text="Opening conversation..." />
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

          <section className="grid gap-5 xl:grid-cols-2">
            <AiSummarySection conversation={selectedConversation} />
            <CustomerAndActionSection conversation={selectedConversation} />
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <PostCallIntelligenceSection
              analysis={
                selectedCall?.postCallAnalysis ||
                selectedConversation.latestCallAnalysis ||
                null
              }
            />
            {(selectedConversation.scheduledCall ||
            selectedConversation.leadRequirements) ? (
              <LeadRequirementsSection conversation={selectedConversation} />
            ) : (
              <ScheduledCallSection conversation={selectedConversation} />
            )}
          </section>

          {selectedConversation.scheduledCall &&
          selectedConversation.leadRequirements ? (
            <section className="grid gap-5 xl:grid-cols-2">
              <ScheduledCallSection conversation={selectedConversation} />
            </section>
          ) : null}

          <section className="grid gap-5 xl:grid-cols-2">
            <TaskBookingSection conversation={selectedConversation} />
            <TimelineSection conversation={selectedConversation} />
          </section>

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
            title="Select a conversation"
            description="The customer details, AI summary, tasks, timeline and full chat workspace will appear below."
          />
        </section>
      )}
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
      onClick={onClick}
      className={`w-full rounded-[28px] border p-5 text-left transition ${
        active
          ? "border-white bg-white text-black shadow-[0_24px_80px_rgba(255,255,255,0.10)]"
          : "border-white/10 bg-black/20 text-white hover:bg-white/[0.07]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`shrink-0 ${active ? "text-black/60" : "text-white/45"}`}
            >
              {getChannelIcon(conversation.channel)}
            </span>

            <p className="truncate text-lg font-semibold tracking-[-0.03em]">
              {conversation.customerName}
            </p>
          </div>

          <p
            className={`mt-1 truncate text-sm ${
              active ? "text-black/45" : "text-white/35"
            }`}
          >
            {conversation.channelLabel} · {formatTime(conversation.lastActivityAt)}
          </p>
        </div>

        <Badge tone={tone} active={active}>
          {formatEnum(conversation.displayStatus)}
        </Badge>
      </div>

      <p
        className={`mt-4 line-clamp-3 text-sm leading-6 ${
          active ? "text-black/65" : "text-white/48"
        }`}
      >
        {conversation.summary}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Badge
          active={active}
          tone={
            conversation.priority === "HIGH" ||
            conversation.priority === "CRITICAL"
              ? "danger"
              : "normal"
          }
        >
          {formatEnum(conversation.priority)}
        </Badge>

        <Badge
          active={active}
          tone={
            conversation.ownerType === "AI"
              ? "success"
              : conversation.ownerType === "UNASSIGNED"
                ? "warning"
                : "normal"
          }
        >
          Owner: {conversation.ownerLabel}
        </Badge>

        {conversation.delayed ? (
          <Badge active={active} tone="danger">
            Delayed
          </Badge>
        ) : null}
      </div>

      <div
        className={`mt-5 rounded-2xl p-4 ${
          active ? "bg-black/10" : "bg-black/20"
        }`}
      >
        <p className={`text-xs ${active ? "text-black/45" : "text-white/35"}`}>
          Next action
        </p>
        <p
          className={`mt-1 line-clamp-2 text-sm font-medium leading-6 ${
            active ? "text-black/75" : "text-white/65"
          }`}
        >
          {conversation.nextAction}
        </p>
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

          <p className="mt-3 text-sm text-white/40">
            {conversation.customerPhone || "No phone"} ·{" "}
            {conversation.customerEmail || "No email"} · Owner:{" "}
            {conversation.ownerLabel}
          </p>

          <p className="mt-4 max-w-4xl text-sm leading-7 text-white/55">
            {conversation.summary}
          </p>
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

function AiSummarySection({
  conversation,
}: {
  conversation: ConversationDetail;
}) {
  return (
    <PanelCard title="AI Summary" icon={<Sparkles size={18} />}>
      <p className="text-sm leading-7 text-white/58">{conversation.summary}</p>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <InfoBox label="Intent" value={conversation.intent || "Not detected"} />
        <InfoBox label="Lead score" value={`${conversation.aiConfidence || 0}%`} />
        <InfoBox label="Channel" value={conversation.channelLabel} />
        <InfoBox label="Status" value={formatEnum(conversation.displayStatus)} />
      </div>
    </PanelCard>
  );
}

function CustomerAndActionSection({
  conversation,
}: {
  conversation: ConversationDetail;
}) {
  return (
    <PanelCard title="Next Best Action" icon={<AlertTriangle size={18} />}>
      <div className="rounded-[26px] border border-amber-500/20 bg-amber-500/10 p-5">
        <p className="text-sm text-amber-100/60">Recommended next step</p>
        <p className="mt-2 text-lg font-semibold leading-7 text-amber-100">
          {conversation.nextAction}
        </p>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <InfoBox label="Customer" value={conversation.customerName} />
        <InfoBox label="Phone" value={conversation.customerPhone || "No phone"} />
        <InfoBox label="Email" value={conversation.customerEmail || "No email"} />
        <InfoBox label="Source" value={conversation.source || "Unknown"} />
      </div>
    </PanelCard>
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
}: {
  conversation: ConversationDetail;
}) {
  const requirements = conversation.leadRequirements;
  const booking = conversation.bookings?.[0];
  const meetingLabel =
    requirements?.meetingTime ||
    (booking?.dateTime ? formatDateTime(booking.dateTime) : null);
  const meetingSet = Boolean(requirements?.meetingScheduledAt || booking?.dateTime);
  const bullets = (requirements?.raw || [])
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .slice(-6);

  return (
    <PanelCard title="Lead Requirements" icon={<Sparkles size={18} />}>
      {requirements ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={requirements.captured ? "success" : "normal"}>
              {requirements.captured ? "Requirements captured" : "Waiting for details"}
            </Badge>
            <Badge tone={meetingSet ? "success" : "warning"}>
              {meetingSet ? "Meeting scheduled" : "Meeting time pending"}
            </Badge>
            <span className="text-xs text-white/35">
              via {requirements.source || conversation.channelLabel}
            </span>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-emerald-400/15 bg-gradient-to-br from-emerald-400/10 via-white/[0.03] to-transparent">
            <div className="border-b border-white/8 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">
                What the lead needs
              </p>
              <p className="mt-2 text-sm leading-7 text-white/72">
                {requirements.summary}
              </p>
            </div>

            {bullets.length > 0 ? (
              <ul className="space-y-2.5 px-5 py-4">
                {bullets.map((line, index) => (
                  <li
                    key={`${index}-${line.slice(0, 24)}`}
                    className="flex gap-3 text-sm leading-6 text-white/58"
                  >
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300/80" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div
            className={`rounded-[28px] border p-5 ${
              meetingSet
                ? "border-sky-400/20 bg-sky-400/10"
                : "border-amber-400/15 bg-amber-400/[0.07]"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 rounded-2xl border p-2.5 ${
                  meetingSet
                    ? "border-sky-300/20 bg-sky-300/10 text-sky-100"
                    : "border-amber-300/20 bg-amber-300/10 text-amber-100"
                }`}
              >
                {meetingSet ? <CalendarCheck size={18} /> : <Clock3 size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Meeting slot
                </p>
                <p className="mt-2 text-base font-semibold leading-7 text-white/85">
                  {meetingLabel || "Not set yet — AI will ask for availability"}
                </p>
                <p className="mt-1 text-xs leading-5 text-white/40">
                  {meetingSet
                    ? `${requirements.meetingStatus || booking?.status || "REQUESTED"} · visible on Bookings / dashboard`
                    : "Shows here only after the caller gives a day and time and a booking is created."}
                </p>
                {requirements.bookingTitle ? (
                  <p className="mt-3 truncate text-xs text-white/45">
                    {requirements.bookingTitle}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <EmptyMini text="After the AI call, collected requirements will appear here." />
      )}
    </PanelCard>
  );
}

function PostCallIntelligenceSection({
  analysis,
}: {
  analysis: PostCallAnalysisView | null | undefined;
}) {
  const details = analysis?.requirementDetails || null;
  const capabilities = details?.desiredCapabilities || [];
  const objections = details?.objections || [];
  const status = analysis?.analysisStatus || "NONE";

  return (
    <PanelCard title="Customer Intent" icon={<Sparkles size={18} />}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={
              status === "COMPLETED"
                ? intentTone(analysis?.intentLevel)
                : status === "FAILED"
                  ? "danger"
                  : status === "PENDING" || status === "PROCESSING"
                    ? "warning"
                    : "muted"
            }
          >
            {status === "COMPLETED"
              ? intentLevelLabel(analysis?.intentLevel)
              : analysisStatusLabel(status)}
          </Badge>
          {status === "COMPLETED" && analysis?.intentScore != null ? (
            <Badge tone="normal">Score {analysis.intentScore}/100</Badge>
          ) : null}
          {status === "COMPLETED" && analysis?.confidence != null ? (
            <span className="text-xs text-white/35">
              Confidence {Math.round(analysis.confidence * 100)}%
            </span>
          ) : null}
        </div>

        {status === "COMPLETED" && analysis?.requirementSummary ? (
          <div className="rounded-[28px] border border-cyan-400/15 bg-cyan-400/10 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
              Lead requirement
            </p>
            <p className="mt-2 text-sm leading-7 text-white/72">
              {analysis.requirementSummary}
            </p>
          </div>
        ) : null}

        {status === "COMPLETED" && capabilities.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {capabilities.slice(0, 8).map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/65"
              >
                {item}
              </span>
            ))}
          </div>
        ) : null}

        {status === "COMPLETED" ? (
          <div className="grid gap-3 md:grid-cols-2">
            {details?.timelineSignal ? (
              <InfoBox label="Timeline" value={details.timelineSignal} />
            ) : null}
            {details?.budgetSignal ? (
              <InfoBox label="Budget signal" value={details.budgetSignal} />
            ) : null}
            {details?.requestedNextStep ? (
              <InfoBox label="Requested next step" value={details.requestedNextStep} />
            ) : null}
            {details?.primaryNeed ? (
              <InfoBox label="Primary need" value={details.primaryNeed} />
            ) : null}
          </div>
        ) : null}

        {status === "COMPLETED" && objections.length > 0 ? (
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-white/35">
              Objections
            </p>
            <ul className="space-y-2">
              {objections.slice(0, 5).map((item) => (
                <li key={item} className="text-sm leading-6 text-white/58">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {status === "PENDING" || status === "PROCESSING" ? (
          <EmptyMini text="Call ended. Intent analysis will appear shortly." />
        ) : null}
        {status === "FAILED" ? (
          <EmptyMini text="Analysis unavailable. No fabricated score was stored." />
        ) : null}
        {status === "INSUFFICIENT_DATA" ? (
          <EmptyMini text="Not enough customer conversation to estimate intent." />
        ) : null}
        {status === "NONE" ? (
          <EmptyMini text="Post-call intent appears after a completed AI voice call." />
        ) : null}
      </div>
    </PanelCard>
  );
}

function TaskBookingSection({
  conversation,
}: {
  conversation: ConversationDetail;
}) {
  return (
    <PanelCard title="Tasks & Bookings" icon={<Clock3 size={18} />}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-semibold text-white/65">Tasks</p>

          {conversation.tasks.length === 0 ? (
            <EmptyMini text="No tasks created yet." />
          ) : (
            <div className="space-y-3">
              {conversation.tasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium leading-6">{task.title}</p>
                    <Badge tone={task.delayed ? "danger" : "normal"}>
                      {formatEnum(task.status)}
                    </Badge>
                  </div>

                  <p className="mt-2 text-xs leading-5 text-white/35">
                    {task.assignedUser?.name || task.owner || "Unassigned"} ·{" "}
                    {formatDateTime(task.dueAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold text-white/65">Bookings</p>

          {conversation.bookings.length === 0 ? (
            <EmptyMini text="No bookings created yet." />
          ) : (
            <div className="space-y-3">
              {conversation.bookings.slice(0, 5).map((booking) => (
                <div
                  key={booking.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <p className="text-sm font-medium leading-6">
                    {booking.title}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-white/35">
                    {formatDateTime(booking.dateTime)} ·{" "}
                    {formatEnum(booking.status)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PanelCard>
  );
}

function TimelineSection({
  conversation,
}: {
  conversation: ConversationDetail;
}) {
  return (
    <PanelCard title="Timeline" icon={<Clock3 size={18} />}>
      {conversation.timeline.length === 0 ? (
        <EmptyMini text="No timeline yet." />
      ) : (
        <div className="space-y-4">
          {conversation.timeline.slice(0, 8).map((item) => (
            <div key={`${item.type}-${item.id}`} className="border-l border-white/10 pl-4">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-white/38">
                {item.description}
              </p>
              <p className="mt-1 text-xs text-white/25">
                {formatTime(item.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
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
      className="flex min-h-[calc(100vh-150px)] flex-col overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.04]"
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
                : "Large workspace for the real conversation. Reply, follow up, create tasks, or book meetings from here."}
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

      <form
        onSubmit={onSendReply}
        className="shrink-0 border-t border-white/10 bg-black/25 p-4 md:p-5"
      >
        <div className="mx-auto flex max-w-5xl gap-3 rounded-[28px] border border-white/10 bg-black/35 p-2">
          <input
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder={
              conversation.channel === "AI_CALL"
                ? "Add internal note or WhatsApp follow-up..."
                : conversation.channel === "WHATSAPP"
                  ? "Type a WhatsApp reply from the CRM..."
                  : "Type a human reply..."
            }
            className="h-12 min-w-0 flex-1 bg-transparent px-4 text-sm outline-none placeholder:text-white/25"
          />

          <button
            disabled={sending || !reply.trim()}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
            Send
          </button>
        </div>
      </form>
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
  if (!call) {
    return (
      <EmptyState
        icon={<Phone size={30} />}
        title="No call record found"
        description="Call information will appear here when Twilio sends call data to the backend."
      />
    );
  }

  const transcript =
    call.transcript ||
    call.computedTranscript ||
    conversation.computedTranscript ||
    buildTranscriptFromMessages(conversation.messages) ||
    "";

  const recordingPlaybackUrl = getRecordingPlaybackUrl(call);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="rounded-[30px] border border-white/10 bg-black/20 p-6">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
          <div>
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Phone size={16} />
              {call.direction || "INBOUND"} Call
            </div>

            <h3 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
              Call with {conversation.customerName}
            </h3>

            <p className="mt-3 text-sm text-white/40">
              {call.phone || conversation.customerPhone} · {formatEnum(call.status)} ·{" "}
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
              {isLiveCallStatus(call.status) ? "Call ongoing" : "Call ended"}
            </Badge>
            <Badge tone="normal">{formatEnum(call.status)}</Badge>
            {call.recordingUrl ? <Badge tone="success">Recording saved</Badge> : null}
            {transcript ? <Badge tone="success">Transcript saved</Badge> : null}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-[30px] border border-white/10 bg-black/20 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
            <Headphones size={17} />
            Recording
          </div>

          {recordingPlaybackUrl ? (
            <div className="mt-5 space-y-4">
              <AuthenticatedAudioPlayer url={recordingPlaybackUrl} />
            </div>
          ) : (
            <p className="mt-5 text-sm leading-6 text-white/40">
              No recording saved for this call yet. When Twilio sends the recording callback, it will appear here.
            </p>
          )}
        </div>

        <div className="rounded-[30px] border border-white/10 bg-black/20 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
            <Sparkles size={17} />
            Call outcome
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <InfoBox label="Intent" value={conversation.intent || "Not detected"} />
            <InfoBox label="Priority" value={formatEnum(conversation.priority)} />
            <InfoBox label="Next action" value={conversation.nextAction} />
            <InfoBox label="Owner" value={conversation.ownerLabel} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <InfoBox label="Provider" value={call.provider || "Twilio"} />
        <InfoBox label="Provider call ID" value={call.providerCallId || "Not available"} />
        <InfoBox label="Recording SID" value={call.recordingSid || "Not available"} />
        <InfoBox label="Recording status" value={call.recordingStatus || "Not available"} />
        <InfoBox
          label="Recording duration"
          value={
            call.recordingDurationSeconds
              ? formatDuration(call.recordingDurationSeconds)
              : "Not available"
          }
        />
        <InfoBox label="Started" value={formatDateTime(call.startedAt || call.createdAt)} />
      </div>

      {conversation.calls.length > 1 ? (
        <div className="rounded-[30px] border border-white/10 bg-black/20 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
            <Clock3 size={17} />
            Call history
          </div>

          <div className="mt-5 space-y-3">
            {conversation.calls.map((item) => (
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
                      {formatDateTime(item.createdAt)} · {formatDuration(item.durationSeconds)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
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
                    {item.recordingUrl ? <Badge tone="success">Recording</Badge> : null}
                    {item.transcript ? <Badge tone="success">Transcript</Badge> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-[30px] border border-white/10 bg-black/20 p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
          <Mic2 size={17} />
          Transcript
        </div>

        <p className="mt-5 whitespace-pre-wrap text-sm leading-8 text-white/60">
          {transcript || "No transcript saved for this call yet."}
        </p>
      </div>
    </div>
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