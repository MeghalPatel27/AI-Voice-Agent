import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Columns3,
  Filter,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  UserRound,
  XCircle,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type PipelineStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "FOLLOW_UP"
  | "HUMAN_REQUIRED"
  | "CONVERTED"
  | "LOST";

type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type Customer = {
  id: string;
  fullName?: string | null;
  phone: string;
  email?: string | null;
  source?: string | null;
};

type PipelineConversation = {
  id: string;
  channel: "WHATSAPP" | "AI_CALL" | "WEBSITE_CHAT";
  status: PipelineStatus;
  priority: Priority;
  intent?: string | null;
  aiSummary?: string | null;
  nextAction?: string | null;
  aiConfidence?: number | null;
  humanNeeded: boolean;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  updatedAt: string;
  customer: Customer;
  _count: {
    messages: number;
    tasks: number;
    bookings: number;
    calls: number;
  };
};

type PipelineColumn = {
  status: PipelineStatus;
  title: string;
  count: number;
  conversations: PipelineConversation[];
};

type PipelineResponse = {
  columns: PipelineColumn[];
  summary: {
    total: number;
    new: number;
    inProgress: number;
    followUp: number;
    humanRequired: number;
    converted: number;
    lost: number;
    conversionRate: number;
  };
  statuses: PipelineStatus[];
};

const statuses: PipelineStatus[] = [
  "NEW",
  "IN_PROGRESS",
  "FOLLOW_UP",
  "HUMAN_REQUIRED",
  "CONVERTED",
  "LOST",
];

export default function PipelinePage() {
  const [columns, setColumns] = useState<PipelineColumn[]>([]);
  const [summary, setSummary] = useState<PipelineResponse["summary"]>({
    total: 0,
    new: 0,
    inProgress: 0,
    followUp: 0,
    humanRequired: 0,
    converted: 0,
    lost: 0,
    conversionRate: 0,
  });

  const [selectedConversation, setSelectedConversation] =
    useState<PipelineConversation | null>(null);

  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("ALL");

  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState("");

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const allConversations = useMemo(() => {
    return columns.flatMap((column) => column.conversations);
  }, [columns]);

  async function loadPipeline() {
    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams();

      if (search.trim()) params.set("search", search.trim());
      if (channel !== "ALL") params.set("channel", channel);

      const query = params.toString();

      const data = await apiFetch<PipelineResponse>(
        `/api/pipeline${query ? `?${query}` : ""}`
      );

      setColumns(data.columns);
      setSummary(data.summary);

      const existingSelected = data.columns
        .flatMap((column) => column.conversations)
        .find((conversation) => conversation.id === selectedConversation?.id);

      setSelectedConversation(
        existingSelected ||
          data.columns.flatMap((column) => column.conversations)[0] ||
          null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }

  async function moveConversation(
    conversation: PipelineConversation,
    nextStatus: PipelineStatus
  ) {
    try {
      setUpdatingId(conversation.id);
      setError("");
      setNotice("");

      await apiFetch(`/api/pipeline/${conversation.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: nextStatus,
        }),
      });

      setNotice(`Moved to ${formatEnum(nextStatus)}.`);
      await loadPipeline();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update pipeline"
      );
    } finally {
      setUpdatingId("");
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPipeline();
    }, 250);

    return () => clearTimeout(timer);
  }, [search, channel]);

  return (
    <section className="flex h-[calc(100vh-112px)] min-h-[680px] flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
      <div className="shrink-0 border-b border-white/10 p-5">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-white/55">
              <Columns3 size={14} />
              Lead Pipeline
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
              Track every lead from first message to conversion.
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
              Move conversations between CRM stages and keep your team focused on
              active leads, follow-ups and human-required cases.
            </p>
          </div>

          <button
            onClick={loadPipeline}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 hover:text-white"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          <SummaryCard label="Total" value={summary.total} />
          <SummaryCard label="New" value={summary.new} />
          <SummaryCard label="Progress" value={summary.inProgress} />
          <SummaryCard label="Follow Up" value={summary.followUp} />
          <SummaryCard label="Human" value={summary.humanRequired} />
          <SummaryCard label="Converted" value={summary.converted} />
          <SummaryCard label="Rate" value={`${summary.conversionRate}%`} />
        </div>

        <div className="mt-5 flex flex-col gap-3 md:flex-row">
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={18} className="text-white/35" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search lead, phone, intent, summary..."
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>

          <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
            <Filter size={16} className="text-white/35" />
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              className="h-12 bg-transparent text-sm outline-none"
            >
              <option value="ALL" className="bg-[#05070d]">
                All Channels
              </option>
              <option value="WHATSAPP" className="bg-[#05070d]">
                WhatsApp
              </option>
              <option value="AI_CALL" className="bg-[#05070d]">
                AI Call
              </option>
              <option value="WEBSITE_CHAT" className="bg-[#05070d]">
                Website Chat
              </option>
            </select>
          </label>
        </div>

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

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-white/40">
            Loading pipeline...
          </div>
        ) : allConversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <Columns3 size={38} className="text-white/35" />
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
              No leads in pipeline
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-white/45">
              WhatsApp, calls and web chat conversations will appear here.
            </p>
          </div>
        ) : (
          <div className="flex h-full gap-4 overflow-x-auto overflow-y-hidden p-4">
            {columns.map((column) => (
              <PipelineColumnView
                key={column.status}
                column={column}
                selectedId={selectedConversation?.id || ""}
                updatingId={updatingId}
                onSelect={setSelectedConversation}
                onMove={moveConversation}
              />
            ))}
          </div>
        )}
      </div>

      {selectedConversation ? (
        <div className="shrink-0 border-t border-white/10 bg-black/20 p-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_520px]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  icon={
                    selectedConversation.channel === "AI_CALL" ? (
                      <Phone size={13} />
                    ) : (
                      <MessageCircle size={13} />
                    )
                  }
                  label={formatEnum(selectedConversation.channel)}
                />
                <Badge
                  icon={<ShieldAlert size={13} />}
                  label={formatEnum(selectedConversation.priority)}
                />
                <Badge
                  icon={<Clock3 size={13} />}
                  label={formatEnum(selectedConversation.status)}
                />
              </div>

              <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em]">
                {selectedConversation.customer.fullName || "Unknown Customer"}
              </h2>

              <p className="mt-1 text-sm text-white/40">
                {selectedConversation.customer.phone}
                {selectedConversation.customer.email
                  ? ` · ${selectedConversation.customer.email}`
                  : ""}
              </p>

              <p className="mt-3 line-clamp-2 text-sm leading-6 text-white/50">
                {selectedConversation.aiSummary ||
                  selectedConversation.lastMessage ||
                  "No summary available."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {statuses.map((status) => (
                <button
                  key={status}
                  disabled={
                    updatingId === selectedConversation.id ||
                    selectedConversation.status === status
                  }
                  onClick={() => moveConversation(selectedConversation, status)}
                  className={`flex h-11 items-center justify-center rounded-2xl border text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    selectedConversation.status === status
                      ? "border-white/20 bg-white text-black"
                      : "border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  {formatEnum(status)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PipelineColumnView({
  column,
  selectedId,
  updatingId,
  onSelect,
  onMove,
}: {
  column: PipelineColumn;
  selectedId: string;
  updatingId: string;
  onSelect: (conversation: PipelineConversation) => void;
  onMove: (
    conversation: PipelineConversation,
    nextStatus: PipelineStatus
  ) => void;
}) {
  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col rounded-[28px] border border-white/10 bg-black/20">
      <div className="shrink-0 border-b border-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold tracking-[-0.03em]">
              {column.title}
            </h3>
            <p className="mt-1 text-xs text-white/35">
              {column.count} leads
            </p>
          </div>

          <ColumnIcon status={column.status} />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {column.conversations.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-white/10 px-6 text-center text-sm leading-6 text-white/35">
            No leads here
          </div>
        ) : (
          column.conversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => onSelect(conversation)}
              className={`w-full rounded-3xl border p-4 text-left transition ${
                selectedId === conversation.id
                  ? "border-white/25 bg-white/[0.09]"
                  : "border-white/10 bg-white/[0.035] hover:bg-white/[0.065]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-semibold">
                    {conversation.customer.fullName || "Unknown Customer"}
                  </p>
                  <p className="mt-1 text-xs text-white/35">
                    {conversation.customer.phone}
                  </p>
                </div>

                <PriorityBadge priority={conversation.priority} />
              </div>

              <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/45">
                {conversation.aiSummary ||
                  conversation.lastMessage ||
                  "No summary available."}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <SmallPill label={formatEnum(conversation.channel)} />
                {conversation.humanNeeded ? (
                  <SmallPill label="Human" />
                ) : null}
                {conversation._count.bookings > 0 ? (
                  <SmallPill label={`${conversation._count.bookings} booking`} />
                ) : null}
                {conversation._count.tasks > 0 ? (
                  <SmallPill label={`${conversation._count.tasks} task`} />
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {conversation.status !== "FOLLOW_UP" ? (
                  <button
                    type="button"
                    disabled={updatingId === conversation.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(conversation, "FOLLOW_UP");
                    }}
                    className="h-9 rounded-xl border border-white/10 bg-black/20 text-xs text-white/50 hover:text-white disabled:opacity-40"
                  >
                    Follow Up
                  </button>
                ) : null}

                {conversation.status !== "CONVERTED" ? (
                  <button
                    type="button"
                    disabled={updatingId === conversation.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(conversation, "CONVERTED");
                    }}
                    className="h-9 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-xs text-emerald-100 disabled:opacity-40"
                  >
                    Convert
                  </button>
                ) : null}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function ColumnIcon({ status }: { status: PipelineStatus }) {
  const icon =
    status === "NEW" ? (
      <MessageCircle size={18} />
    ) : status === "IN_PROGRESS" ? (
      <Send size={18} />
    ) : status === "FOLLOW_UP" ? (
      <Clock3 size={18} />
    ) : status === "HUMAN_REQUIRED" ? (
      <AlertTriangle size={18} />
    ) : status === "CONVERTED" ? (
      <CheckCircle2 size={18} />
    ) : (
      <XCircle size={18} />
    );

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-black">
      {icon}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const className =
    priority === "CRITICAL"
      ? "border-red-500/25 bg-red-500/10 text-red-100"
      : priority === "HIGH"
        ? "border-orange-500/25 bg-orange-500/10 text-orange-100"
        : priority === "MEDIUM"
          ? "border-yellow-500/25 bg-yellow-500/10 text-yellow-100"
          : "border-white/10 bg-white/[0.05] text-white/45";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] ${className}`}>
      {formatEnum(priority)}
    </span>
  );
}

function Badge({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/55">
      {icon}
      {label}
    </span>
  );
}

function SmallPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/40">
      {label}
    </span>
  );
}

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => {
    return char.toUpperCase();
  });
}