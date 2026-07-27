import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  FileText,
  Filter,
  Headphones,
  Loader2,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  UserRound,
  XCircle,
} from "lucide-react";
import { API_BASE_URL, apiFetch } from "./lib/api";

type AiCallLanguage = "AUTO" | "ENGLISH" | "HINDI" | "GUJARATI";

type ConversationStatus =
  "NEW" | "IN_PROGRESS" | "FOLLOW_UP" | "CONVERTED" | "HUMAN_REQUIRED" | "LOST";

type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type CallStatus =
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
type MessageSender = "CUSTOMER" | "AI" | "HUMAN";

type Customer = {
  id: string;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type Call = {
  id: string;
  conversationId: string;
  phone: string;
  durationSeconds: number;
  transcript?: string | null;
  status: CallStatus;
  provider?: string | null;
  providerCallId?: string | null;
  direction?: string | null;
  recordingUrl?: string | null;
  recordingMediaUrl?: string | null;
  recordingSid?: string | null;
  recordingStatus?: string | null;
  recordingDurationSeconds?: number | null;
  recordingChannels?: number | null;
  recordingSource?: string | null;
  recordingAvailableAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  failureReason?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt?: string;
};

type Message = {
  id: string;
  senderType: MessageSender;
  body: string;
  provider?: string | null;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  owner?: string | null;
  aiNotes?: string | null;
  dueAt?: string | null;
  createdAt: string;
  updatedAt?: string;
};

type Booking = {
  id: string;
  title: string;
  status: string;
  dateTime?: string | null;
  createdAt: string;
  updatedAt?: string;
};

type OutboundMessage = {
  id: string;
  channel: string;
  toPhone: string;
  body: string;
  status: string;
  errorMessage?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  createdAt: string;
};

type CallConversation = {
  id: string;
  channel: "AI_CALL";
  status: ConversationStatus;
  priority: Priority;
  intent?: string | null;
  aiSummary?: string | null;
  nextAction?: string | null;
  aiConfidence?: number | null;
  humanNeeded?: boolean;
  bookingCreated?: boolean;
  provider?: string | null;
  providerThreadId?: string | null;
  providerContactId?: string | null;
  providerExternalId?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  createdAt: string;
  updatedAt: string;
  computedTranscript?: string;
  latestCall?: Call | null;
  customer?: Customer | null;
  calls: Call[];
  messages: Message[];
  tasks: Task[];
  bookings: Booking[];
  outboundMessages?: OutboundMessage[];
  _count?: {
    messages: number;
    tasks: number;
    calls: number;
    bookings: number;
  };
};

type CallsSummary = {
  totalConversations: number;
  humanRequired: number;
  followUpNeeded: number;
  totalCalls: number;
  live: number;
  completed: number;
  missed: number;
  transferred: number;
  recorded: number;
  transcribed: number;
  totalDurationSeconds: number;
  totalDurationMinutes: number;
  averageDurationSeconds: number;
  total?: number;
};

type CallsResponse = {
  conversations: CallConversation[];
  latestCalls?: Array<Call & { conversation?: CallConversation }>;
  summary: Partial<CallsSummary>;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type CallDetailResponse = {
  conversation: CallConversation;
};

type TaskResponse = {
  message: string;
  task: Task;
};
type OutboundAiCallResponse = {
  message: string;
  customer: Customer;
  conversation: CallConversation;
  call: Call;
  providerCallId?: string | null;
};

const statuses: {
  label: string;
  value: "ALL" | ConversationStatus;
}[] = [
  { label: "All status", value: "ALL" },
  { label: "New", value: "NEW" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Follow up", value: "FOLLOW_UP" },
  { label: "Converted", value: "CONVERTED" },
  { label: "Human required", value: "HUMAN_REQUIRED" },
  { label: "Lost", value: "LOST" },
];

const callStatuses: {
  label: string;
  value: "ALL" | CallStatus;
}[] = [
  { label: "All calls", value: "ALL" },
  { label: "Ringing", value: "RINGING" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Live", value: "LIVE" },
  { label: "Completed", value: "COMPLETED" },
  { label: "No answer", value: "NO_ANSWER" },
  { label: "Busy", value: "BUSY" },
  { label: "Canceled", value: "CANCELED" },
  { label: "Failed", value: "FAILED" },
  { label: "Missed", value: "MISSED" },
  { label: "Transferred", value: "TRANSFERRED" },
];

const recordingFilters = [
  { label: "All recordings", value: "ALL" },
  { label: "With recording", value: "WITH_RECORDING" },
  { label: "No recording", value: "WITHOUT_RECORDING" },
];

const emptySummary: CallsSummary = {
  totalConversations: 0,
  humanRequired: 0,
  followUpNeeded: 0,
  totalCalls: 0,
  live: 0,
  completed: 0,
  missed: 0,
  transferred: 0,
  recorded: 0,
  transcribed: 0,
  totalDurationSeconds: 0,
  totalDurationMinutes: 0,
  averageDurationSeconds: 0,
};

export default function CallsPage() {
  const [conversations, setConversations] = useState<CallConversation[]>([]);
  const [latestCalls, setLatestCalls] = useState<
    Array<Call & { conversation?: CallConversation }>
  >([]);

  const [selectedId, setSelectedId] = useState("");
  const [selectedConversation, setSelectedConversation] =
    useState<CallConversation | null>(null);

  const [summary, setSummary] = useState<CallsSummary>(emptySummary);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | ConversationStatus>("ALL");
  const [callStatus, setCallStatus] = useState<"ALL" | CallStatus>("ALL");
  const [recording, setRecording] = useState("ALL");

  const [callbackTitle, setCallbackTitle] = useState("Call customer back");
  const [callbackDescription, setCallbackDescription] = useState(
    "Customer needs a human callback based on AI call conversation.",
  );

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [working, setWorking] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [outboundName, setOutboundName] = useState("");
  const [outboundPhone, setOutboundPhone] = useState("");
  const [outboundPurpose, setOutboundPurpose] = useState(
    "Collect website requirements, schedule a meeting, and save summary in CRM.",
  );
  const [outboundNotes, setOutboundNotes] = useState(
    "Ask business type, website type, required pages/features, timeline, budget and preferred meeting time.",
  );
  const [outboundLanguage, setOutboundLanguage] =
    useState<AiCallLanguage>("AUTO");

  async function loadCalls(nextSelectedId?: string) {
    try {
      setError("");
      setLoadingList(true);

      const params = new URLSearchParams();

      if (status !== "ALL") params.set("status", status);
      if (callStatus !== "ALL") params.set("callStatus", callStatus);
      if (recording !== "ALL") params.set("recording", recording);
      if (search.trim()) params.set("search", search.trim());

      const query = params.toString();

      const data = await apiFetch<CallsResponse>(
        `/api/calls${query ? `?${query}` : ""}`,
      );

      const nextSummary = {
        ...emptySummary,
        ...data.summary,
        totalConversations:
          data.summary.totalConversations ?? data.summary.total ?? 0,
      };

      setConversations(data.conversations || []);
      setLatestCalls(data.latestCalls || []);
      setSummary(nextSummary);

      const currentStillExists = data.conversations?.some(
        (conversation) => conversation.id === selectedId,
      );

      const idToOpen =
        nextSelectedId ||
        (currentStillExists ? selectedId : "") ||
        data.conversations?.[0]?.id ||
        "";

      if (idToOpen) {
        setSelectedId(idToOpen);
        await loadCallDetail(idToOpen);
      } else {
        setSelectedId("");
        setSelectedConversation(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calls");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadCallDetail(id: string) {
    try {
      setLoadingDetail(true);

      const data = await apiFetch<CallDetailResponse>(`/api/calls/${id}`);

      setSelectedConversation(data.conversation);

      const transcript =
        data.conversation.latestCall?.transcript ||
        data.conversation.computedTranscript ||
        data.conversation.aiSummary ||
        data.conversation.lastMessage ||
        "";

      setCallbackDescription(
        transcript ||
          "Customer needs a human callback based on AI call conversation.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load call");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function selectConversation(id: string) {
    setSelectedId(id);
    await loadCallDetail(id);
  }

  async function refreshCurrent() {
    await loadCalls(selectedConversation?.id || selectedId);
  }

  async function createCallbackTask(event: FormEvent) {
    event.preventDefault();

    if (!selectedConversation || !callbackTitle.trim()) return;

    try {
      setWorking(true);
      setError("");
      setNotice("");

      await apiFetch<TaskResponse>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          customerId: selectedConversation.customer?.id,
          title: callbackTitle.trim(),
          description: callbackDescription.trim() || undefined,
          priority:
            selectedConversation.priority === "LOW"
              ? "MEDIUM"
              : selectedConversation.priority,
        }),
      });

      setNotice("Callback task created for staff.");
      await refreshCurrent();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create callback task",
      );
    } finally {
      setWorking(false);
    }
  }

  async function markHumanRequired() {
    if (!selectedConversation) return;

    try {
      setWorking(true);
      setNotice("");
      setError("");

      await apiFetch(`/api/calls/${selectedConversation.id}/human-required`, {
        method: "POST",
        body: JSON.stringify({
          reason:
            callbackDescription.trim() ||
            "Human follow-up required after AI voice call.",
        }),
      });

      setNotice(
        "Conversation marked human required and follow-up task created.",
      );
      await refreshCurrent();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to mark human follow-up",
      );
    } finally {
      setWorking(false);
    }
  }

  async function markResolved() {
    if (!selectedConversation) return;

    try {
      setWorking(true);
      setNotice("");
      setError("");

      await apiFetch(`/api/calls/${selectedConversation.id}/resolve`, {
        method: "POST",
      });

      setNotice("Call conversation marked resolved.");
      await refreshCurrent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve call");
    } finally {
      setWorking(false);
    }
  }

  async function startOutboundAiCall(event: FormEvent) {
    event.preventDefault();

    if (!outboundPhone.trim()) {
      setError("Phone number is required to start an AI call.");
      return;
    }

    try {
      setWorking(true);
      setNotice("");
      setError("");

      const data = await apiFetch<OutboundAiCallResponse>(
        "/api/calls/outbound-ai",
        {
          method: "POST",
          body: JSON.stringify({
            name: outboundName.trim() || null,
            phone: outboundPhone.trim(),
            purpose: outboundPurpose.trim() || undefined,
            notes: outboundNotes.trim() || undefined,
            preferredLanguage: outboundLanguage,
          }),
        },
      );

      setNotice(
        `AI call started for ${data.customer.fullName || data.customer.phone || outboundPhone.trim()}.`,
      );
      setOutboundName("");
      setOutboundPhone("");

      await loadCalls(data.conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start AI call");
    } finally {
      setWorking(false);
    }
  }

  function useSelectedCustomerForOutbound() {
    if (!selectedConversation) return;

    setOutboundName(selectedConversation.customer?.fullName || "");
    setOutboundPhone(
      selectedConversation.customer?.phone ||
        selectedConversation.latestCall?.phone ||
        selectedConversation.calls?.[0]?.phone ||
        "",
    );
    setOutboundPurpose(
      selectedConversation.nextAction ||
        selectedConversation.intent ||
        "Collect website requirements, schedule a meeting, and save summary in CRM.",
    );
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCalls();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search, status, callStatus, recording]);

  const selectedCall = useMemo(() => {
    return (
      selectedConversation?.latestCall ||
      selectedConversation?.calls?.[0] ||
      null
    );
  }, [selectedConversation]);

  const latestTranscript = useMemo(() => {
    if (selectedCall?.transcript) return selectedCall.transcript;
    if (selectedConversation?.computedTranscript) {
      return selectedConversation.computedTranscript;
    }

    if (selectedConversation?.messages?.length) {
      return selectedConversation.messages
        .map((message) => {
          const speaker =
            message.senderType === "CUSTOMER"
              ? "Customer"
              : message.senderType === "AI"
                ? "AI"
                : "Human";

          return `${speaker}: ${message.body}`;
        })
        .join("\n");
    }

    return "";
  }, [selectedCall, selectedConversation]);

  return (
    <section className="grid h-[calc(100vh-112px)] min-h-[720px] gap-4 xl:grid-cols-[460px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        <div className="shrink-0 border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] font-medium text-cyan-200">
                <PhoneCall size={13} />
                Twilio Realtime Voice
              </div>

              <h1 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">
                Calls Ops
              </h1>
              <p className="mt-1 text-sm text-white/40">
                AI calls, recordings, transcripts and handovers
              </p>
            </div>

            <button
              onClick={() => loadCalls()}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/60 hover:text-white"
            >
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            <MiniCount label="Convos" value={summary.totalConversations} />
            <MiniCount label="Calls" value={summary.totalCalls} />
            <MiniCount label="Live" value={summary.live} />
            <MiniCount label="Missed" value={summary.missed} />
          </div>

          <div className="mt-2 grid grid-cols-4 gap-2">
            <MiniCount label="Done" value={summary.completed} />
            <MiniCount label="Human" value={summary.humanRequired} />
            <MiniCount label="Record" value={summary.recorded} />
            <MiniCount label="Mins" value={summary.totalDurationMinutes} />
          </div>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={18} className="text-white/35" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone, transcript..."
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>

          <div className="mt-3 grid gap-2">
            <FilterSelect
              icon={<Filter size={16} />}
              value={status}
              onChange={(value) =>
                setStatus(value as "ALL" | ConversationStatus)
              }
              options={statuses}
            />

            <FilterSelect
              icon={<PhoneCall size={16} />}
              value={callStatus}
              onChange={(value) => setCallStatus(value as "ALL" | CallStatus)}
              options={callStatuses}
            />

            <FilterSelect
              icon={<Headphones size={16} />}
              value={recording}
              onChange={setRecording}
              options={recordingFilters}
            />
          </div>

          <OutboundAiCallBox
            name={outboundName}
            phone={outboundPhone}
            purpose={outboundPurpose}
            notes={outboundNotes}
            language={outboundLanguage}
            working={working}
            onNameChange={setOutboundName}
            onPhoneChange={setOutboundPhone}
            onPurposeChange={setOutboundPurpose}
            onNotesChange={setOutboundNotes}
            onLanguageChange={setOutboundLanguage}
            onSubmit={startOutboundAiCall}
            onUseSelected={
              selectedConversation ? useSelectedCustomerForOutbound : undefined
            }
          />

          {notice ? (
            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loadingList ? (
            <LoadingBox text="Loading calls..." />
          ) : conversations.length === 0 ? (
            <EmptyBox
              icon={<PhoneCall size={30} />}
              title="No AI calls yet"
              text="Twilio AI call webhook conversations will appear here after the first call is saved."
            />
          ) : (
            <div className="space-y-2">
              {conversations.map((conversation) => (
                <CallConversationCard
                  key={conversation.id}
                  conversation={conversation}
                  active={selectedId === conversation.id}
                  onClick={() => selectConversation(conversation.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        {!selectedConversation ? (
          <EmptyBox
            icon={<PhoneCall size={34} />}
            title="Select an AI call"
            text="Read recording, transcript, call status, AI summary, tasks and customer details."
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <CallHeader
              conversation={selectedConversation}
              call={selectedCall}
              onHumanRequired={markHumanRequired}
              onResolved={markResolved}
              disabled={working}
            />

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_410px]">
                <section className="space-y-5">
                  <RecordingPanel call={selectedCall} />

                  <Panel
                    title="Call transcript"
                    icon={<Headphones size={20} />}
                  >
                    {loadingDetail ? (
                      <div className="flex items-center gap-2 text-sm text-white/40">
                        <Loader2 className="animate-spin" size={16} />
                        Loading call transcript...
                      </div>
                    ) : latestTranscript ? (
                      <p className="whitespace-pre-wrap text-sm leading-7 text-white/60">
                        {latestTranscript}
                      </p>
                    ) : (
                      <p className="text-sm text-white/40">
                        No transcript saved yet. Once OpenAI Realtime returns
                        messages, they will appear here.
                      </p>
                    )}
                  </Panel>

                  <Panel
                    title="Conversation messages"
                    icon={<FileText size={20} />}
                  >
                    {selectedConversation.messages?.length ? (
                      <div className="space-y-3">
                        {selectedConversation.messages.map((message) => (
                          <MessageRow key={message.id} message={message} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-white/40">
                        No conversation messages saved.
                      </p>
                    )}
                  </Panel>

                  <Panel title="Callback task" icon={<Phone size={20} />}>
                    <form onSubmit={createCallbackTask} className="space-y-3">
                      <input
                        value={callbackTitle}
                        onChange={(event) =>
                          setCallbackTitle(event.target.value)
                        }
                        className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25"
                        placeholder="Task title"
                      />

                      <textarea
                        value={callbackDescription}
                        onChange={(event) =>
                          setCallbackDescription(event.target.value)
                        }
                        className="min-h-28 w-full resize-none rounded-3xl border border-white/10 bg-black/25 px-5 py-4 text-sm leading-7 outline-none placeholder:text-white/25"
                        placeholder="Task description"
                      />

                      <div className="grid gap-2 md:grid-cols-2">
                        <button
                          type="submit"
                          disabled={working || !callbackTitle.trim()}
                          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {working ? (
                            <Loader2 className="animate-spin" size={16} />
                          ) : (
                            <Send size={16} />
                          )}
                          Create task
                        </button>

                        <button
                          type="button"
                          onClick={markHumanRequired}
                          disabled={working}
                          className="h-12 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 text-sm font-semibold text-amber-100 disabled:opacity-50"
                        >
                          Mark human required
                        </button>
                      </div>
                    </form>
                  </Panel>
                </section>

                <aside className="space-y-5">
                  <Panel title="AI summary" icon={<Bot size={20} />}>
                    <p className="text-sm leading-7 text-white/55">
                      {selectedConversation.aiSummary ||
                        "No AI summary available."}
                    </p>
                  </Panel>

                  <Panel title="Next action" icon={<ShieldAlert size={20} />}>
                    <p className="text-sm leading-7 text-white/55">
                      {selectedConversation.nextAction ||
                        "No next action saved."}
                    </p>
                  </Panel>

                  <Panel title="Customer" icon={<UserRound size={20} />}>
                    <InfoRow
                      label="Name"
                      value={
                        selectedConversation.customer?.fullName || "Unknown"
                      }
                    />
                    <InfoRow
                      label="Phone"
                      value={
                        selectedConversation.customer?.phone ||
                        selectedCall?.phone ||
                        "-"
                      }
                    />
                    <InfoRow
                      label="Email"
                      value={selectedConversation.customer?.email || "-"}
                    />
                    <InfoRow
                      label="Source"
                      value={selectedConversation.customer?.source || "-"}
                    />
                  </Panel>

                  <Panel title="Call details" icon={<PhoneCall size={20} />}>
                    <InfoRow
                      label="Call status"
                      value={formatEnum(selectedCall?.status)}
                    />
                    <InfoRow
                      label="Provider"
                      value={
                        selectedCall?.provider ||
                        selectedConversation.provider ||
                        "-"
                      }
                    />
                    <InfoRow
                      label="Provider call ID"
                      value={selectedCall?.providerCallId || "-"}
                    />
                    <InfoRow
                      label="Direction"
                      value={selectedCall?.direction || "INBOUND"}
                    />
                    <InfoRow
                      label="Duration"
                      value={formatDuration(selectedCall?.durationSeconds || 0)}
                    />
                    <InfoRow
                      label="Average duration"
                      value={formatDuration(summary.averageDurationSeconds)}
                    />
                    <InfoRow
                      label="Recording status"
                      value={selectedCall?.recordingStatus || "-"}
                    />
                    <InfoRow
                      label="Recording SID"
                      value={selectedCall?.recordingSid || "-"}
                    />
                    <InfoRow
                      label="Created"
                      value={
                        selectedCall?.createdAt
                          ? formatDateTime(selectedCall.createdAt)
                          : "-"
                      }
                    />
                    <InfoRow
                      label="Failure reason"
                      value={selectedCall?.failureReason || "-"}
                    />
                  </Panel>

                  <Panel title="Linked work" icon={<CalendarCheck size={20} />}>
                    <InfoRow
                      label="Messages"
                      value={String(selectedConversation.messages?.length || 0)}
                    />
                    <InfoRow
                      label="Calls"
                      value={String(selectedConversation.calls?.length || 0)}
                    />
                    <InfoRow
                      label="Tasks"
                      value={String(selectedConversation.tasks?.length || 0)}
                    />
                    <InfoRow
                      label="Bookings"
                      value={String(selectedConversation.bookings?.length || 0)}
                    />
                    <InfoRow
                      label="Outbound records"
                      value={String(
                        selectedConversation.outboundMessages?.length || 0,
                      )}
                    />
                  </Panel>

                  <Panel title="Latest calls" icon={<Clock3 size={20} />}>
                    {latestCalls.length === 0 ? (
                      <p className="text-sm text-white/40">
                        No latest calls returned.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {latestCalls.slice(0, 5).map((call) => (
                          <button
                            key={call.id}
                            type="button"
                            onClick={() =>
                              call.conversationId
                                ? selectConversation(call.conversationId)
                                : undefined
                            }
                            className="w-full rounded-2xl border border-white/10 bg-black/25 p-4 text-left hover:bg-white/[0.04]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {call.conversation?.customer?.fullName ||
                                    call.phone ||
                                    "Unknown"}
                                </p>
                                <p className="mt-1 text-xs text-white/35">
                                  {formatDateTime(call.createdAt)}
                                </p>
                              </div>

                              <CallStatusBadge status={call.status} />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </Panel>
                </aside>
              </div>
            </div>
          </div>
        )}
      </main>
    </section>
  );
}

function CallConversationCard({
  conversation,
  active,
  onClick,
}: {
  conversation: CallConversation;
  active: boolean;
  onClick: () => void;
}) {
  const call = conversation.latestCall || conversation.calls?.[0];
  const hasRecording = Boolean(call?.recordingUrl);
  const hasTranscript = Boolean(
    call?.transcript || conversation.computedTranscript,
  );

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-3xl border p-4 text-left transition ${
        active
          ? "border-white/20 bg-white/[0.08]"
          : "border-white/10 bg-black/15 hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {conversation.customer?.fullName || "Unknown Customer"}
          </p>
          <p className="mt-1 truncate text-xs text-white/35">
            {conversation.customer?.phone || call?.phone || "No phone"}
          </p>
        </div>

        <ConversationStatusBadge status={conversation.status} />
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-5 text-white/55">
        {conversation.aiSummary ||
          conversation.lastMessage ||
          call?.transcript ||
          conversation.computedTranscript ||
          "No transcript yet"}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {call ? <CallStatusBadge status={call.status} /> : null}
        <PriorityBadge priority={conversation.priority} />

        {conversation.humanNeeded ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-100/70">
            <AlertTriangle size={12} />
            Human
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-100/70">
            <Bot size={12} />
            AI
          </span>
        )}

        {hasRecording ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100/70">
            <Headphones size={12} />
            Recording
          </span>
        ) : null}

        {hasTranscript ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/50">
            <FileText size={12} />
            Transcript
          </span>
        ) : null}
      </div>
    </button>
  );
}

function CallHeader({
  conversation,
  call,
  onHumanRequired,
  onResolved,
  disabled,
}: {
  conversation: CallConversation;
  call: Call | null;
  onHumanRequired: () => void;
  onResolved: () => void;
  disabled: boolean;
}) {
  return (
    <div className="shrink-0 border-b border-white/10 p-5">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/55">
              <PhoneCall size={13} />
              AI Call
            </span>

            <ConversationStatusBadge status={conversation.status} />

            {call ? <CallStatusBadge status={call.status} /> : null}

            <PriorityBadge priority={conversation.priority} />

            {call?.recordingUrl ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100/75">
                <Headphones size={13} />
                Recording saved
              </span>
            ) : null}
          </div>

          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
            {conversation.customer?.fullName || "Unknown Customer"}
          </h2>

          <p className="mt-2 text-sm text-white/45">
            {conversation.customer?.phone || call?.phone || "No phone"} ·{" "}
            {conversation.intent || "No intent"} ·{" "}
            {formatRelative(conversation.updatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          <button
            type="button"
            onClick={onHumanRequired}
            disabled={disabled}
            className="h-11 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 text-sm font-semibold text-amber-100 disabled:opacity-50"
          >
            Human follow-up
          </button>

          <button
            type="button"
            onClick={onResolved}
            disabled={disabled}
            className="h-11 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-100 disabled:opacity-50"
          >
            Mark resolved
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <SmallStat
          icon={<Bot size={15} />}
          label="AI confidence"
          value={`${conversation.aiConfidence || 0}%`}
        />
        <SmallStat
          icon={<Clock3 size={15} />}
          label="Duration"
          value={formatDuration(call?.durationSeconds || 0)}
        />
        <SmallStat
          icon={<Headphones size={15} />}
          label="Recording"
          value={call?.recordingUrl ? "Saved" : "Missing"}
        />
        <SmallStat
          icon={<FileText size={15} />}
          label="Tasks"
          value={String(conversation.tasks?.length || 0)}
        />
      </div>
    </div>
  );
}

function RecordingPanel({ call }: { call: Call | null }) {
  const audioUrl = getAudioUrl(call);

  return (
    <Panel title="Recording" icon={<Headphones size={20} />}>
      {!call ? (
        <p className="text-sm text-white/40">
          No call row exists yet for this conversation.
        </p>
      ) : audioUrl ? (
        <div className="space-y-4">
          <AuthenticatedAudioPlayer url={audioUrl} />

          <div className="grid gap-3 md:grid-cols-2">
            <InfoRow
              label="Recording status"
              value={call.recordingStatus || "-"}
            />
            <InfoRow
              label="Recording duration"
              value={
                call.recordingDurationSeconds
                  ? formatDuration(call.recordingDurationSeconds)
                  : "-"
              }
            />
            <InfoRow
              label="Recording source"
              value={call.recordingSource || "-"}
            />
            <InfoRow
              label="Available"
              value={
                call.recordingAvailableAt
                  ? formatDateTime(call.recordingAvailableAt)
                  : "-"
              }
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-white/40">
            Recording is not ready yet. Twilio sends the recording after the
            call finishes processing, then it appears here automatically.
          </p>
          <p className="text-xs text-white/30">
            Current status: {call.recordingStatus || "waiting for callback"}
          </p>
        </div>
      )}
    </Panel>
  );
}

function OutboundAiCallBox({
  name,
  phone,
  purpose,
  notes,
  language,
  working,
  onNameChange,
  onPhoneChange,
  onPurposeChange,
  onNotesChange,
  onLanguageChange,
  onSubmit,
  onUseSelected,
}: {
  name: string;
  phone: string;
  purpose: string;
  notes: string;
  language: AiCallLanguage;
  working: boolean;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onPurposeChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onLanguageChange: (value: AiCallLanguage) => void;
  onSubmit: (event: FormEvent) => void;
  onUseSelected?: () => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 rounded-[26px] border border-cyan-400/15 bg-cyan-500/[0.06] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium text-cyan-100">
            <PhoneCall size={13} />
            Start AI outbound call
          </div>
          <p className="mt-2 text-xs leading-5 text-white/40">
            Enter a client number. AI will call, collect requirements, create
            meeting/task and save summary plus recording.
          </p>
        </div>

        {onUseSelected ? (
          <button
            type="button"
            onClick={onUseSelected}
            className="shrink-0 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-white/55 hover:text-white"
          >
            Use selected
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2">
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          className="h-11 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25"
          placeholder="Client name"
        />
        <input
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value)}
          className="h-11 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25"
          placeholder="Phone with country code, e.g. +91..."
        />
        <select
          value={language}
          onChange={(event) =>
            onLanguageChange(event.target.value as AiCallLanguage)
          }
          className="h-11 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
        >
          <option value="AUTO" className="bg-[#05070d]">
            Auto-detect language
          </option>
          <option value="ENGLISH" className="bg-[#05070d]">
            English
          </option>
          <option value="HINDI" className="bg-[#05070d]">
            Hindi
          </option>
          <option value="GUJARATI" className="bg-[#05070d]">
            Gujarati
          </option>
        </select>
        <textarea
          value={purpose}
          onChange={(event) => onPurposeChange(event.target.value)}
          className="min-h-20 resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
          placeholder="Purpose"
        />
        <textarea
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          className="min-h-20 resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
          placeholder="AI instructions / questions to ask"
        />
      </div>

      <button
        type="submit"
        disabled={working || !phone.trim()}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
      >
        {working ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <PhoneCall size={16} />
        )}
        Start AI call
      </button>
    </form>
  );
}

function FilterSelect({
  icon,
  value,
  onChange,
  options,
}: {
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
      <span className="text-white/35">{icon}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full bg-transparent text-sm outline-none"
      >
        {options.map((item) => (
          <option key={item.value} value={item.value} className="bg-[#05070d]">
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
      <p className="text-[11px] text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function SmallStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center gap-2 text-white/35">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
      <div className="mb-4 flex items-center gap-2 text-white/70">
        {icon}
        <h3 className="text-lg font-semibold tracking-[-0.03em]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="border-b border-white/10 py-3 last:border-b-0">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-1 break-words text-sm text-white/70">{value || "-"}</p>
    </div>
  );
}

function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
  const icon =
    status === "CONVERTED" ? (
      <CheckCircle2 size={13} />
    ) : status === "HUMAN_REQUIRED" ? (
      <AlertTriangle size={13} />
    ) : status === "LOST" ? (
      <XCircle size={13} />
    ) : (
      <Clock3 size={13} />
    );

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
      {icon}
      {formatEnum(status)}
    </span>
  );
}

function CallStatusBadge({ status }: { status: CallStatus }) {
  const tone =
    status === "MISSED" ||
    status === "NO_ANSWER" ||
    status === "BUSY" ||
    status === "CANCELED" ||
    status === "FAILED"
      ? "border-red-400/20 bg-red-500/10 text-red-100/75"
      : status === "LIVE" || status === "IN_PROGRESS" || status === "RINGING"
        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100/75"
        : "border-white/10 bg-white/[0.04] text-white/50";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${tone}`}
    >
      <PhoneCall size={13} />
      {formatEnum(status)}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const tone =
    priority === "CRITICAL" || priority === "HIGH"
      ? "border-red-400/20 bg-red-500/10 text-red-100/75"
      : "border-white/10 bg-black/25 text-white/40";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] ${tone}`}>
      {formatEnum(priority)}
    </span>
  );
}

function MessageRow({ message }: { message: Message }) {
  const tone =
    message.senderType === "CUSTOMER"
      ? "border-white/10 bg-black/25"
      : message.senderType === "AI"
        ? "border-cyan-500/20 bg-cyan-500/10"
        : "border-white/20 bg-white/[0.08]";

  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="mb-2 text-xs text-white/35">
        {formatEnum(message.senderType)} · {formatDateTime(message.createdAt)}
      </div>

      <p className="whitespace-pre-wrap text-sm leading-6 text-white/60">
        {message.body}
      </p>
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
        const response = await fetch(
          url.startsWith("http") ? url : `${API_BASE_URL}${url}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        );

        if (!response.ok) {
          throw new Error("Recording is not ready yet");
        }

        const blob = await response.blob();
        currentUrl = URL.createObjectURL(blob);

        if (!revoked) {
          setBlobUrl(currentUrl);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load recording",
        );
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

function LoadingBox({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-white/40">
      <div className="flex items-center gap-3">
        <Loader2 className="animate-spin" size={18} />
        {text}
      </div>
    </div>
  );
}

function EmptyBox({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-8 text-center">
      <div className="text-white/35">{icon}</div>
      <h2 className="mt-5 text-2xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-white/40">{text}</p>
    </div>
  );
}

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => {
      return char.toUpperCase();
    });
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  const diff = Date.now() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return formatDateTime(value);
}

function formatDuration(seconds: number) {
  if (!seconds) return "0s";

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (mins <= 0) return `${secs}s`;

  return `${mins}m ${secs}s`;
}

function getAudioUrl(value?: string | null) {
  if (!value) return "";

  if (/\.(mp3|wav)$/i.test(value)) {
    return value;
  }

  if (value.includes("/Recordings/")) {
    return `${value}.mp3`;
  }

  return value;
}