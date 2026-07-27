import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  FileText,
  MessageCircle,
  Phone,
  RefreshCw,
  Send,
  ShieldAlert,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type ConversationStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "FOLLOW_UP"
  | "CONVERTED"
  | "HUMAN_REQUIRED"
  | "LOST";

type Message = {
  id: string;
  senderType: "CUSTOMER" | "AI" | "HUMAN";
  body: string;
  createdAt: string;
};

type Customer = {
  id: string;
  fullName?: string | null;
  phone: string;
  email?: string | null;
  source?: string | null;
};

type Task = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  createdAt: string;
};

type Booking = {
  id: string;
  title: string;
  status: string;
  dateTime?: string | null;
  createdAt: string;
};

type Call = {
  id: string;
  phone: string;
  durationSeconds: number;
  transcript?: string | null;
  status: string;
  createdAt: string;
};

type HandoverConversation = {
  id: string;
  channel: "WHATSAPP" | "AI_CALL" | "WEBSITE_CHAT";
  status: ConversationStatus;
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
  messages: Message[];
  tasks: Task[];
  bookings: Booking[];
  calls: Call[];
};

type HandoverResponse = {
  conversations: HandoverConversation[];
  summary: {
    total: number;
    critical: number;
    high: number;
    humanRequired: number;
    converted: number;
    lost: number;
  };
};

type UpdateResponse = {
  message: string;
  conversation: HandoverConversation;
};

export default function HandoverPage() {
  const [conversations, setConversations] = useState<HandoverConversation[]>(
    []
  );
  const [selectedId, setSelectedId] = useState("");
  const [summary, setSummary] = useState<HandoverResponse["summary"]>({
    total: 0,
    critical: 0,
    high: 0,
    humanRequired: 0,
    converted: 0,
    lost: 0,
  });

  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<
    "ALL" | "CRITICAL" | "HIGH" | "HUMAN_REQUIRED"
  >("ALL");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedConversation = useMemo(() => {
    return (
      conversations.find((conversation) => conversation.id === selectedId) ||
      conversations[0] ||
      null
    );
  }, [conversations, selectedId]);

  const filteredConversations = useMemo(() => {
    if (filter === "ALL") return conversations;

    if (filter === "HUMAN_REQUIRED") {
      return conversations.filter(
        (conversation) =>
          conversation.humanNeeded || conversation.status === "HUMAN_REQUIRED"
      );
    }

    return conversations.filter(
      (conversation) => conversation.priority === filter
    );
  }, [conversations, filter]);

  async function loadHandoverQueue() {
    try {
      setLoading(true);
      setError("");

      const data = await apiFetch<HandoverResponse>("/api/handover");

      setConversations(data.conversations);
      setSummary(data.summary);

      if (!selectedId && data.conversations[0]) {
        setSelectedId(data.conversations[0].id);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load handover queue"
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateConversation(
    status: ConversationStatus,
    humanNeeded: boolean,
    customNote?: string
  ) {
    if (!selectedConversation) return;

    try {
      setSaving(true);
      setError("");
      setNotice("");

      const data = await apiFetch<UpdateResponse>(
        `/api/handover/${selectedConversation.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status,
            humanNeeded,
            note: customNote || undefined,
          }),
        }
      );

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === data.conversation.id
            ? data.conversation
            : conversation
        )
      );

      setNotice("Handover updated.");
      setNote("");
      await loadHandoverQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update handover");
    } finally {
      setSaving(false);
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();

    if (!selectedConversation || !note.trim()) return;

    await updateConversation(
      selectedConversation.status,
      selectedConversation.humanNeeded,
      note.trim()
    );
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        setError("");

        const data = await apiFetch<HandoverResponse>("/api/handover");
        if (cancelled) return;

        setConversations(data.conversations);
        setSummary(data.summary);

        if (data.conversations[0]) {
          setSelectedId(data.conversations[0].id);
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load handover queue"
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="grid h-[calc(100vh-112px)] min-h-[680px] gap-4 xl:grid-cols-[430px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        <div className="shrink-0 border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.04em]">
                Handover
              </h1>
              <p className="mt-1 text-sm text-white/40">
                Urgent leads that need human attention
              </p>
            </div>

            <button
              onClick={loadHandoverQueue}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/60 hover:text-white"
            >
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            <MiniCount label="Total" value={summary.total} />
            <MiniCount label="Critical" value={summary.critical} />
            <MiniCount label="High" value={summary.high} />
            <MiniCount label="Human" value={summary.humanRequired} />
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {(["ALL", "HUMAN_REQUIRED", "CRITICAL", "HIGH"] as const).map(
              (item) => (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={`shrink-0 rounded-full px-3 py-2 text-xs transition ${
                    filter === item
                      ? "bg-white text-black"
                      : "bg-white/[0.08] text-white/50 hover:text-white"
                  }`}
                >
                  {formatEnum(item)}
                </button>
              )
            )}
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

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-white/40">
              Loading handovers...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <CheckCircle2 size={34} className="text-white/35" />
              <h2 className="mt-4 text-lg font-semibold">No handovers</h2>
              <p className="mt-2 text-sm leading-6 text-white/40">
                Urgent leads and human-required conversations will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => setSelectedId(conversation.id)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${
                    selectedConversation?.id === conversation.id
                      ? "border-white/20 bg-white/[0.08]"
                      : "border-white/10 bg-black/15 hover:bg-white/[0.05]"
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

                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-white/45">
                    {conversation.aiSummary ||
                      conversation.lastMessage ||
                      "No summary available."}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <SmallPill label={formatEnum(conversation.channel)} />
                    <SmallPill label={formatEnum(conversation.status)} />
                    {conversation.humanNeeded ? (
                      <SmallPill label="Human Needed" />
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        {!selectedConversation ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <UsersRound size={38} className="text-white/35" />
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
              No handover selected
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-white/45">
              Select an urgent conversation from the left.
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-white/10 p-5">
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
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

                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                    {selectedConversation.customer.fullName ||
                      "Unknown Customer"}
                  </h2>

                  <p className="mt-2 text-sm text-white/45">
                    {selectedConversation.customer.phone}
                    {selectedConversation.customer.email
                      ? ` · ${selectedConversation.customer.email}`
                      : ""}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <SmallStat
                    icon={<AlertTriangle size={15} />}
                    label="Human"
                    value={selectedConversation.humanNeeded ? "Needed" : "No"}
                  />
                  <SmallStat
                    icon={<Bot size={15} />}
                    label="AI Score"
                    value={`${selectedConversation.aiConfidence || 0}%`}
                  />
                  <SmallStat
                    icon={<CalendarCheck size={15} />}
                    label="Bookings"
                    value={String(selectedConversation.bookings.length)}
                  />
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
                <section className="space-y-5">
                  <Panel title="AI summary" icon={<FileText size={20} />}>
                    <p className="whitespace-pre-wrap text-sm leading-7 text-white/60">
                      {selectedConversation.aiSummary ||
                        "No AI summary available."}
                    </p>
                  </Panel>

                  <Panel title="Next action" icon={<Clock3 size={20} />}>
                    <p className="whitespace-pre-wrap text-sm leading-7 text-white/60">
                      {selectedConversation.nextAction ||
                        "No next action available."}
                    </p>
                  </Panel>

                  <Panel title="Conversation messages" icon={<MessageCircle size={20} />}>
                    {selectedConversation.messages.length ? (
                      <div className="space-y-3">
                        {[...selectedConversation.messages]
                          .reverse()
                          .map((message) => (
                            <div
                              key={message.id}
                              className="rounded-2xl border border-white/10 bg-black/25 p-4"
                            >
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/40">
                                  {formatEnum(message.senderType)}
                                </span>

                                <span className="text-[11px] text-white/30">
                                  {formatDateTime(message.createdAt)}
                                </span>
                              </div>

                              <p className="whitespace-pre-wrap text-sm leading-6 text-white/60">
                                {message.body}
                              </p>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-sm text-white/40">
                        No messages found.
                      </p>
                    )}
                  </Panel>
                </section>

                <aside className="space-y-5">
                  <Panel title="Human action" icon={<UserRound size={20} />}>
                    <div className="grid gap-2">
                      <button
                        disabled={saving}
                        onClick={() =>
                          updateConversation(
                            "IN_PROGRESS",
                            false,
                            "Human team started handling this conversation."
                          )
                        }
                        className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Send size={15} />
                        Mark In Progress
                      </button>

                      <button
                        disabled={saving}
                        onClick={() =>
                          updateConversation(
                            "CONVERTED",
                            false,
                            "Customer marked as converted by human."
                          )
                        }
                        className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-sm font-semibold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <CheckCircle2 size={15} />
                        Mark Converted
                      </button>

                      <button
                        disabled={saving}
                        onClick={() =>
                          updateConversation(
                            "LOST",
                            false,
                            "Customer marked as lost by human."
                          )
                        }
                        className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 text-sm font-semibold text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <XCircle size={15} />
                        Mark Lost
                      </button>
                    </div>

                    <form onSubmit={addNote} className="mt-4">
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
                        placeholder="Add human note..."
                      />

                      <button
                        type="submit"
                        disabled={saving || !note.trim()}
                        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 text-sm font-medium text-white/70 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FileText size={15} />
                        Add note
                      </button>
                    </form>
                  </Panel>

                  <Panel title="Customer profile" icon={<UserRound size={20} />}>
                    <InfoRow
                      label="Name"
                      value={
                        selectedConversation.customer.fullName ||
                        "Unknown Customer"
                      }
                    />
                    <InfoRow
                      label="Phone"
                      value={selectedConversation.customer.phone}
                    />
                    <InfoRow
                      label="Email"
                      value={selectedConversation.customer.email || "-"}
                    />
                    <InfoRow
                      label="Source"
                      value={formatEnum(
                        selectedConversation.customer.source || "-"
                      )}
                    />
                    <InfoRow
                      label="Intent"
                      value={formatEnum(selectedConversation.intent || "-")}
                    />
                  </Panel>

                  <Panel title="Tasks" icon={<CheckCircle2 size={20} />}>
                    {selectedConversation.tasks.length ? (
                      <div className="space-y-3">
                        {selectedConversation.tasks.map((task) => (
                          <div
                            key={task.id}
                            className="rounded-2xl border border-white/10 bg-black/25 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold">
                                {task.title}
                              </p>

                              <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/40">
                                {formatEnum(task.status)}
                              </span>
                            </div>

                            {task.description ? (
                              <p className="mt-2 text-sm leading-6 text-white/45">
                                {task.description}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-white/40">
                        No linked tasks.
                      </p>
                    )}
                  </Panel>

                  <Panel title="Bookings" icon={<CalendarCheck size={20} />}>
                    {selectedConversation.bookings.length ? (
                      <div className="space-y-3">
                        {selectedConversation.bookings.map((booking) => (
                          <div
                            key={booking.id}
                            className="rounded-2xl border border-white/10 bg-black/25 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold">
                                {booking.title}
                              </p>

                              <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/40">
                                {formatEnum(booking.status)}
                              </span>
                            </div>

                            <p className="mt-2 text-xs text-white/35">
                              {booking.dateTime
                                ? formatDateTime(booking.dateTime)
                                : "No date selected"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-white/40">
                        No linked bookings.
                      </p>
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

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
      <p className="text-[11px] text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function SmallPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/40">
      {label}
    </span>
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

function Badge({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/55">
      {icon}
      {label}
    </span>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-3 last:border-b-0">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-1 break-words text-sm text-white/70">{value}</p>
    </div>
  );
}

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => {
    return char.toUpperCase();
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}