import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  Filter,
  Headphones,
  Loader2,
  Mic2,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { API_BASE_URL, apiFetch } from "./lib/api";
import {
  BusinessIntentPanel,
  HumeInsightsPanel,
  RequirementsPanel,
} from "./components/CallInsightPanels";
import { TranscriptPanel } from "./components/TranscriptPanel";
import {
  recordingStateLabel,
  resolveRecordingUiState,
} from "./lib/recordingState";
import { isLiveCallStatus, type PostCallAnalysisView } from "./lib/postCallAnalysis";
import { useBoundedLivePoll } from "./lib/livePoll";
import type { HumeExpressionAnalysis } from "./types/crm";

type AiCallLanguage = "AUTO" | "ENGLISH" | "HINDI" | "GUJARATI";

type ConversationStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "FOLLOW_UP"
  | "CONVERTED"
  | "HUMAN_REQUIRED"
  | "LOST";

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

type TeamUser = {
  id: string;
  name: string;
  email?: string | null;
  role?: string;
  isActive?: boolean;
};

type Customer = {
  id: string;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  companyName?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type RequirementDetails = {
  desiredCapabilities?: string[];
  objections?: string[];
  timelineSignal?: string | null;
  budgetSignal?: string | null;
  requestedNextStep?: string | null;
  primaryNeed?: string | null;
};

type PostCallAnalysis = {
  analysisStatus?: string | null;
  requirementSummary?: string | null;
  requirementDetails?: RequirementDetails | null;
  intentLevel?: string | null;
  intentScore?: number | null;
  confidence?: number | null;
};

type Call = {
  id: string;
  conversationId: string;
  phone: string;
  durationSeconds: number;
  transcript?: string | null;
  computedTranscript?: string | null;
  status: CallStatus;
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
  recordingSource?: string | null;
  recordingAvailableAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  failureReason?: string | null;
  metadata?: Record<string, unknown> | null;
  postCallAnalysis?: PostCallAnalysis | null;
  humeExpressionAnalysis?: HumeExpressionAnalysis | null;
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
  assignedUserId?: string | null;
  assignedUser?: TeamUser | null;
  aiNotes?: string | null;
  dueAt?: string | null;
  leadRequirements?: {
    summary?: string | null;
    raw?: string[];
    meetingTime?: string | null;
    meetingScheduledAt?: string | null;
    meetingStatus?: string | null;
    bookingTitle?: string | null;
    source?: string | null;
    captured?: boolean;
  } | null;
  createdAt: string;
  updatedAt?: string;
};

type Booking = {
  id: string;
  title: string;
  status: string;
  dateTime?: string | null;
  callId?: string | null;
  conversationId?: string | null;
  purpose?: string | null;
  notes?: string | null;
  timezone?: string | null;
  nextAction?: string | null;
  assignedUserId?: string | null;
  assignedUser?: TeamUser | null;
  owner?: string | null;
  acceptanceStatus?: string | null;
  acceptedAt?: string | null;
  acceptedByUserId?: string | null;
  meetingNotes?: string | null;
  proposalSent?: boolean | null;
  outcome?: string | null;
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
  summary?: string | null;
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
  computedTranscript?: string | null;
  latestCall?: Call | null;
  latestCallAnalysis?: PostCallAnalysis | null;
  leadRequirements?: {
    summary?: string | null;
    raw?: string[];
    meetingTime?: string | null;
    meetingScheduledAt?: string | null;
    meetingStatus?: string | null;
    bookingTitle?: string | null;
    source?: string | null;
    captured?: boolean;
  } | null;
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

type TeamResponse = {
  teamMembers?: TeamUser[];
  members?: Array<TeamUser & { type?: string }>;
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

type ModalName = "OUTBOUND" | "FOLLOW_UP" | "TRANSCRIPT" | null;

const statuses: Array<{ label: string; value: "ALL" | ConversationStatus }> = [
  { label: "All records", value: "ALL" },
  { label: "New", value: "NEW" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Follow-up", value: "FOLLOW_UP" },
  { label: "Converted", value: "CONVERTED" },
  { label: "Human required", value: "HUMAN_REQUIRED" },
  { label: "Lost", value: "LOST" },
];

const callStatuses: Array<{ label: string; value: "ALL" | CallStatus }> = [
  { label: "All call states", value: "ALL" },
  { label: "Live", value: "LIVE" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Missed", value: "MISSED" },
  { label: "No answer", value: "NO_ANSWER" },
  { label: "Failed", value: "FAILED" },
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
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<CallConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedConversation, setSelectedConversation] =
    useState<CallConversation | null>(null);
  const [summary, setSummary] = useState<CallsSummary>(emptySummary);
  const [teamMembers, setTeamMembers] = useState<TeamUser[]>([]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | ConversationStatus>("ALL");
  const [callStatus, setCallStatus] = useState<"ALL" | CallStatus>("ALL");

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalName>(null);

  const [callbackTitle, setCallbackTitle] = useState("Call customer back");
  const [callbackDescription, setCallbackDescription] = useState("");

  const [outboundName, setOutboundName] = useState("");
  const [outboundPhone, setOutboundPhone] = useState("");
  const [outboundPurpose, setOutboundPurpose] = useState(
    "Collect requirements, understand buying intent, and schedule the next meeting.",
  );
  const [outboundNotes, setOutboundNotes] = useState(
    "Ask what the customer needs, preferred timeline, budget signal, and suitable meeting time.",
  );
  const [outboundLanguage, setOutboundLanguage] =
    useState<AiCallLanguage>("AUTO");

  async function loadCallDetail(id: string, options?: { silent?: boolean }) {
    try {
      if (!options?.silent) {
        setLoadingDetail(true);
      }
      setError("");

      const data = await apiFetch<CallDetailResponse>(`/api/calls/${id}`);
      setSelectedConversation(data.conversation);
      setSelectedId(id);

      setCallbackDescription(
        singleLine(data.conversation.nextAction) ||
          "Follow up with the customer after the AI call.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load call record");
    } finally {
      if (!options?.silent) {
        setLoadingDetail(false);
      }
    }
  }

  const loadCalls = useCallback(async (nextSelectedId?: string, options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setLoadingList(true);
      }
      setError("");

      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      if (callStatus !== "ALL") params.set("callStatus", callStatus);
      if (search.trim()) params.set("search", search.trim());

      const query = params.toString();
      const data = await apiFetch<CallsResponse>(
        `/api/calls${query ? `?${query}` : ""}`,
      );

      const rows = data.conversations || [];
      setConversations(rows);
      setSummary({
        ...emptySummary,
        ...data.summary,
        totalConversations:
          data.summary.totalConversations ?? data.summary.total ?? rows.length,
      });

      const requestedConversationId = new URLSearchParams(
        window.location.search,
      ).get("conversation");
      const currentExists = rows.some((item) => item.id === selectedId);
      const requestedExists = rows.some(
        (item) => item.id === requestedConversationId,
      );
      const idToOpen =
        nextSelectedId ||
        (requestedExists ? requestedConversationId || "" : "") ||
        (currentExists ? selectedId : "") ||
        rows[0]?.id ||
        "";

      if (idToOpen) {
        await loadCallDetail(idToOpen, { silent: options?.silent });
      } else {
        setSelectedId("");
        setSelectedConversation(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calls");
    } finally {
      if (!options?.silent) {
        setLoadingList(false);
      }
    }
  }, [callStatus, search, selectedId, status]);

  const hasLiveCalls = useMemo(
    () =>
      conversations.some((conversation) => {
        const call = conversation.latestCall || conversation.calls?.[0];
        return isLiveCallStatus(call?.status);
      }) || isLiveCallStatus(selectedConversation?.latestCall?.status),
    [conversations, selectedConversation],
  );

  useBoundedLivePoll(hasLiveCalls, () => loadCalls(undefined, { silent: true }), 4000);

  async function loadTeamMembers() {
    try {
      const data = await apiFetch<TeamResponse>("/api/team/overview");
      const source =
        data.teamMembers ||
        (data.members || []).filter((item) => item.type !== "UNASSIGNED");
      setTeamMembers(source.filter((item) => item.isActive !== false));
    } catch {
      setTeamMembers([]);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCalls();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [loadCalls]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTeamMembers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setModal(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedCall = useMemo(
    () =>
      selectedConversation?.latestCall ||
      selectedConversation?.calls?.[0] ||
      null,
    [selectedConversation],
  );

  const transcript = useMemo(
    () => buildConversationTranscript(selectedConversation, selectedCall),
    [selectedConversation, selectedCall],
  );

  const requirements = useMemo(
    () => extractRequirementChips(selectedConversation, selectedCall),
    [selectedConversation, selectedCall],
  );

  const requirementSummary = useMemo(
    () => getRequirementSummary(selectedConversation, selectedCall),
    [selectedConversation, selectedCall],
  );

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

      setNotice("Follow-up task created.");
      setModal(null);
      await refreshCurrent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create follow-up");
    } finally {
      setWorking(false);
    }
  }

  async function markHumanRequired() {
    if (!selectedConversation) return;

    try {
      setWorking(true);
      setError("");
      setNotice("");

      await apiFetch(`/api/calls/${selectedConversation.id}/human-required`, {
        method: "POST",
        body: JSON.stringify({
          reason:
            callbackDescription.trim() ||
            "Human follow-up required after the AI call.",
        }),
      });

      setNotice("Assigned for human follow-up.");
      await refreshCurrent();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to assign human follow-up",
      );
    } finally {
      setWorking(false);
    }
  }

  async function markResolved() {
    if (!selectedConversation) return;

    try {
      setWorking(true);
      setError("");
      setNotice("");

      await apiFetch(`/api/calls/${selectedConversation.id}/resolve`, {
        method: "POST",
      });

      setNotice("Call record marked resolved.");
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
      setError("Phone number is required.");
      return;
    }

    try {
      setWorking(true);
      setError("");
      setNotice("");

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

      setOutboundName("");
      setOutboundPhone("");
      setNotice(
        `AI call started for ${
          data.customer.fullName || data.customer.phone || "the customer"
        }.`,
      );
      setModal(null);
      await loadCalls(data.conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start AI call");
    } finally {
      setWorking(false);
    }
  }

  async function reassignMeeting(bookingId: string, userId: string) {
    if (!bookingId) return;

    try {
      setWorking(true);
      setError("");
      setNotice("");

      await apiFetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          assignedUserId: userId || null,
        }),
      });

      setNotice("Meeting owner updated.");
      await refreshCurrent();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The backend could not update the meeting owner",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="space-y-6 pb-10">
      <CallsHeader
        summary={summary}
        search={search}
        status={status}
        callStatus={callStatus}
        working={working}
        onSearchChange={setSearch}
        onStatusChange={(value) =>
          setStatus(value as "ALL" | ConversationStatus)
        }
        onCallStatusChange={(value) =>
          setCallStatus(value as "ALL" | CallStatus)
        }
        onRefresh={() => loadCalls()}
        onStartCall={() => setModal("OUTBOUND")}
      />

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <section className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <CallRecordList
          conversations={conversations}
          selectedId={selectedId}
          loading={loadingList}
          onSelect={(id) => void loadCallDetail(id)}
        />

        <div className="min-w-0">
          {loadingDetail ? (
            <Surface className="flex min-h-[680px] items-center justify-center">
              <LoadingState text="Opening call record..." />
            </Surface>
          ) : selectedConversation ? (
            <CallRecord
              conversation={selectedConversation}
              call={selectedCall}
              requirementSummary={requirementSummary}
              requirements={requirements}
              transcript={transcript}
              teamMembers={teamMembers}
              working={working}
              onCreateFollowUp={() => setModal("FOLLOW_UP")}
              onHumanRequired={() => void markHumanRequired()}
              onResolve={() => void markResolved()}
              onOpenMeetings={() => navigate("/bookings")}
              onReassignMeeting={(bookingId, userId) =>
                void reassignMeeting(bookingId, userId)
              }
            />
          ) : (
            <Surface className="flex min-h-[680px] items-center justify-center">
              <EmptyState
                icon={<PhoneCall size={34} />}
                title="Select a call record"
                description="Choose a customer from the left. The complete call record will open here without duplicated sections."
              />
            </Surface>
          )}
        </div>
      </section>

      {modal === "TRANSCRIPT" && selectedConversation ? (
        <TranscriptModal
          customerName={
            selectedConversation.customer?.fullName || "Unknown customer"
          }
          transcript={transcript}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "FOLLOW_UP" && selectedConversation ? (
        <FollowUpModal
          title={callbackTitle}
          description={callbackDescription}
          working={working}
          onTitleChange={setCallbackTitle}
          onDescriptionChange={setCallbackDescription}
          onClose={() => setModal(null)}
          onSubmit={createCallbackTask}
        />
      ) : null}

      {modal === "OUTBOUND" ? (
        <OutboundCallModal
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
          onClose={() => setModal(null)}
          onSubmit={startOutboundAiCall}
        />
      ) : null}
    </section>
  );
}

function CallsHeader({
  summary,
  search,
  status,
  callStatus,
  working,
  onSearchChange,
  onStatusChange,
  onCallStatusChange,
  onRefresh,
  onStartCall,
}: {
  summary: CallsSummary;
  search: string;
  status: string;
  callStatus: string;
  working: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onCallStatusChange: (value: string) => void;
  onRefresh: () => void;
  onStartCall: () => void;
}) {
  return (
    <Surface className="p-6 md:p-8">
      <div className="flex flex-col justify-between gap-6 2xl:flex-row 2xl:items-start">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs font-medium text-cyan-100">
            <PhoneCall size={14} />
            Calls &amp; Meetings
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
            Call records
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/48">
            One clear record per AI call: what the customer wants, who owns the
            next step, when it happens, and what to do next.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRefresh}
            disabled={working}
            className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/65 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={17} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onStartCall}
            className="flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition hover:scale-[1.01]"
          >
            <Phone size={17} />
            Start AI call
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Call records" value={summary.totalConversations} />
        <Metric label="Live now" value={summary.live} tone="blue" />
        <Metric label="Completed" value={summary.completed} tone="green" />
        <Metric label="Missed / failed" value={summary.missed} tone="red" />
      </div>

      <div className="mt-6 grid gap-3 xl:grid-cols-[minmax(0,1fr)_240px_240px]">
        <label className="flex h-13 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
          <Search size={18} className="shrink-0 text-white/30" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search customer, phone or transcript..."
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25"
          />
        </label>

        <FilterSelect
          icon={<Filter size={16} />}
          value={status}
          options={statuses}
          onChange={onStatusChange}
        />

        <FilterSelect
          icon={<PhoneCall size={16} />}
          value={callStatus}
          options={callStatuses}
          onChange={onCallStatusChange}
        />
      </div>
    </Surface>
  );
}

function CallRecordList({
  conversations,
  selectedId,
  loading,
  onSelect,
}: {
  conversations: CallConversation[];
  selectedId: string;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Surface className="min-h-[680px] overflow-hidden">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.035em]">
              Records
            </h2>
            <p className="mt-1 text-sm text-white/35">
              Most recent activity first
            </p>
          </div>
          <span className="text-sm text-white/35">{conversations.length}</span>
        </div>
      </div>

      <div className="max-h-[calc(100vh-335px)] min-h-[600px] overflow-y-auto p-3">
        {loading ? (
          <LoadingState text="Loading call records..." />
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={<PhoneCall size={30} />}
            title="No AI calls yet"
            description="Completed and live AI calls will appear here."
          />
        ) : (
          <div className="space-y-3">
            {conversations.map((conversation) => (
              <CallRecordCard
                key={conversation.id}
                conversation={conversation}
                active={selectedId === conversation.id}
                onClick={() => onSelect(conversation.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Surface>
  );
}

function CallRecordCard({
  conversation,
  active,
  onClick,
}: {
  conversation: CallConversation;
  active: boolean;
  onClick: () => void;
}) {
  const call = conversation.latestCall || conversation.calls?.[0] || null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[26px] border p-5 text-left transition ${
        active
          ? "border-white bg-white text-black shadow-[0_18px_55px_rgba(255,255,255,0.10)]"
          : "border-white/10 bg-black/20 text-white hover:bg-white/[0.06]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold tracking-[-0.025em]">
            {conversation.customer?.fullName || "Unknown customer"}
          </p>
          <p
            className={`mt-1 truncate text-xs ${
              active ? "text-black/45" : "text-white/35"
            }`}
          >
            {conversation.customer?.phone || call?.phone || "No phone"}
          </p>
        </div>
        <StatusPill status={call?.status || conversation.status} inverse={active} />
      </div>

      <div
        className={`mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-xs ${
          active ? "border-black/10 text-black/55" : "border-white/10 text-white/40"
        }`}
      >
        <div>
          <p className="opacity-70">When</p>
          <p className="mt-1 font-medium">
            {formatRelative(call?.createdAt || conversation.updatedAt)}
          </p>
        </div>
        <div>
          <p className="opacity-70">Duration</p>
          <p className="mt-1 font-medium">
            {formatDuration(call?.durationSeconds || 0)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {getRecordingUrl(call) ? (
          <MiniTag inverse={active} icon={<Headphones size={12} />}>
            Recording
          </MiniTag>
        ) : null}
        {buildConversationTranscript(conversation, call) ? (
          <MiniTag inverse={active} icon={<FileText size={12} />}>
            Transcript
          </MiniTag>
        ) : null}
        {conversation.bookings?.length ? (
          <MiniTag inverse={active} icon={<CalendarCheck size={12} />}>
            Meeting
          </MiniTag>
        ) : null}
      </div>
    </button>
  );
}

function CallRecord({
  conversation,
  call,
  requirementSummary,
  requirements,
  transcript,
  teamMembers,
  working,
  onCreateFollowUp,
  onHumanRequired,
  onResolve,
  onOpenMeetings,
  onReassignMeeting,
}: {
  conversation: CallConversation;
  call: Call | null;
  requirementSummary: string;
  requirements: string[];
  transcript: string;
  teamMembers: TeamUser[];
  working: boolean;
  onCreateFollowUp: () => void;
  onHumanRequired: () => void;
  onResolve: () => void;
  onOpenMeetings: () => void;
  onReassignMeeting: (bookingId: string, userId: string) => void;
}) {
  const customerName = conversation.customer?.fullName || "Unknown customer";
  const recordingUrl = getRecordingUrl(call);
  const analysis =
    call?.postCallAnalysis ||
    conversation.latestCallAnalysis ||
    null;

  const customerIntentText =
    conversation.aiSummary ||
    conversation.summary ||
    conversation.lastMessage ||
    "";
  const recordingUiState = resolveRecordingUiState(call);
  const analysisView = toPostCallAnalysisView(analysis);

  return (
    <Surface className="overflow-hidden">
      <div className="border-b border-white/10 px-6 py-6 md:px-8 md:py-7">
        <div className="flex flex-col justify-between gap-6 2xl:flex-row 2xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={call?.status || conversation.status} />
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/45">
                AI Call
              </span>
            </div>

            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] md:text-4xl">
              {customerName}
            </h2>
            <p className="mt-2 text-sm text-white/42">
              {conversation.customer?.phone || call?.phone || "No phone"}
              {call?.createdAt ? ` · ${formatDateTime(call.createdAt)}` : ""}
              {call ? ` · ${formatDuration(call.durationSeconds)}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 2xl:justify-end">
            <SecondaryButton onClick={onCreateFollowUp} disabled={working}>
              <Send size={16} />
              Create follow-up
            </SecondaryButton>
            <SecondaryButton
              onClick={onHumanRequired}
              disabled={working}
              tone="amber"
            >
              <UsersRound size={16} />
              Human required
            </SecondaryButton>
            <SecondaryButton onClick={onResolve} disabled={working} tone="green">
              <CheckCircle2 size={16} />
              Resolve
            </SecondaryButton>
          </div>
        </div>
      </div>

      <div className="p-6 md:p-8">
        <div className="overflow-hidden rounded-[30px] border border-white/10 bg-black/18">
          <RecordRow label="Customer Intent" icon={<Sparkles size={18} />}>
            <CustomerIntentBlock
              conversation={conversation}
              analysis={analysis}
              outcome={customerIntentText}
            />
          </RecordRow>

          <RecordRow label="Lead Requirements" icon={<Check size={18} />}>
            <LeadRequirementsBlock
              conversation={conversation}
              analysis={analysis}
              requirementSummary={requirementSummary}
              requirements={requirements}
              customerIntentText={customerIntentText}
            />
          </RecordRow>

          <RecordRow label="Tasks & Meetings" icon={<CalendarCheck size={18} />}>
            <TasksAndMeetingsBlock
              conversation={conversation}
              teamMembers={teamMembers}
              working={working}
              onOpenMeetings={onOpenMeetings}
              onReassignMeeting={onReassignMeeting}
            />
          </RecordRow>

          <RecordRow label="Recording" icon={<Headphones size={18} />}>
            <div className="max-w-4xl space-y-3">
              <span className="inline-flex rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-white/55">
                {recordingStateLabel(recordingUiState)}
              </span>
              {recordingUrl ? (
                <AuthenticatedAudioPlayer url={recordingUrl} />
              ) : (
                <MutedText>
                  Recording is not available yet. It will appear after provider
                  processing completes.
                </MutedText>
              )}
            </div>
          </RecordRow>

          <RecordRow label="Transcript" icon={<Mic2 size={18} />} last={false}>
            <div className="max-w-4xl">
              <TranscriptPanel raw={transcript} defaultExpanded={false} />
            </div>
          </RecordRow>
        </div>

        <div className="mt-6 grid gap-4">
          <RequirementsPanel
            analysis={analysisView}
            fallbackSummary={requirementSummary || customerIntentText}
          />
          <BusinessIntentPanel analysis={analysisView} />
          <HumeInsightsPanel analysis={call?.humeExpressionAnalysis || null} />
        </div>

        <details className="mt-6 rounded-[26px] border border-white/10 bg-black/15 p-5">
          <summary className="cursor-pointer list-none text-sm font-medium text-white/52">
            Technical call details
          </summary>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoItem label="Call status" value={formatEnum(call?.status)} />
            <InfoItem
              label="Provider"
              value={
                call?.telephonyProvider ||
                call?.provider ||
                conversation.provider ||
                "-"
              }
            />
            <InfoItem label="Direction" value={call?.direction || "INBOUND"} />
            <InfoItem
              label="Provider call ID"
              value={call?.providerCallId || "-"}
            />
            <InfoItem
              label="Recording status"
              value={call?.recordingStatus || "-"}
            />
            <InfoItem label="Priority" value={formatEnum(conversation.priority)} />
            <InfoItem
              label="Started"
              value={formatDateTime(call?.startedAt || call?.createdAt)}
            />
            <InfoItem
              label="Duration"
              value={formatDuration(call?.durationSeconds || 0)}
            />
          </div>
        </details>
      </div>
    </Surface>
  );
}

function CustomerIntentBlock({
  conversation,
  analysis,
  outcome,
}: {
  conversation: CallConversation;
  analysis: PostCallAnalysis | null;
  outcome: string;
}) {
  const status = String(analysis?.analysisStatus || "").toUpperCase();
  const intent =
    analysis?.intentLevel ||
    conversation.intent ||
    (status === "PENDING" || status === "PROCESSING"
      ? "Analysis in progress"
      : "Not detected");

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-100/80">
          {formatEnum(intent)}
        </span>
        {conversation.humanNeeded ? (
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-100/80">
            Human attention needed
          </span>
        ) : null}
      </div>

      {outcome ? (
        <div className="rounded-[26px] border border-cyan-400/15 bg-cyan-400/[0.07] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/65">
            Call outcome
          </p>
          <p className="mt-3 text-[15px] leading-8 text-white/68">{outcome}</p>
        </div>
      ) : (
        <MutedText>
          Customer intent will appear after the completed call is analysed.
        </MutedText>
      )}
    </div>
  );
}

function LeadRequirementsBlock({
  conversation,
  analysis,
  requirementSummary,
  requirements,
  customerIntentText,
}: {
  conversation: CallConversation;
  analysis: PostCallAnalysis | null;
  requirementSummary: string;
  requirements: string[];
  customerIntentText: string;
}) {
  const details = analysis?.requirementDetails || null;
  const summaryIsRepeated =
    normalizeText(requirementSummary) !== "" &&
    normalizeText(requirementSummary) === normalizeText(customerIntentText);

  const information = [
    { label: "Primary need", value: details?.primaryNeed },
    { label: "Timeline", value: details?.timelineSignal },
    { label: "Budget", value: details?.budgetSignal },
    { label: "Customer requested", value: details?.requestedNextStep },
  ].filter((item) => String(item.value || "").trim());

  const objections = uniqueCleanStrings(details?.objections || []).slice(0, 5);
  const recommendedNextStep =
    singleLine(conversation.nextAction) ||
    singleLine(details?.requestedNextStep) ||
    "";

  const hasContent =
    Boolean(requirementSummary && !summaryIsRepeated) ||
    requirements.length > 0 ||
    information.length > 0 ||
    objections.length > 0 ||
    Boolean(recommendedNextStep);

  if (!hasContent) {
    return <MutedText>No structured lead requirements were captured.</MutedText>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      {requirementSummary && !summaryIsRepeated ? (
        <div className="rounded-[26px] border border-emerald-400/15 bg-emerald-400/[0.07] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100/65">
            What the customer needs
          </p>
          <p className="mt-3 text-[15px] leading-8 text-white/68">
            {requirementSummary}
          </p>
        </div>
      ) : null}

      {requirements.length > 0 ? (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-white/35">
            Required capabilities
          </p>
          <div className="flex flex-wrap gap-2.5">
            {requirements.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm text-white/68"
              >
                <Check size={13} className="text-emerald-300" />
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {information.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {information.map((item) => (
            <InfoItem
              key={item.label}
              label={item.label}
              value={String(item.value)}
            />
          ))}
        </div>
      ) : null}

      {objections.length > 0 ? (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-white/35">
            Objections or concerns
          </p>
          <div className="space-y-2.5">
            {objections.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-white/58"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {recommendedNextStep ? (
        <div className="rounded-[26px] border border-amber-400/20 bg-amber-400/[0.08] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/65">
            Recommended next step
          </p>
          <p className="mt-3 text-base font-semibold leading-7 text-amber-50/90">
            {recommendedNextStep}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TasksAndMeetingsBlock({
  conversation,
  teamMembers,
  working,
  onOpenMeetings,
  onReassignMeeting,
}: {
  conversation: CallConversation;
  teamMembers: TeamUser[];
  working: boolean;
  onOpenMeetings: () => void;
  onReassignMeeting: (bookingId: string, userId: string) => void;
}) {
  const today = conversation.bookings
    .filter((booking) => isSameDay(booking.dateTime, new Date()))
    .sort(sortBookings);

  const upcoming = conversation.bookings
    .filter((booking) => {
      if (!booking.dateTime) return false;
      const date = new Date(booking.dateTime);
      return (
        !Number.isNaN(date.getTime()) &&
        date.getTime() > endOfDay(new Date()).getTime()
      );
    })
    .sort(sortBookings);

  const unscheduled = conversation.bookings.filter(
    (booking) => !booking.dateTime,
  );

  return (
    <div className="grid max-w-5xl gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white/78">Tasks</h3>
            <p className="mt-1 text-xs text-white/35">
              Follow-up work created from this call
            </p>
          </div>
          <span className="text-xs text-white/30">
            {conversation.tasks.length}
          </span>
        </div>

        {conversation.tasks.length === 0 ? (
          <div className="mt-4">
            <MutedText>No follow-up tasks have been created.</MutedText>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {conversation.tasks.slice(0, 6).map((task) => (
              <div
                key={task.id}
                className="rounded-[22px] border border-white/10 bg-black/20 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium leading-6 text-white/76">
                    {task.title}
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/45">
                    {formatEnum(task.status)}
                  </span>
                </div>
                <p className="mt-3 text-xs text-white/35">
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
            onClick={onOpenMeetings}
            className="flex items-center gap-2 text-xs font-medium text-cyan-100/65 hover:text-cyan-100"
          >
            Open all meetings
            <ArrowRight size={13} />
          </button>
        </div>

        <CallMeetingGroup
          title="Meetings today"
          meetings={today}
          emptyText="No meetings scheduled for today."
          teamMembers={teamMembers}
          working={working}
          onReassign={onReassignMeeting}
        />

        <CallMeetingGroup
          title="Upcoming meetings"
          meetings={upcoming}
          emptyText="No meetings scheduled after today."
          teamMembers={teamMembers}
          working={working}
          onReassign={onReassignMeeting}
        />

        {unscheduled.length > 0 ? (
          <CallMeetingGroup
            title="Needs scheduling"
            meetings={unscheduled}
            emptyText=""
            teamMembers={teamMembers}
            working={working}
            onReassign={onReassignMeeting}
          />
        ) : null}
      </section>
    </div>
  );
}

function CallMeetingGroup({
  title,
  meetings,
  emptyText,
  teamMembers,
  working,
  onReassign,
}: {
  title: string;
  meetings: Booking[];
  emptyText: string;
  teamMembers: TeamUser[];
  working: boolean;
  onReassign: (bookingId: string, userId: string) => void;
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
          {meetings.slice(0, 5).map((meeting) => {
            const owner =
              meeting.assignedUser?.name ||
              meeting.owner ||
              "Unassigned";

            return (
              <div
                key={meeting.id}
                className="rounded-[22px] border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-6 text-white/76">
                      {meeting.title}
                    </p>
                    <p className="mt-2 text-xs text-white/36">
                      {meeting.dateTime
                        ? formatDateTime(meeting.dateTime)
                        : "Date and time not set"}
                    </p>
                  </div>
                  <MeetingStatusBar status={meeting.status} />
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-white/28">
                      Assigned to
                    </p>
                    <p className="mt-1 text-sm font-medium text-white/68">
                      {owner}
                    </p>
                  </div>

                  {teamMembers.length > 0 ? (
                    <select
                      value={meeting.assignedUserId || ""}
                      onChange={(event) =>
                        onReassign(meeting.id, event.target.value)
                      }
                      disabled={working}
                      aria-label={`Change owner for ${meeting.title}`}
                      className="h-9 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white/60 outline-none disabled:opacity-50"
                    >
                      <option value="" className="bg-[#080b12]">
                        Change owner
                      </option>
                      {teamMembers.map((member) => (
                        <option
                          key={member.id}
                          value={member.id}
                          className="bg-[#080b12]"
                        >
                          {member.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>

                <div className="mt-3">
                  <AcceptancePill meeting={meeting} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MeetingStatusBar({ status }: { status: string }) {
  const config = getMeetingStatusConfig(status);

  return (
    <div className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${config.className}`}>
      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-current opacity-80" />
      {config.label}
    </div>
  );
}

function AcceptancePill({ meeting }: { meeting: Booking }) {
  const accepted =
    meeting.acceptanceStatus === "ACCEPTED" ||
    meeting.status === "CONFIRMED" ||
    Boolean(meeting.acceptedAt);

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1.5 text-xs ${
        accepted
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100/80"
          : "border-amber-400/20 bg-amber-400/10 text-amber-100/80"
      }`}
    >
      {accepted ? "Accepted" : "Pending acceptance"}
    </span>
  );
}

function RecordRow({
  label,
  icon,
  children,
  last = false,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`grid gap-5 px-5 py-7 md:grid-cols-[205px_minmax(0,1fr)] md:px-7 md:py-8 ${
        last ? "" : "border-b border-white/10"
      }`}
    >
      <div className="flex items-center gap-3 self-start text-white/68">
        <span className="text-white/38">{icon}</span>
        <h3 className="text-sm font-semibold">{label}</h3>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TranscriptModal({
  customerName,
  transcript,
  onClose,
}: {
  customerName: string;
  transcript: string;
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose} size="large">
      <div className="flex h-[min(84vh,900px)] min-h-[600px] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-5 border-b border-white/10 px-6 py-5 md:px-8 md:py-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-cyan-100/70">
              <Mic2 size={16} />
              Full transcript
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] md:text-3xl">
              {customerName}
            </h2>
            <p className="mt-2 text-sm text-white/35">
              {wordCount(transcript)} words
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-4xl rounded-[26px] border border-white/10 bg-black/25 p-5 md:p-7">
            <p className="whitespace-pre-wrap text-[15px] leading-8 text-white/68">
              {transcript || "No transcript saved for this call."}
            </p>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function FollowUpModal({
  title,
  description,
  working,
  onTitleChange,
  onDescriptionChange,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  working: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <ModalShell onClose={onClose}>
      <form onSubmit={onSubmit} className="p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-cyan-100/70">Next action</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
              Create follow-up
            </h2>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="mt-7 space-y-4">
          <Field label="Task title">
            <input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            />
          </Field>

          <Field label="Details">
            <textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              className="min-h-32 w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm leading-7 outline-none"
            />
          </Field>
        </div>

        <div className="mt-7 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-2xl border border-white/10 px-5 text-sm text-white/55"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={working || !title.trim()}
            className="flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
          >
            {working ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
            Create task
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function OutboundCallModal({
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
  onClose,
  onSubmit,
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
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <ModalShell onClose={onClose} size="medium">
      <form onSubmit={onSubmit} className="p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-cyan-100/70">
              <PhoneCall size={16} />
              AI outbound call
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
              Start a call
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/38">
              The form stays outside the main record so the call page remains
              focused and easy to read.
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-2">
          <Field label="Customer name">
            <input
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Optional"
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25"
            />
          </Field>

          <Field label="Phone number">
            <input
              value={phone}
              onChange={(event) => onPhoneChange(event.target.value)}
              placeholder="+91..."
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25"
            />
          </Field>

          <Field label="Language">
            <select
              value={language}
              onChange={(event) =>
                onLanguageChange(event.target.value as AiCallLanguage)
              }
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              <option value="AUTO" className="bg-[#080b12]">
                Auto-detect
              </option>
              <option value="ENGLISH" className="bg-[#080b12]">
                English
              </option>
              <option value="HINDI" className="bg-[#080b12]">
                Hindi
              </option>
              <option value="GUJARATI" className="bg-[#080b12]">
                Gujarati
              </option>
            </select>
          </Field>

          <div className="md:col-span-2">
            <Field label="Call purpose">
              <textarea
                value={purpose}
                onChange={(event) => onPurposeChange(event.target.value)}
                className="min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm leading-7 outline-none"
              />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label="AI instructions">
              <textarea
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm leading-7 outline-none"
              />
            </Field>
          </div>
        </div>

        <div className="mt-7 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-2xl border border-white/10 px-5 text-sm text-white/55"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={working || !phone.trim()}
            className="flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
          >
            {working ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <PhoneCall size={16} />
            )}
            Start AI call
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  children,
  onClose,
  size = "small",
}: {
  children: ReactNode;
  onClose: () => void;
  size?: "small" | "medium" | "large";
}) {
  const width =
    size === "large"
      ? "max-w-6xl"
      : size === "medium"
        ? "max-w-3xl"
        : "max-w-xl";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${width} overflow-hidden rounded-[32px] border border-white/12 bg-[#0a0d14] shadow-[0_40px_140px_rgba(0,0,0,0.65)]`}
      >
        {children}
      </div>
    </div>
  );
}

function AuthenticatedAudioPlayer({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

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

        if (!response.ok) throw new Error("Recording is not ready yet");

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(objectUrl);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load recording",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAudio();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (loading) {
    return (
      <div className="flex h-14 items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-5 text-sm text-white/40">
        <Loader2 className="animate-spin" size={17} />
        Loading recording...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-5 py-4 text-sm text-amber-100/80">
        {error}
      </div>
    );
  }

  return blobUrl ? (
    <audio controls preload="metadata" src={blobUrl} className="w-full" />
  ) : null;
}

function Surface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[34px] border border-white/10 bg-white/[0.04] ${className}`}
    >
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "blue" | "green" | "red";
}) {
  const toneClass =
    tone === "blue"
      ? "border-sky-400/15 bg-sky-400/[0.07]"
      : tone === "green"
        ? "border-emerald-400/15 bg-emerald-400/[0.07]"
        : tone === "red"
          ? "border-red-400/15 bg-red-400/[0.07]"
          : "border-white/10 bg-black/20";

  return (
    <div className={`rounded-[22px] border px-5 py-4 ${toneClass}`}>
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function FilterSelect({
  icon,
  value,
  options,
  onChange,
}: {
  icon: ReactNode;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-13 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
      <span className="text-white/30">{icon}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 min-w-0 flex-1 bg-transparent text-sm text-white/65 outline-none"
      >
        {options.map((item) => (
          <option key={item.value} value={item.value} className="bg-[#080b12]">
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusPill({
  status,
  inverse = false,
}: {
  status: string;
  inverse?: boolean;
}) {
  const config = getCallStatusConfig(status);

  if (inverse) {
    return (
      <span className="shrink-0 rounded-full bg-black/8 px-2.5 py-1 text-[11px] font-medium text-black/58">
        {config.label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${config.className}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

function MiniTag({
  children,
  icon,
  inverse,
}: {
  children: ReactNode;
  icon: ReactNode;
  inverse: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
        inverse
          ? "border-black/10 bg-black/[0.04] text-black/48"
          : "border-white/10 bg-white/[0.04] text-white/42"
      }`}
    >
      {icon}
      {children}
    </span>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
  tone = "neutral",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  tone?: "neutral" | "amber" | "green";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
      : tone === "green"
        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
        : "border-white/10 bg-black/25 text-white/62";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 items-center gap-2 rounded-2xl border px-4 text-sm transition hover:brightness-110 disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <p className="text-xs text-white/30">{label}</p>
      <p className="mt-2 break-words text-sm text-white/62">{value || "-"}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-white/35">
        {label}
      </span>
      {children}
    </label>
  );
}

function MutedText({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-7 text-white/40">{children}</p>;
}

function Notice({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "success" | "danger";
}) {
  return (
    <div
      className={`rounded-2xl border px-5 py-4 text-sm ${
        tone === "success"
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
          : "border-red-400/20 bg-red-400/10 text-red-100"
      }`}
    >
      {children}
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white"
    >
      <X size={18} />
    </button>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center gap-3 text-sm text-white/40">
      <Loader2 className="animate-spin" size={18} />
      {text}
    </div>
  );
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
    <div className="flex min-h-[320px] flex-col items-center justify-center px-8 text-center">
      <div className="text-white/30">{icon}</div>
      <h3 className="mt-5 text-xl font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-white/38">
        {description}
      </p>
    </div>
  );
}

function getCallStatusConfig(status?: string | null) {
  const value = status || "NEW";

  if (["LIVE", "IN_PROGRESS", "RINGING"].includes(value)) {
    return {
      label: formatEnum(value),
      className: "border-sky-400/20 bg-sky-400/10 text-sky-100",
      icon: <Clock3 size={12} />,
    };
  }

  if (["COMPLETED", "CONVERTED", "TRANSFERRED"].includes(value)) {
    return {
      label: formatEnum(value),
      className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
      icon: <CheckCircle2 size={12} />,
    };
  }

  if (["FOLLOW_UP", "HUMAN_REQUIRED"].includes(value)) {
    return {
      label: formatEnum(value),
      className: "border-amber-400/20 bg-amber-400/10 text-amber-100",
      icon: <AlertTriangle size={12} />,
    };
  }

  if (["MISSED", "NO_ANSWER", "BUSY", "CANCELED", "FAILED", "LOST"].includes(value)) {
    return {
      label: formatEnum(value),
      className: "border-red-400/20 bg-red-400/10 text-red-100",
      icon: <XCircle size={12} />,
    };
  }

  return {
    label: formatEnum(value),
    className: "border-white/10 bg-white/[0.05] text-white/50",
    icon: <PhoneCall size={12} />,
  };
}

function getMeetingStatusConfig(status?: string | null) {
  const value = status || "NOT_SCHEDULED";

  if (["CONFIRMED", "UPCOMING", "SCHEDULED"].includes(value)) {
    return {
      label: value === "CONFIRMED" ? "Upcoming" : formatEnum(value),
      className: "bg-sky-400/10 text-sky-100",
    };
  }

  if (["COMPLETED", "ACCEPTED", "WON"].includes(value)) {
    return {
      label: formatEnum(value),
      className: "bg-emerald-400/10 text-emerald-100",
    };
  }

  if (["REQUESTED", "PENDING_ACCEPTANCE", "FOLLOW_UP"].includes(value)) {
    return {
      label: value === "REQUESTED" ? "Pending acceptance" : formatEnum(value),
      className: "bg-amber-400/10 text-amber-100",
    };
  }

  if (["CANCELLED", "CANCELED", "NO_SHOW", "LOST"].includes(value)) {
    return {
      label: formatEnum(value),
      className: "bg-red-400/10 text-red-100",
    };
  }

  return {
    label: "Not scheduled",
    className: "bg-white/[0.05] text-white/45",
  };
}

function extractRequirementChips(
  conversation: CallConversation | null,
  call: Call | null,
): string[] {
  if (!conversation) return [];

  const analysis = call?.postCallAnalysis || conversation.latestCallAnalysis;
  const values: string[] = [];

  values.push(...(analysis?.requirementDetails?.desiredCapabilities || []));
  values.push(...(conversation.leadRequirements?.raw || []));

  for (const task of conversation.tasks || []) {
    values.push(...(task.leadRequirements?.raw || []));
  }

  if (analysis?.requirementDetails?.primaryNeed) {
    values.push(analysis.requirementDetails.primaryNeed);
  }

  return uniqueCleanStrings(values)
    .filter((item) => item.length <= 64)
    .slice(0, 10);
}

function getRequirementSummary(
  conversation: CallConversation | null,
  call: Call | null,
): string {
  if (!conversation) return "";

  const analysis = call?.postCallAnalysis || conversation.latestCallAnalysis;

  return (
    analysis?.requirementSummary ||
    conversation.leadRequirements?.summary ||
    conversation.tasks?.find((task) => task.leadRequirements?.summary)
      ?.leadRequirements?.summary ||
    ""
  );
}

function buildConversationTranscript(
  conversation: CallConversation | null,
  call: Call | null,
): string {
  if (!conversation) return "";

  const direct =
    call?.transcript ||
    call?.computedTranscript ||
    conversation.computedTranscript ||
    "";

  if (direct.trim()) return direct.trim();

  return (conversation.messages || [])
    .map((message) => {
      const speaker =
        message.senderType === "CUSTOMER"
          ? "Customer"
          : message.senderType === "AI"
            ? "AI"
            : "Human";
      return `${speaker}: ${message.body}`;
    })
    .join("\n\n")
    .trim();
}

function getRecordingUrl(call: Call | null): string {
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

function uniqueCleanStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const cleaned = String(value || "")
      .replace(/^[\s✓•\-*]+/, "")
      .trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(cleaned);
  }

  return output;
}

function normalizeText(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function toPostCallAnalysisView(
  analysis: PostCallAnalysis | null,
): PostCallAnalysisView | null {
  if (!analysis) return null;

  const status = String(analysis.analysisStatus || "NONE").toUpperCase();
  const allowed: PostCallAnalysisView["analysisStatus"][] = [
    "NONE",
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "INSUFFICIENT_DATA",
  ];

  return {
    ...analysis,
    analysisStatus: allowed.includes(status as PostCallAnalysisView["analysisStatus"])
      ? (status as PostCallAnalysisView["analysisStatus"])
      : "NONE",
  };
}

function endOfDay(value: Date): Date {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
}

function isSameDay(value: string | null | undefined, target: Date): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

function sortBookings(a: Booking, b: Booking): number {
  const aTime = a.dateTime
    ? new Date(a.dateTime).getTime()
    : Number.MAX_SAFE_INTEGER;
  const bTime = b.dateTime
    ? new Date(b.dateTime).getTime()
    : Number.MAX_SAFE_INTEGER;
  return aTime - bTime;
}

function singleLine(value?: string | null): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function formatEnum(value?: string | null): string {
  if (!value) return "-";

  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Not set";

  return new Date(value).toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(value?: string | null): string {
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

function formatDuration(seconds: number): string {
  if (!seconds) return "0s";

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;

  return minutes > 0 ? `${minutes}m ${remaining}s` : `${remaining}s`;
}