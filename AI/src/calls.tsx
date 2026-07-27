import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock3,
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
import {
  AuthenticatedAudioPlayer,
} from "./components/AuthenticatedAudioPlayer";
import { resolveRecordingUiState } from "./lib/recordingState";
import {
  BusinessIntentPanel,
  HumeInsightsPanel,
  RequirementsPanel,
} from "./components/CallInsightPanels";
import { Panel, TranscriptPanel } from "./components/TranscriptPanel";
import { apiFetch } from "./lib/api";
import { useAuth } from "./auth/AuthContext";
import {
  formatDateTime,
  formatDuration,
  formatEnum,
  formatRelative,
  type CallConversation,
  type CallRecord,
  type ConversationStatus,
  type CallStatus,
} from "./types/crm";

type AiCallLanguage = "AUTO" | "ENGLISH" | "HINDI" | "GUJARATI";

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
  latestCalls?: CallRecord[];
  summary: Partial<CallsSummary>;
};

type CallDetailResponse = {
  conversation: CallConversation;
};

type TaskResponse = {
  message: string;
  task: { id: string };
};

type TeamMemberOption = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

type TeamOverviewResponse = {
  users: TeamMemberOption[];
};

type OutboundAiCallResponse = {
  message: string;
  customer: { fullName?: string | null; phone?: string | null };
  conversation: CallConversation;
  call: CallRecord;
};

const statuses: Array<{ label: string; value: "ALL" | ConversationStatus }> = [
  { label: "All status", value: "ALL" },
  { label: "New", value: "NEW" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Follow up", value: "FOLLOW_UP" },
  { label: "Converted", value: "CONVERTED" },
  { label: "Human required", value: "HUMAN_REQUIRED" },
  { label: "Lost", value: "LOST" },
];

const callStatuses: Array<{ label: string; value: "ALL" | CallStatus }> = [
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
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialConversationId = searchParams.get("c") || searchParams.get("conversationId") || "";

  const [conversations, setConversations] = useState<CallConversation[]>([]);
  const [latestCalls, setLatestCalls] = useState<CallRecord[]>([]);
  const [selectedId, setSelectedId] = useState(initialConversationId);
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
  const [assignmentWorking, setAssignmentWorking] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<TeamOverviewResponse>("/api/team/overview");
        if (!cancelled) setTeamMembers(data.users.filter((member) => member.isActive));
      } catch {
        if (!cancelled) setTeamMembers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function updateCallOwner(nextAssignedUserId: string | null) {
    if (!selectedCall?.id) return;
    try {
      setAssignmentWorking(true);
      setAssignmentError("");
      await apiFetch<{ call: CallRecord }>(`/api/calls/${selectedCall.id}/assignment`, {
        method: "PATCH",
        body: JSON.stringify({ assignedUserId: nextAssignedUserId }),
      });
      setNotice("Call owner updated");
      await loadCallDetail(selectedConversation!.id);
      await refreshCurrent();
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : "Failed to update call owner");
    } finally {
      setAssignmentWorking(false);
    }
  }

  const detailRequestRef = useRef(0);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  async function loadCallDetail(id: string) {
    const requestId = ++detailRequestRef.current;
    try {
      setLoadingDetail(true);
      const data = await apiFetch<CallDetailResponse>(`/api/calls/${id}`);
      if (requestId !== detailRequestRef.current) return;

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
      if (requestId !== detailRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load call");
    } finally {
      if (requestId === detailRequestRef.current) {
        setLoadingDetail(false);
      }
    }
  }

  async function loadCalls(nextSelectedId?: string) {
    try {
      setError("");
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

      const preferred = nextSelectedId || selectedIdRef.current;
      const currentStillExists = data.conversations?.some(
        (conversation) => conversation.id === preferred,
      );
      const idToOpen =
        (currentStillExists ? preferred : "") ||
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

  async function selectConversation(id: string) {
    setSelectedId(id);
    await loadCallDetail(id);
  }

  async function refreshCurrent() {
    setLoadingList(true);
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
      setError(err instanceof Error ? err.message : "Failed to create callback task");
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
      setNotice("Conversation marked human required and follow-up task created.");
      await refreshCurrent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark human follow-up");
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
      const data = await apiFetch<OutboundAiCallResponse>("/api/calls/outbound-ai", {
        method: "POST",
        body: JSON.stringify({
          name: outboundName.trim() || null,
          phone: outboundPhone.trim(),
          purpose: outboundPurpose.trim() || undefined,
          notes: outboundNotes.trim() || undefined,
          preferredLanguage: outboundLanguage,
        }),
      });
      setNotice(
        `AI call started for ${data.customer.fullName || data.customer.phone || outboundPhone.trim()}.`,
      );
      setOutboundName("");
      setOutboundPhone("");
      setLoadingList(true);
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
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setError("");
          const params = new URLSearchParams();
          if (status !== "ALL") params.set("status", status);
          if (callStatus !== "ALL") params.set("callStatus", callStatus);
          if (recording !== "ALL") params.set("recording", recording);
          if (search.trim()) params.set("search", search.trim());
          const query = params.toString();
          const data = await apiFetch<CallsResponse>(
            `/api/calls${query ? `?${query}` : ""}`,
          );
          if (cancelled) return;

          setConversations(data.conversations || []);
          setLatestCalls(data.latestCalls || []);
          setSummary({
            ...emptySummary,
            ...data.summary,
            totalConversations:
              data.summary.totalConversations ?? data.summary.total ?? 0,
          });

          const preferred = selectedIdRef.current || initialConversationId;
          const stillExists = data.conversations?.some((item) => item.id === preferred);
          const idToOpen =
            (stillExists ? preferred : "") || data.conversations?.[0]?.id || "";

          if (idToOpen) {
            setSelectedId(idToOpen);
            const detail = await apiFetch<CallDetailResponse>(`/api/calls/${idToOpen}`);
            if (cancelled) return;
            setSelectedConversation(detail.conversation);
            const transcript =
              detail.conversation.latestCall?.transcript ||
              detail.conversation.computedTranscript ||
              detail.conversation.aiSummary ||
              "";
            setCallbackDescription(
              transcript ||
                "Customer needs a human callback based on AI call conversation.",
            );
          } else {
            setSelectedId("");
            setSelectedConversation(null);
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load calls");
          }
        } finally {
          if (!cancelled) setLoadingList(false);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, status, callStatus, recording, initialConversationId]);

  const selectedCall =
    selectedConversation?.latestCall ||
    selectedConversation?.calls?.[0] ||
    null;

  const analysis =
    selectedCall?.postCallAnalysis ||
    selectedConversation?.latestCallAnalysis ||
    null;

  const linkedBooking = selectedConversation?.bookings?.[0] || null;
  const callOwnerLabel = selectedCall?.assignedUser?.name || "Unassigned";
  const meetingOwnerLabel = linkedBooking?.assignedUser?.name || "Unassigned";
  const ownerLabel = callOwnerLabel;
  const canReassignCalls = user?.role === "OWNER" || user?.role === "ADMIN";

  const latestTranscript =
    selectedCall?.transcript ||
    selectedConversation?.computedTranscript ||
    "";

  return (
    <section className="grid h-[calc(100vh-112px)] min-h-[720px] gap-4 xl:grid-cols-[460px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        <div className="shrink-0 border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] font-medium text-cyan-200">
                <PhoneCall size={13} aria-hidden />
                Hume EVI + Twilio telephony
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">Calls</h1>
              <p className="mt-1 text-sm text-white/40">
                Ownership, requirements, intent, recordings and next actions
              </p>
            </div>
            <button
              type="button"
              aria-label="Refresh calls"
              onClick={() => {
                setLoadingList(true);
                void refreshCurrent();
              }}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              <RefreshCw size={18} aria-hidden />
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-white/10 p-5">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
              <Search size={18} className="text-white/35" aria-hidden />
              <input
                value={search}
                onChange={(event) => {
                  setLoadingList(true);
                  setSearch(event.target.value);
                }}
                placeholder="Search name, phone, transcript..."
                aria-label="Search calls"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
              />
            </div>

            <div className="mt-3 grid gap-2">
              <FilterSelect
                icon={<Filter size={16} />}
                label="Conversation status"
                value={status}
                onChange={(value) => {
                  setLoadingList(true);
                  setStatus(value as "ALL" | ConversationStatus);
                }}
                options={statuses}
              />
              <FilterSelect
                icon={<PhoneCall size={16} />}
                label="Call status"
                value={callStatus}
                onChange={(value) => {
                  setLoadingList(true);
                  setCallStatus(value as "ALL" | CallStatus);
                }}
                options={callStatuses}
              />
              <FilterSelect
                icon={<Headphones size={16} />}
                label="Recording filter"
                value={recording}
                onChange={(value) => {
                  setLoadingList(true);
                  setRecording(value);
                }}
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
              <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100" role="status">
                {notice}
              </div>
            ) : null}
            {error ? (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100" role="alert">
                {error}
              </div>
            ) : null}
          </div>

          <div className="p-3">
            {loadingList ? (
              <LoadingBox text="Loading calls..." />
            ) : conversations.length === 0 ? (
              <EmptyBox
                icon={<PhoneCall size={30} />}
                title="No AI calls yet"
                text="Hume EVI conversations will appear here after the first saved call."
              />
            ) : (
              <div className="space-y-2">
                {conversations.map((conversation) => (
                  <CallConversationCard
                    key={conversation.id}
                    conversation={conversation}
                    active={selectedId === conversation.id}
                    onClick={() => void selectConversation(conversation.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        {!selectedConversation ? (
          error ? (
            <EmptyBox
              icon={<AlertTriangle size={34} />}
              title="Could not load calls"
              text={error}
            />
          ) : (
            <EmptyBox
              icon={<PhoneCall size={34} />}
              title="Select a call"
              text="Review requirements, ownership, intent, recording, transcript and next action."
            />
          )
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <CallHeader
              conversation={selectedConversation}
              call={selectedCall}
              ownerLabel={ownerLabel}
              onHumanRequired={() => void markHumanRequired()}
              onResolved={() => void markResolved()}
              disabled={working}
            />

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {loadingDetail ? (
                <LoadingBox text="Loading call detail..." />
              ) : (
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_410px]">
                  <section className="space-y-5">
                    <OwnershipStrip
                      ownerLabel={ownerLabel}
                      meetingOwnerLabel={meetingOwnerLabel}
                      whenLabel={
                        selectedCall?.startedAt || selectedCall?.createdAt
                          ? formatDateTime(selectedCall.startedAt || selectedCall.createdAt)
                          : formatDateTime(selectedConversation.updatedAt)
                      }
                      nextAction={
                        selectedConversation.nextAction ||
                        selectedCall?.nextAction ||
                        linkedBooking?.title ||
                        "No next action saved."
                      }
                      meetingLabel={
                        linkedBooking
                          ? `${formatEnum(linkedBooking.status)}${linkedBooking.dateTime ? ` · ${formatDateTime(linkedBooking.dateTime, linkedBooking.timezone)}` : ""}`
                          : "No meeting linked"
                      }
                    />

                    <RecordingPanel call={selectedCall} />

                    <Panel title="AI summary" icon={<Bot size={20} aria-hidden />}>
                      <p className="text-sm leading-7 text-white/55">
                        {selectedConversation.aiSummary ||
                          selectedCall?.summary ||
                          "No AI summary available."}
                      </p>
                    </Panel>

                    <RequirementsPanel
                      analysis={analysis}
                      fallbackSummary={
                        selectedConversation.customer?.requirementSummary ||
                        selectedConversation.intent ||
                        null
                      }
                    />

                    <BusinessIntentPanel analysis={analysis} />
                    <HumeInsightsPanel analysis={selectedCall?.humeExpressionAnalysis} />

                    <TranscriptPanel
                      raw={latestTranscript}
                      messages={selectedConversation.messages}
                      defaultExpanded={false}
                    />

                    <Panel title="Callback task" icon={<Phone size={20} aria-hidden />}>
                      <form onSubmit={createCallbackTask} className="space-y-3">
                        <label className="block text-xs text-white/35">
                          Task title
                          <input
                            value={callbackTitle}
                            onChange={(event) => setCallbackTitle(event.target.value)}
                            className="mt-1 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                          />
                        </label>
                        <label className="block text-xs text-white/35">
                          Task description
                          <textarea
                            value={callbackDescription}
                            onChange={(event) => setCallbackDescription(event.target.value)}
                            className="mt-1 min-h-28 w-full resize-none rounded-3xl border border-white/10 bg-black/25 px-5 py-4 text-sm leading-7 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                          />
                        </label>
                        <div className="grid gap-2 md:grid-cols-2">
                          <button
                            type="submit"
                            disabled={working || !callbackTitle.trim()}
                            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                          >
                            {working ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                            Create task
                          </button>
                          <button
                            type="button"
                            onClick={() => void markHumanRequired()}
                            disabled={working}
                            className="h-12 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 text-sm font-semibold text-amber-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                          >
                            Mark human required
                          </button>
                        </div>
                      </form>
                    </Panel>
                  </section>

                  <aside className="space-y-5">
                    <Panel title="Next action" icon={<ShieldAlert size={20} aria-hidden />}>
                      <p className="text-sm leading-7 text-white/55">
                        {selectedConversation.nextAction ||
                          selectedCall?.nextAction ||
                          "No next action saved."}
                      </p>
                    </Panel>

                    <Panel title="Customer" icon={<UserRound size={20} aria-hidden />}>
                      <InfoRow label="Name" value={selectedConversation.customer?.fullName || "Unknown"} />
                      <InfoRow label="Business" value={selectedConversation.customer?.businessType || "-"} />
                      <InfoRow
                        label="Phone"
                        value={
                          selectedConversation.customer?.phone ||
                          selectedCall?.phone ||
                          "-"
                        }
                      />
                      <InfoRow label="Email" value={selectedConversation.customer?.email || "-"} />
                      <InfoRow label="Source" value={selectedConversation.customer?.source || "-"} />
                    </Panel>

                    <Panel title="Call details" icon={<PhoneCall size={20} aria-hidden />}>
                      <InfoRow label="Direction" value={selectedCall?.direction || "INBOUND"} />
                      <InfoRow label="Call status" value={formatEnum(selectedCall?.status)} />
                      <InfoRow label="Duration" value={formatDuration(selectedCall?.durationSeconds || 0)} />
                      <InfoRow
                        label="When"
                        value={
                          selectedCall?.startedAt || selectedCall?.createdAt
                            ? formatDateTime(selectedCall.startedAt || selectedCall.createdAt)
                            : "-"
                        }
                      />
                      <InfoRow label="Call owner" value={callOwnerLabel} />
                      {canReassignCalls ? (
                        <label className="block border-t border-white/10 pt-3 text-xs text-white/35">
                          Reassign call owner
                          <select
                            value={selectedCall?.assignedUserId || ""}
                            disabled={assignmentWorking || !selectedCall?.id}
                            onChange={(event) => {
                              const next = event.target.value || null;
                              void updateCallOwner(next);
                            }}
                            className="mt-1 h-11 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                          >
                            <option value="">Unassigned</option>
                            {teamMembers.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name}
                              </option>
                            ))}
                          </select>
                          {assignmentWorking ? (
                            <p className="mt-2 flex items-center gap-2 text-white/45">
                              <Loader2 className="animate-spin" size={14} />
                              Updating owner...
                            </p>
                          ) : null}
                          {assignmentError ? (
                            <p className="mt-2 text-amber-200">{assignmentError}</p>
                          ) : null}
                        </label>
                      ) : null}
                      <InfoRow label="Provider" value={selectedCall?.provider || selectedConversation.provider || "-"} />
                      <InfoRow label="Recording status" value={selectedCall?.recordingStatus || "-"} />
                      <InfoRow label="Recording source" value={selectedCall?.recordingSource || "-"} />
                      <InfoRow label="Failure reason" value={selectedCall?.failureReason || "-"} />
                    </Panel>

                    <Panel title="Meeting" icon={<CalendarCheck size={20} aria-hidden />}>
                      {linkedBooking ? (
                        <>
                          <InfoRow label="Title" value={linkedBooking.title} />
                          <InfoRow label="Status" value={formatEnum(linkedBooking.status)} />
                          <InfoRow
                            label="Acceptance"
                            value={formatEnum(linkedBooking.acceptanceStatus || "PENDING_ACCEPTANCE")}
                          />
                          <InfoRow
                            label="When"
                            value={
                              linkedBooking.dateTime
                                ? formatDateTime(linkedBooking.dateTime, linkedBooking.timezone)
                                : "Not set"
                            }
                          />
                          <InfoRow
                            label="Meeting owner"
                            value={meetingOwnerLabel}
                          />
                        </>
                      ) : (
                        <p className="text-sm text-white/40">No meeting linked to this call yet.</p>
                      )}
                    </Panel>

                    <Panel title="Latest calls" icon={<Clock3 size={20} aria-hidden />}>
                      {latestCalls.length === 0 ? (
                        <p className="text-sm text-white/40">No latest calls returned.</p>
                      ) : (
                        <div className="space-y-3">
                          {latestCalls.slice(0, 5).map((call) => (
                            <button
                              key={call.id}
                              type="button"
                              onClick={() =>
                                call.conversationId
                                  ? void selectConversation(call.conversationId)
                                  : undefined
                              }
                              className="w-full rounded-2xl border border-white/10 bg-black/25 p-4 text-left hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {call.conversation?.customer?.fullName || call.phone || "Unknown"}
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
              )}
            </div>
          </div>
        )}
      </main>
    </section>
  );
}

function OwnershipStrip({
  ownerLabel,
  meetingOwnerLabel,
  whenLabel,
  nextAction,
  meetingLabel,
}: {
  ownerLabel: string;
  meetingOwnerLabel: string;
  whenLabel: string;
  nextAction: string;
  meetingLabel: string;
}) {
  return (
    <div className="grid gap-3 rounded-[28px] border border-white/10 bg-black/20 p-4 md:grid-cols-5">
      <StripStat label="Call owner" value={ownerLabel} />
      <StripStat label="Meeting owner" value={meetingOwnerLabel} />
      <StripStat label="When" value={whenLabel} />
      <StripStat label="Meeting" value={meetingLabel} />
      <StripStat label="Next action" value={nextAction} />
    </div>
  );
}

function StripStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-white/35">{label}</p>
      <p className="mt-1 line-clamp-2 text-sm text-white/75">{value}</p>
    </div>
  );
}

function RecordingPanel({ call }: { call: CallRecord | null }) {
  const uiState = resolveRecordingUiState(call);
  const mediaUrl = call?.recordingMediaUrl || null;

  return (
    <Panel title="Recording" icon={<Headphones size={20} aria-hidden />}>
      {!call ? (
        <p className="text-sm text-white/40">No call row exists yet for this conversation.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <StatusChip label={`State: ${formatEnum(uiState)}`} />
            {call.recordingSource ? (
              <StatusChip label={`Source: ${formatEnum(call.recordingSource)}`} />
            ) : null}
            {uiState === "legacy" ? <StatusChip label="Legacy Twilio recording" /> : null}
            {uiState === "hume" ? <StatusChip label="Hume reconstructed recording" /> : null}
          </div>

          {uiState === "preparing" ? (
            <p className="text-sm text-amber-100/80" role="status">
              Recording is being prepared. Playback will appear when media is ready.
            </p>
          ) : null}
          {uiState === "failed" ? (
            <p className="text-sm text-red-100/80" role="status">
              Recording failed{call.failureReason ? `: ${call.failureReason}` : "."}
            </p>
          ) : null}
          {uiState === "unavailable" ? (
            <p className="text-sm text-white/40" role="status">
              Recording is unavailable for this call.
            </p>
          ) : null}

          {mediaUrl && uiState !== "failed" ? (
            <AuthenticatedAudioPlayer url={mediaUrl} label="Authenticated call recording" />
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <InfoRow label="Recording status" value={call.recordingStatus || "-"} />
            <InfoRow
              label="Recording duration"
              value={
                call.recordingDurationSeconds
                  ? formatDuration(call.recordingDurationSeconds)
                  : "-"
              }
            />
            <InfoRow label="Reconstruction" value={call.recordingReconstructionStatus || "-"} />
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
      )}
    </Panel>
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
  const analysis = call?.postCallAnalysis || conversation.latestCallAnalysis;
  const booking = conversation.bookings?.[0];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-3xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
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
            {conversation.customer?.businessType ||
              conversation.customer?.phone ||
              call?.phone ||
              "No phone"}
          </p>
        </div>
        <ConversationStatusBadge status={String(conversation.status)} />
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-5 text-white/55">
        {analysis?.requirementSummary ||
          conversation.aiSummary ||
          conversation.lastMessage ||
          "No summary yet"}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {call ? <CallStatusBadge status={call.status} /> : null}
        <PriorityBadge priority={String(conversation.priority)} />
        <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
          Next: {conversation.nextAction || "—"}
        </span>
        {booking ? (
          <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
            Meeting: {formatEnum(booking.status)}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function CallHeader({
  conversation,
  call,
  ownerLabel,
  onHumanRequired,
  onResolved,
  disabled,
}: {
  conversation: CallConversation;
  call: CallRecord | null;
  ownerLabel: string;
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
              <PhoneCall size={13} aria-hidden />
              AI Call
            </span>
            <ConversationStatusBadge status={String(conversation.status)} />
            {call ? <CallStatusBadge status={call.status} /> : null}
            <PriorityBadge priority={String(conversation.priority)} />
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
            {conversation.customer?.fullName || "Unknown Customer"}
          </h2>
          <p className="mt-2 text-sm text-white/45">
            {conversation.customer?.businessType
              ? `${conversation.customer.businessType} · `
              : ""}
            {conversation.customer?.phone || call?.phone || "No phone"} · Owner {ownerLabel} ·{" "}
            {formatRelative(conversation.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 xl:justify-end">
          <button
            type="button"
            onClick={onHumanRequired}
            disabled={disabled}
            className="h-11 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 text-sm font-semibold text-amber-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            Human follow-up
          </button>
          <button
            type="button"
            onClick={onResolved}
            disabled={disabled}
            className="h-11 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            Mark resolved
          </button>
        </div>
      </div>
    </div>
  );
}

function OutboundAiCallBox(props: {
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
      onSubmit={props.onSubmit}
      className="mt-4 rounded-[26px] border border-cyan-400/15 bg-cyan-500/[0.06] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium text-cyan-100">
            <PhoneCall size={13} aria-hidden />
            Start AI outbound call
          </div>
          <p className="mt-2 text-xs leading-5 text-white/40">
            Uses backend Hume outbound API. Only start when intentionally testing with a real number.
          </p>
        </div>
        {props.onUseSelected ? (
          <button
            type="button"
            onClick={props.onUseSelected}
            className="shrink-0 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-white/55 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            Use selected
          </button>
        ) : null}
      </div>
      <div className="mt-4 grid gap-2">
        <input value={props.name} onChange={(e) => props.onNameChange(e.target.value)} className="h-11 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none" placeholder="Client name" aria-label="Client name" />
        <input value={props.phone} onChange={(e) => props.onPhoneChange(e.target.value)} className="h-11 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none" placeholder="Phone with country code" aria-label="Phone" />
        <select value={props.language} onChange={(e) => props.onLanguageChange(e.target.value as AiCallLanguage)} className="h-11 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none" aria-label="Language">
          <option value="AUTO" className="bg-[#05070d]">Auto-detect language</option>
          <option value="ENGLISH" className="bg-[#05070d]">English</option>
          <option value="HINDI" className="bg-[#05070d]">Hindi</option>
          <option value="GUJARATI" className="bg-[#05070d]">Gujarati</option>
        </select>
        <textarea value={props.purpose} onChange={(e) => props.onPurposeChange(e.target.value)} className="min-h-20 resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none" placeholder="Purpose" aria-label="Purpose" />
        <textarea value={props.notes} onChange={(e) => props.onNotesChange(e.target.value)} className="min-h-20 resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none" placeholder="AI instructions" aria-label="AI instructions" />
      </div>
      <button type="submit" disabled={props.working || !props.phone.trim()} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
        {props.working ? <Loader2 className="animate-spin" size={16} /> : <PhoneCall size={16} />}
        Start AI call
      </button>
    </form>
  );
}

function FilterSelect({
  icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
      <span className="text-white/35" aria-hidden>{icon}</span>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full bg-transparent text-sm outline-none" aria-label={label}>
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

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="border-b border-white/10 py-3 last:border-b-0">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-1 break-words text-sm text-white/70">{value || "-"}</p>
    </div>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
      {label}
    </span>
  );
}

function ConversationStatusBadge({ status }: { status: string }) {
  const icon =
    status === "CONVERTED" ? <CheckCircle2 size={13} /> :
    status === "HUMAN_REQUIRED" ? <AlertTriangle size={13} /> :
    status === "LOST" ? <XCircle size={13} /> :
    <Clock3 size={13} />;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
      {icon}
      {formatEnum(status)}
    </span>
  );
}

function CallStatusBadge({ status }: { status: string }) {
  const tone =
    ["MISSED", "NO_ANSWER", "BUSY", "CANCELED", "FAILED"].includes(status)
      ? "border-red-400/20 bg-red-500/10 text-red-100/75"
      : ["LIVE", "IN_PROGRESS", "RINGING"].includes(status)
        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100/75"
        : "border-white/10 bg-white/[0.04] text-white/50";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${tone}`}>
      <PhoneCall size={13} aria-hidden />
      {formatEnum(status)}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
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

function LoadingBox({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-white/40" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        {text}
      </div>
    </div>
  );
}

function EmptyBox({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-8 text-center">
      <div className="text-white/35">{icon}</div>
      <h2 className="mt-5 text-2xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-white/40">{text}</p>
    </div>
  );
}
