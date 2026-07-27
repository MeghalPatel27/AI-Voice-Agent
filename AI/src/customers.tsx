import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  IndianRupee,
  KanbanSquare,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Target,
  Upload,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type LeadFilter =
  | "ALL"
  | "NEW"
  | "HOT"
  | "FOLLOW_UP_DUE"
  | "MEETING_BOOKED"
  | "QUOTATION_SENT"
  | "WON"
  | "LOST";

type ViewMode = "LIST" | "PIPELINE";

type LeadRow = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  source: string;
  channel?: string | null;

  stage: string;
  stageLabel: string;
  handlingStatus: string;

  priority: string;
  ownerLabel: string;
  ownerType: string;
  ownerId?: string | null;

  nextAction: string;
  followUpAt?: string | null;
  followUpTaskTitle?: string | null;

  estimatedDealValue: number | null;
  dealValueStatus: string;

  lastActivityAt: string;
  summary: string;
  intent?: string | null;
  latestCallAnalysis?: import("./lib/postCallAnalysis").PostCallAnalysisView | null;

  aiScore: number;
  aiScoreLabel: string;
  aiScoreReasons: string[];

  warnings: string[];

  meetingBooked: boolean;
  totalConversations: number;
  totalTasks: number;
  totalBookings: number;

  createdAt: string;
  updatedAt: string;
};

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type PipelineColumn = {
  stage: string;
  stageLabel: string;
  leads: LeadRow[];
};

type SourceBreakdown = {
  source: string;
  leads: number;
  hot: number;
  meetings: number;
  won: number;
  lost: number;
  conversionRate: number;
};

type LeadsResponse = {
  summary: {
    total: number;
    needsFollowUp: number;
    hot: number;
    meetingsBooked: number;
    wonThisMonth: number;
    pipelineValue: {
      connected: boolean;
      total: number | null;
      message: string;
    };
  };
  leads: LeadRow[];
  todayPriority: LeadRow[];
  pipeline: PipelineColumn[];
  sourceBreakdown: SourceBreakdown[];
  teamMembers: TeamMember[];
  modules: {
    quotationEnabled: boolean;
    dealValueEnabled: boolean;
    csvImportEnabled: boolean;
  };
};

type LeadDetail = LeadRow & {
  customer: unknown;
  conversations: {
    id: string;
    channel: string;
    status: string;
    priority: string;
    aiSummary?: string | null;
    lastMessage?: string | null;
    updatedAt: string;
    messages?: {
      id: string;
      senderType: "CUSTOMER" | "AI" | "HUMAN";
      body: string;
      createdAt: string;
    }[];
    calls?: {
      id: string;
      status: string;
      transcript?: string | null;
      durationSeconds: number;
      createdAt: string;
    }[];
  }[];
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt?: string | null;
    delayed?: boolean;
    assignedUser?: TeamMember | null;
    owner?: string | null;
    createdAt: string;
  }[];
  bookings: {
    id: string;
    title: string;
    dateTime?: string | null;
    status: string;
    createdAt: string;
  }[];
  timeline: {
    id: string;
    type: string;
    title: string;
    description: string;
    createdAt: string;
  }[];
};

type LeadDetailResponse = {
  lead: LeadDetail;
};
type OutboundAiCallResponse = {
  message: string;
  customer: { id: string; fullName?: string | null; phone?: string | null };
  conversation: { id: string };
  call: { id: string; providerCallId?: string | null };
};

const filters: {
  label: string;
  value: LeadFilter;
}[] = [
  { label: "All", value: "ALL" },
  { label: "New", value: "NEW" },
  { label: "Hot", value: "HOT" },
  { label: "Follow-up Due", value: "FOLLOW_UP_DUE" },
  { label: "Meeting Booked", value: "MEETING_BOOKED" },
  { label: "Quotation Sent", value: "QUOTATION_SENT" },
  { label: "Won", value: "WON" },
  { label: "Lost", value: "LOST" },
];

const sourceOptions = [
  { label: "All Sources", value: "ALL" },
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "Calls", value: "AI_CALL" },
  { label: "Website", value: "WEBSITE_CHAT" },
  { label: "Manual", value: "Manual" },
];

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value?: string | null) {
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

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not set";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPriorityTone(priority: string) {
  if (priority === "CRITICAL" || priority === "HIGH") return "danger";
  if (priority === "MEDIUM") return "warning";
  return "normal";
}

function getStageTone(stage: string) {
  if (stage === "WON") return "success";
  if (stage === "LOST") return "muted";
  if (stage === "FOLLOW_UP") return "warning";
  if (stage === "MEETING_BOOKED") return "info";
  return "normal";
}

export default function CustomersPage() {
  const [filter, setFilter] = useState<LeadFilter>("ALL");
  const [source, setSource] = useState("ALL");
  const [owner, setOwner] = useState("ALL");
  const [view, setView] = useState<ViewMode>("LIST");
  const [search, setSearch] = useState("");

  const [summary, setSummary] = useState<LeadsResponse["summary"]>({
    total: 0,
    needsFollowUp: 0,
    hot: 0,
    meetingsBooked: 0,
    wonThisMonth: 0,
    pipelineValue: {
      connected: false,
      total: null,
      message: "Deal value fields are not added yet.",
    },
  });

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [todayPriority, setTodayPriority] = useState<LeadRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineColumn[]>([]);
  const [sourceBreakdown, setSourceBreakdown] = useState<SourceBreakdown[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [modules, setModules] = useState<LeadsResponse["modules"]>({
    quotationEnabled: false,
    dealValueEnabled: false,
    csvImportEnabled: false,
  });

  const [selectedId, setSelectedId] = useState("");
  const [selectedLead, setSelectedLead] = useState<LeadDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadLeads(nextSelectedId?: string) {
    try {
      setError("");
      setLoading(true);

      const params = new URLSearchParams({
        filter,
        source,
        owner,
        view,
      });

      if (search.trim()) {
        params.set("search", search.trim());
      }

      const data = await apiFetch<LeadsResponse>(
        `/api/customers/leads?${params.toString()}`,
      );

      setSummary(data.summary);
      setLeads(data.leads);
      setTodayPriority(data.todayPriority);
      setPipeline(data.pipeline);
      setSourceBreakdown(data.sourceBreakdown);
      setTeamMembers(data.teamMembers);
      setModules(data.modules);

      const id = nextSelectedId || selectedId || data.leads[0]?.id || "";

      setSelectedId(id);

      if (id) {
        await loadLeadDetail(id);
      } else {
        setSelectedLead(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }

  async function loadLeadDetail(id: string) {
    try {
      setSelectedId(id);
      setLoadingDetail(true);

      const data = await apiFetch<LeadDetailResponse>(
        `/api/customers/${id}/lead`,
      );

      setSelectedLead(data.lead);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open lead");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function refreshSelected() {
    if (!selectedId) {
      await loadLeads();
      return;
    }

    await Promise.all([loadLeads(selectedId), loadLeadDetail(selectedId)]);
  }

  async function createLead() {
    const fullName = window.prompt("Lead name");
    if (!fullName?.trim()) return;

    const phone = window.prompt("Phone number");
    if (!phone?.trim()) return;

    const requirement = window.prompt("Requirement / inquiry", "");

    try {
      setSaving(true);
      setError("");

      const data = await apiFetch<{ customer: { id: string } }>(
        "/api/customers/leads",
        {
          method: "POST",
          body: JSON.stringify({
            fullName: fullName.trim(),
            phone: phone.trim(),
            source: "Manual",
            requirement: requirement?.trim() || null,
          }),
        },
      );

      await loadLeads(data.customer.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead");
    } finally {
      setSaving(false);
    }
  }

  async function runLeadAction(
    action:
      | "QUALIFY"
      | "TAKE_OVER"
      | "RETURN_TO_AI"
      | "SET_FOLLOW_UP"
      | "BOOK_MEETING"
      | "MARK_WON"
      | "MARK_LOST",
  ) {
    if (!selectedLead) return;

    let note: string | null = null;
    let dueAt: string | null = null;

    if (action === "SET_FOLLOW_UP") {
      note =
        window.prompt("Follow-up note", selectedLead.nextAction) ||
        "Follow up with customer";

      dueAt = window.prompt(
        "Follow-up date/time in ISO format, or leave empty",
        "",
      );
    }

    try {
      setSaving(true);
      setError("");

      await apiFetch(`/api/customers/${selectedLead.id}/lead/actions`, {
        method: "POST",
        body: JSON.stringify({
          action,
          note,
          dueAt: dueAt?.trim() || null,
        }),
      });

      await refreshSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSaving(false);
    }
  }

  async function createTask() {
    if (!selectedLead) return;

    const title = window.prompt(
      "Task title",
      selectedLead.nextAction || "Follow up with lead",
    );

    if (!title?.trim()) return;

    try {
      setSaving(true);
      setError("");

      await apiFetch(`/api/customers/${selectedLead.id}/lead/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: selectedLead.summary,
          priority:
            selectedLead.priority === "CRITICAL" ||
            selectedLead.priority === "HIGH"
              ? selectedLead.priority
              : "MEDIUM",
          dueAt: null,
        }),
      });

      await refreshSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  }

  async function createBooking() {
    if (!selectedLead) return;

    const title = window.prompt(
      "Booking / meeting title",
      `Meeting with ${selectedLead.name}`,
    );

    if (!title?.trim()) return;

    const dateTime = window.prompt(
      "Meeting date/time in ISO format, or leave empty",
      "",
    );

    try {
      setSaving(true);
      setError("");

      await apiFetch(`/api/customers/${selectedLead.id}/lead/bookings`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          dateTime: dateTime?.trim() || null,
        }),
      });

      await refreshSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to book meeting");
    } finally {
      setSaving(false);
    }
  }

  async function startAiCallForLead() {
    if (!selectedLead) return;

    const phone = window.prompt(
      "Phone number to call",
      selectedLead.phone || "",
    );
    if (!phone?.trim()) return;

    const purpose = window.prompt(
      "AI call purpose",
      `Call ${selectedLead.name}, collect website requirements, schedule a meeting, and save summary in CRM.`,
    );

    const languageInput = window.prompt(
      "AI speaking language: AUTO, ENGLISH, HINDI, or GUJARATI",
      "AUTO",
    );

    const preferredLanguage = ["ENGLISH", "HINDI", "GUJARATI"].includes(
      String(languageInput || "AUTO")
        .toUpperCase()
        .trim(),
    )
      ? String(languageInput || "AUTO")
          .toUpperCase()
          .trim()
      : "AUTO";

    try {
      setSaving(true);
      setError("");

      await apiFetch<OutboundAiCallResponse>("/api/calls/outbound-ai", {
        method: "POST",
        body: JSON.stringify({
          name: selectedLead.name,
          phone: phone.trim(),
          purpose: purpose?.trim() || undefined,
          notes: selectedLead.summary || selectedLead.nextAction || undefined,
          preferredLanguage,
        }),
      });

      await refreshSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start AI call");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadLeads();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [filter, source, owner, view, search]);

  const ownerOptions = useMemo(() => {
    return [
      { label: "All Owners", value: "ALL" },
      { label: "AI", value: "AI" },
      { label: "Unassigned", value: "UNASSIGNED" },
      ...teamMembers.map((member) => ({
        label: member.name,
        value: member.id,
      })),
    ];
  }, [teamMembers]);

  return (
    <section className="space-y-5">
      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-cyan-200">
              <Target size={14} />
              Sales Command Center
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
              Leads
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
              Track every inquiry, follow-up, meeting, and deal in one place.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={createLead}
              disabled={saving}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
            >
              <Plus size={16} />
              Add Lead
            </button>

            <button
              disabled
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/35"
            >
              <Upload size={16} />
              Import CSV
            </button>

            <button
              onClick={() => loadLeads()}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 hover:text-white"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryCard label="Total Leads" value={summary.total} />
          <SummaryCard
            label="Needs Follow-up"
            value={summary.needsFollowUp}
            tone={summary.needsFollowUp > 0 ? "warning" : "normal"}
          />
          <SummaryCard
            label="Hot Leads"
            value={summary.hot}
            tone={summary.hot > 0 ? "danger" : "normal"}
          />
          <SummaryCard
            label="Meetings Booked"
            value={summary.meetingsBooked}
            tone="info"
          />
          <SummaryCard
            label="Pipeline Value"
            value={
              summary.pipelineValue.connected
                ? summary.pipelineValue.total
                : "Not set"
            }
          />
          <SummaryCard
            label="Won This Month"
            value={summary.wonThisMonth}
            tone="success"
          />
        </div>

        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <button
                key={item.value}
                onClick={() => setFilter(item.value)}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  filter === item.value
                    ? "border-white bg-white text-black"
                    : "border-white/10 bg-white/[0.05] text-white/55 hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-[1fr_220px_220px_220px]">
            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
              <Search size={17} className="text-white/30" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search leads by name, phone, company, requirement..."
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25"
              />
            </div>

            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              {sourceOptions.map((item) => (
                <option
                  key={item.value}
                  value={item.value}
                  className="bg-[#05070d]"
                >
                  {item.label}
                </option>
              ))}
            </select>

            <select
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              {ownerOptions.map((item) => (
                <option
                  key={item.value}
                  value={item.value}
                  className="bg-[#05070d]"
                >
                  {item.label}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setView("LIST")}
                className={`rounded-2xl border px-4 text-sm ${
                  view === "LIST"
                    ? "border-white bg-white text-black"
                    : "border-white/10 bg-black/25 text-white/50"
                }`}
              >
                List View
              </button>
              <button
                onClick={() => setView("PIPELINE")}
                className={`rounded-2xl border px-4 text-sm ${
                  view === "PIPELINE"
                    ? "border-white bg-white text-black"
                    : "border-white/10 bg-black/25 text-white/50"
                }`}
              >
                Pipeline
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}
      </section>

      {todayPriority.length > 0 ? (
        <section className="rounded-[34px] border border-amber-500/20 bg-amber-500/10 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <AlertTriangle size={18} />
            Today’s Priority Leads
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            {todayPriority.map((lead) => (
              <button
                key={lead.id}
                onClick={() => loadLeadDetail(lead.id)}
                className="rounded-[26px] border border-amber-500/20 bg-black/20 p-4 text-left hover:bg-black/30"
              >
                <p className="font-semibold text-amber-50">{lead.name}</p>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-amber-100/70">
                  {lead.nextAction}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone="warning">{lead.stageLabel}</Badge>
                  <Badge tone={getPriorityTone(lead.priority)}>
                    {formatEnum(lead.priority)}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5">
          {loading ? (
            <LoadingState text="Loading leads..." />
          ) : view === "PIPELINE" ? (
            <PipelineView
              pipeline={pipeline}
              selectedId={selectedId}
              onSelect={loadLeadDetail}
            />
          ) : (
            <LeadTable
              leads={leads}
              selectedId={selectedId}
              onSelect={loadLeadDetail}
            />
          )}
        </section>

        <LeadDetailPanel
          lead={selectedLead}
          loading={loadingDetail}
          modules={modules}
          saving={saving}
          onQualify={() => runLeadAction("QUALIFY")}
          onTakeOver={() => runLeadAction("TAKE_OVER")}
          onReturnToAi={() => runLeadAction("RETURN_TO_AI")}
          onFollowUp={() => runLeadAction("SET_FOLLOW_UP")}
          onBookMeeting={createBooking}
          onCreateTask={createTask}
          onStartAiCall={startAiCallForLead}
          onWon={() => runLeadAction("MARK_WON")}
          onLost={() => runLeadAction("MARK_LOST")}
        />
      </div>

      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
          <BarChart3 size={18} />
          Source Quality
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-white/35">
              <tr>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Leads</th>
                <th className="px-4 py-3">Hot</th>
                <th className="px-4 py-3">Meetings</th>
                <th className="px-4 py-3">Won</th>
                <th className="px-4 py-3">Lost</th>
                <th className="px-4 py-3">Conversion</th>
              </tr>
            </thead>

            <tbody>
              {sourceBreakdown.length === 0 ? (
                <tr>
                  <td className="px-4 py-5 text-white/40" colSpan={7}>
                    No source data yet.
                  </td>
                </tr>
              ) : (
                sourceBreakdown.map((row) => (
                  <tr key={row.source} className="border-t border-white/10">
                    <td className="px-4 py-4 font-medium">{row.source}</td>
                    <td className="px-4 py-4 text-white/65">{row.leads}</td>
                    <td className="px-4 py-4 text-white/65">{row.hot}</td>
                    <td className="px-4 py-4 text-white/65">{row.meetings}</td>
                    <td className="px-4 py-4 text-white/65">{row.won}</td>
                    <td className="px-4 py-4 text-white/65">{row.lost}</td>
                    <td className="px-4 py-4 text-white/65">
                      {row.conversionRate}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function LeadTable({
  leads,
  selectedId,
  onSelect,
}: {
  leads: LeadRow[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (leads.length === 0) {
    return (
      <EmptyState
        icon={<Target size={34} />}
        title="No leads found"
        description="Leads will appear here when customers contact you or when you add them manually."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1120px] text-left text-sm">
        <thead className="text-xs text-white/35">
          <tr>
            <th className="px-4 py-3">Lead</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Stage</th>
            <th className="px-4 py-3">Priority</th>
            <th className="px-4 py-3">Owner</th>
            <th className="px-4 py-3">Next Action</th>
            <th className="px-4 py-3">Follow-up</th>
            <th className="px-4 py-3">Value</th>
            <th className="px-4 py-3">Last Activity</th>
          </tr>
        </thead>

        <tbody>
          {leads.map((lead) => {
            const active = selectedId === lead.id;

            return (
              <tr
                key={lead.id}
                onClick={() => onSelect(lead.id)}
                className={`cursor-pointer border-t border-white/10 transition ${
                  active ? "bg-white/[0.09]" : "hover:bg-white/[0.045]"
                }`}
              >
                <td className="px-4 py-4">
                  <div>
                    <p className="font-semibold">{lead.name}</p>
                    <p className="mt-1 text-xs text-white/35">
                      {lead.phone} {lead.email ? `· ${lead.email}` : ""}
                    </p>

                    {lead.warnings.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {lead.warnings.slice(0, 2).map((warning) => (
                          <Badge key={warning} tone="danger">
                            {warning}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </td>

                <td className="px-4 py-4 text-white/60">{lead.source}</td>

                <td className="px-4 py-4">
                  <Badge tone={getStageTone(lead.stage)}>
                    {lead.stageLabel}
                  </Badge>
                </td>

                <td className="px-4 py-4">
                  <Badge tone={getPriorityTone(lead.priority)}>
                    {formatEnum(lead.priority)}
                  </Badge>
                </td>

                <td className="px-4 py-4 text-white/65">{lead.ownerLabel}</td>

                <td className="max-w-[260px] px-4 py-4">
                  <p className="line-clamp-2 text-white/70">
                    {lead.nextAction}
                  </p>
                </td>

                <td className="px-4 py-4 text-white/65">
                  {formatDateTime(lead.followUpAt)}
                </td>

                <td className="px-4 py-4 text-white/45">
                  {lead.dealValueStatus}
                </td>

                <td className="px-4 py-4 text-white/50">
                  {formatTime(lead.lastActivityAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PipelineView({
  pipeline,
  selectedId,
  onSelect,
}: {
  pipeline: PipelineColumn[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[1180px] grid-cols-7 gap-3">
        {pipeline.map((column) => (
          <div
            key={column.stage}
            className="rounded-[28px] border border-white/10 bg-black/20 p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{column.stageLabel}</p>
                <p className="mt-1 text-xs text-white/35">
                  {column.leads.length} lead
                  {column.leads.length === 1 ? "" : "s"}
                </p>
              </div>
              <KanbanSquare size={16} className="text-white/35" />
            </div>

            <div className="space-y-2">
              {column.leads.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/30">
                  No leads
                </div>
              ) : (
                column.leads.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => onSelect(lead.id)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      selectedId === lead.id
                        ? "border-white bg-white text-black"
                        : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    }`}
                  >
                    <p className="truncate text-sm font-semibold">
                      {lead.name}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs opacity-60">
                      {lead.nextAction}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge
                        active={selectedId === lead.id}
                        tone={getPriorityTone(lead.priority)}
                      >
                        {formatEnum(lead.priority)}
                      </Badge>
                      <Badge active={selectedId === lead.id}>
                        {lead.aiScore}%
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadDetailPanel({
  lead,
  loading,
  modules,
  saving,
  onQualify,
  onTakeOver,
  onReturnToAi,
  onFollowUp,
  onBookMeeting,
  onCreateTask,
  onStartAiCall,
  onWon,
  onLost,
}: {
  lead: LeadDetail | null;
  loading: boolean;
  modules: LeadsResponse["modules"];
  saving: boolean;
  onQualify: () => void;
  onTakeOver: () => void;
  onReturnToAi: () => void;
  onFollowUp: () => void;
  onBookMeeting: () => void;
  onCreateTask: () => void;
  onStartAiCall: () => void;
  onWon: () => void;
  onLost: () => void;
}) {
  if (loading) {
    return (
      <aside className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <LoadingState text="Opening lead..." />
      </aside>
    );
  }

  if (!lead) {
    return (
      <aside className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <EmptyState
          icon={<UserRound size={34} />}
          title="Select a lead"
          description="Lead profile, AI score, next action, tasks and timeline will appear here."
        />
      </aside>
    );
  }

  return (
    <aside className="h-fit space-y-5 rounded-[34px] border border-white/10 bg-white/[0.04] p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-[-0.05em]">
            {lead.name}
          </h2>
          <Badge tone={getStageTone(lead.stage)}>{lead.stageLabel}</Badge>
        </div>

        <p className="mt-2 text-sm text-white/40">
          {lead.phone} {lead.email ? `· ${lead.email}` : ""}
        </p>

        <p className="mt-4 text-sm leading-7 text-white/58">{lead.summary}</p>
      </div>

      {lead.latestCallAnalysis ? (
        <PanelBlock title="Customer Intent" icon={<Sparkles size={16} />}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  lead.latestCallAnalysis.analysisStatus === "COMPLETED"
                    ? lead.latestCallAnalysis.intentLevel === "HIGH" ||
                      lead.latestCallAnalysis.intentLevel === "VERY_HIGH"
                      ? "success"
                      : lead.latestCallAnalysis.intentLevel === "MEDIUM"
                        ? "warning"
                        : lead.latestCallAnalysis.intentLevel === "LOW" ||
                            lead.latestCallAnalysis.intentLevel === "NOT_INTERESTED"
                          ? "danger"
                          : "muted"
                    : lead.latestCallAnalysis.analysisStatus === "FAILED"
                      ? "danger"
                      : "warning"
                }
              >
                {lead.latestCallAnalysis.analysisStatus === "COMPLETED"
                  ? lead.latestCallAnalysis.intentLevel === "VERY_HIGH"
                    ? "Very high interest"
                    : lead.latestCallAnalysis.intentLevel === "HIGH"
                      ? "High interest"
                      : lead.latestCallAnalysis.intentLevel === "MEDIUM"
                        ? "Medium interest"
                        : lead.latestCallAnalysis.intentLevel === "LOW"
                          ? "Low interest"
                          : lead.latestCallAnalysis.intentLevel === "NOT_INTERESTED"
                            ? "Not interested"
                            : "Intent unclear"
                  : lead.latestCallAnalysis.analysisStatus === "PENDING"
                    ? "Pending analysis"
                    : lead.latestCallAnalysis.analysisStatus === "PROCESSING"
                      ? "Analyzing call"
                      : lead.latestCallAnalysis.analysisStatus === "INSUFFICIENT_DATA"
                        ? "Insufficient conversation data"
                        : lead.latestCallAnalysis.analysisStatus === "FAILED"
                          ? "Analysis unavailable"
                          : "No analysis yet"}
              </Badge>
              {lead.latestCallAnalysis.intentScore != null ? (
                <Badge tone="normal">
                  Score {lead.latestCallAnalysis.intentScore}/100
                </Badge>
              ) : null}
            </div>

            {lead.latestCallAnalysis.requirementSummary ? (
              <p className="text-sm leading-7 text-white/65">
                {lead.latestCallAnalysis.requirementSummary}
              </p>
            ) : null}

            {(lead.latestCallAnalysis.requirementDetails?.desiredCapabilities || [])
              .length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(
                  lead.latestCallAnalysis.requirementDetails?.desiredCapabilities || []
                )
                  .slice(0, 6)
                  .map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/65"
                    >
                      {item}
                    </span>
                  ))}
              </div>
            ) : null}

            {lead.latestCallAnalysis.requirementDetails?.requestedNextStep ? (
              <InfoBox
                label="Requested next step"
                value={lead.latestCallAnalysis.requirementDetails.requestedNextStep}
              />
            ) : null}
            {lead.latestCallAnalysis.requirementDetails?.timelineSignal ? (
              <InfoBox
                label="Timeline"
                value={lead.latestCallAnalysis.requirementDetails.timelineSignal}
              />
            ) : null}
            {lead.latestCallAnalysis.requirementDetails?.budgetSignal ? (
              <InfoBox
                label="Budget signal"
                value={lead.latestCallAnalysis.requirementDetails.budgetSignal}
              />
            ) : null}
          </div>
        </PanelBlock>
      ) : null}

      {lead.warnings.length > 0 ? (
        <div className="rounded-[26px] border border-red-500/20 bg-red-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-100">
            <AlertTriangle size={16} />
            Needs attention
          </div>

          <div className="mt-3 space-y-2">
            {lead.warnings.map((warning) => (
              <p key={warning} className="text-sm text-red-100/75">
                {warning}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <InfoBox
          label="AI Score"
          value={`${lead.aiScore}% · ${lead.aiScoreLabel}`}
        />
        <InfoBox label="Owner" value={lead.ownerLabel} />
        <InfoBox label="Source" value={lead.source} />
        <InfoBox label="Follow-up" value={formatDateTime(lead.followUpAt)} />
        <InfoBox label="Deal Value" value={lead.dealValueStatus} />
        <InfoBox
          label="Last Activity"
          value={formatTime(lead.lastActivityAt)}
        />
      </div>

      <PanelBlock title="Why this AI score?" icon={<Sparkles size={16} />}>
        {lead.aiScoreReasons.length === 0 ? (
          <p className="text-sm text-white/40">No score explanation yet.</p>
        ) : (
          <div className="space-y-2">
            {lead.aiScoreReasons.map((reason) => (
              <div key={reason} className="flex gap-2 text-sm text-white/55">
                <CheckCircle2
                  size={15}
                  className="mt-0.5 shrink-0 text-emerald-100"
                />
                {reason}
              </div>
            ))}
          </div>
        )}
      </PanelBlock>

      <PanelBlock title="Next Best Action" icon={<Target size={16} />}>
        <p className="text-sm font-semibold leading-6 text-white">
          {lead.nextAction}
        </p>
      </PanelBlock>

      <div className="grid grid-cols-2 gap-2">
        <ActionButton onClick={onQualify} disabled={saving}>
          Qualify
        </ActionButton>
        <ActionButton onClick={onTakeOver} disabled={saving}>
          Take Over
        </ActionButton>
        <ActionButton onClick={onReturnToAi} disabled={saving}>
          Return to AI
        </ActionButton>
        <ActionButton onClick={onFollowUp} disabled={saving}>
          Set Follow-up
        </ActionButton>
        <ActionButton onClick={onBookMeeting} disabled={saving}>
          Book Meeting
        </ActionButton>
        <ActionButton onClick={onCreateTask} disabled={saving}>
          Create Task
        </ActionButton>
        <ActionButton onClick={onStartAiCall} disabled={saving}>
          AI Call
        </ActionButton>
        <ActionButton onClick={onWon} disabled={saving}>
          Mark Won
        </ActionButton>
        <ActionButton onClick={onLost} disabled={saving}>
          Mark Lost
        </ActionButton>
      </div>

      {!modules.quotationEnabled ? (
        <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
          <p className="text-sm font-semibold text-white/70">
            Quotation workflow
          </p>
          <p className="mt-2 text-sm leading-6 text-white/38">
            Quotation workflow is not enabled yet. When enabled, this lead can
            show quotation sent, quotation value and quotation status.
          </p>
        </div>
      ) : null}

      <PanelBlock title="Tasks" icon={<Clock3 size={16} />}>
        {lead.tasks.length === 0 ? (
          <p className="text-sm text-white/40">No tasks yet.</p>
        ) : (
          <div className="space-y-3">
            {lead.tasks.slice(0, 5).map((task) => (
              <div
                key={task.id}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{task.title}</p>
                  <Badge tone={task.delayed ? "danger" : "normal"}>
                    {formatEnum(task.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-white/35">
                  {task.assignedUser?.name || task.owner || "Unassigned"} ·{" "}
                  {formatDateTime(task.dueAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </PanelBlock>

      <PanelBlock title="Timeline" icon={<Clock3 size={16} />}>
        {lead.timeline.length === 0 ? (
          <p className="text-sm text-white/40">No timeline yet.</p>
        ) : (
          <div className="space-y-3">
            {lead.timeline.slice(0, 8).map((item) => (
              <div
                key={`${item.type}-${item.id}`}
                className="border-l border-white/10 pl-3"
              >
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/35">
                  {item.description}
                </p>
                <p className="mt-1 text-[11px] text-white/25">
                  {formatTime(item.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </PanelBlock>
    </aside>
  );
}

function SummaryCard({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: ReactNode;
  tone?: "normal" | "warning" | "danger" | "success" | "info";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/20 bg-red-500/10"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10"
        : tone === "success"
          ? "border-emerald-500/20 bg-emerald-500/10"
          : tone === "info"
            ? "border-cyan-500/20 bg-cyan-500/10"
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
  tone?: "normal" | "warning" | "danger" | "success" | "muted" | "info";
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
          : tone === "info"
            ? "bg-cyan-500/10 text-cyan-100"
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

function InfoBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-1 text-sm font-medium leading-5 text-white/75">
        {value || "-"}
      </p>
    </div>
  );
}

function PanelBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[26px] border border-white/10 bg-black/20 p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white/70">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function ActionButton({
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
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-sm text-white/60 transition hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center">
      <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/50">
        <Loader2 className="animate-spin" size={18} />
        {text}
      </div>
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
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white/[0.06] text-white/40">
        {icon}
      </div>

      <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em]">{title}</h3>

      <p className="mt-2 max-w-sm text-sm leading-6 text-white/38">
        {description}
      </p>
    </div>
  );
}