import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock3,
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

type Status =
  | "NEW"
  | "IN_PROGRESS"
  | "FOLLOW_UP"
  | "CONVERTED"
  | "HUMAN_REQUIRED"
  | "LOST";

type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type MessageSender = "CUSTOMER" | "AI" | "HUMAN";
type OutboundStatus = "PENDING" | "SENT" | "FAILED";

type Customer = {
  id: string;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
};

type Message = {
  id: string;
  senderType: MessageSender;
  body: string;
  createdAt: string;
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

type OutboundMessage = {
  id: string;
  channel: "WHATSAPP" | "AI_CALL" | "WEBSITE_CHAT";
  toPhone: string;
  body: string;
  status: OutboundStatus;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ConversationListItem = {
  id: string;
  channel: "WHATSAPP";
  status: Status;
  priority: Priority;
  intent?: string | null;
  aiSummary?: string | null;
  nextAction?: string | null;
  aiConfidence?: number | null;
  humanNeeded?: boolean;
  bookingCreated?: boolean;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: Customer | null;
  messages?: Message[];
  _count?: {
    messages: number;
    tasks: number;
    calls: number;
    bookings: number;
  };
};

type ConversationDetail = ConversationListItem & {
  messages: Message[];
  tasks: Task[];
  bookings: Booking[];
  outboundMessages?: OutboundMessage[];
};

type ConversationsResponse = {
  conversations: ConversationListItem[];
};

type ConversationResponse = {
  conversation: ConversationDetail;
};

type OutboundResponse = {
  messages: OutboundMessage[];
};

type SendPendingResponse = {
  message: string;
  summary: {
    found: number;
    sent: number;
    failed: number;
  };
};

const statuses = [
  { label: "All status", value: "ALL" },
  { label: "New", value: "NEW" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Follow up", value: "FOLLOW_UP" },
  { label: "Converted", value: "CONVERTED" },
  { label: "Human required", value: "HUMAN_REQUIRED" },
  { label: "Lost", value: "LOST" },
];

export default function WhatsAppPage() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationDetail | null>(null);

  const [outboundMessages, setOutboundMessages] = useState<OutboundMessage[]>(
    []
  );

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [sendingPending, setSendingPending] = useState(false);

  const [replyText, setReplyText] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function loadOutboundMessages() {
    const data = await apiFetch<OutboundResponse>(
      "/api/outbound?channel=WHATSAPP"
    );

    setOutboundMessages(data.messages);
  }

  async function loadConversations(nextSelectedId?: string) {
    try {
      setError("");
      setLoadingList(true);

      const params = new URLSearchParams();

      params.set("channel", "WHATSAPP");
      if (status !== "ALL") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());

      const data = await apiFetch<ConversationsResponse>(
        `/api/conversations?${params.toString()}`
      );

      setConversations(data.conversations);

      const idToOpen =
        nextSelectedId ||
        selectedId ||
        data.conversations[0]?.id ||
        "";

      if (idToOpen) {
        setSelectedId(idToOpen);
        await loadConversation(idToOpen);
      } else {
        setSelectedId("");
        setSelectedConversation(null);
      }

      await loadOutboundMessages();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load WhatsApp chats"
      );
    } finally {
      setLoadingList(false);
    }
  }

  async function loadConversation(id: string) {
    try {
      setLoadingDetail(true);

      const data = await apiFetch<ConversationResponse>(
        `/api/conversations/${id}`
      );

      setSelectedConversation(data.conversation);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load WhatsApp chat"
      );
    } finally {
      setLoadingDetail(false);
    }
  }

  async function selectConversation(id: string) {
    setSelectedId(id);
    await loadConversation(id);
  }

  async function sendHumanReply(event: FormEvent) {
    event.preventDefault();

    if (!selectedConversation || !replyText.trim()) return;

    try {
      setSendingReply(true);
      setError("");
      setNotice("");

      await apiFetch(`/api/conversations/${selectedConversation.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          sender: "HUMAN",
          body: replyText.trim(),
        }),
      });

      setReplyText("");
      setNotice(
        "Human reply saved and queued in Outbox. Use Send pending to deliver it."
      );

      await loadConversation(selectedConversation.id);
      await loadConversations(selectedConversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  }

  async function sendPendingWhatsApp() {
    try {
      setSendingPending(true);
      setError("");
      setNotice("");

      const data = await apiFetch<SendPendingResponse>(
        "/api/outbound/send-pending",
        {
          method: "POST",
        }
      );

      setNotice(
        `Delivery run complete. Found ${data.summary.found}, sent ${data.summary.sent}, failed ${data.summary.failed}.`
      );

      await loadOutboundMessages();

      if (selectedConversation) {
        await loadConversation(selectedConversation.id);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send pending messages"
      );
    } finally {
      setSendingPending(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadConversations();
    }, 250);

    return () => clearTimeout(timer);
  }, [search, status]);

  const stats = useMemo(() => {
    const pending = outboundMessages.filter(
      (message) => message.status === "PENDING"
    ).length;

    const sent = outboundMessages.filter(
      (message) => message.status === "SENT"
    ).length;

    const failed = outboundMessages.filter(
      (message) => message.status === "FAILED"
    ).length;

    const humanNeeded = conversations.filter(
      (conversation) => conversation.humanNeeded
    ).length;

    return {
      totalChats: conversations.length,
      humanNeeded,
      pending,
      sent,
      failed,
    };
  }, [conversations, outboundMessages]);

  const selectedOutbound = useMemo(() => {
    if (!selectedConversation) return [];

    return outboundMessages.filter(
      (message) => message.toPhone === selectedConversation.customer?.phone
    );
  }, [outboundMessages, selectedConversation]);

  return (
    <section className="grid h-[calc(100vh-112px)] min-h-[680px] gap-4 xl:grid-cols-[430px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        <div className="shrink-0 border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.04em]">
                WhatsApp Ops
              </h1>
              <p className="mt-1 text-sm text-white/40">
                AI WhatsApp chats, handovers and delivery
              </p>
            </div>

            <button
              onClick={() => loadConversations()}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/60 hover:text-white"
            >
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-5 gap-2">
            <MiniCount label="Chats" value={stats.totalChats} />
            <MiniCount label="Human" value={stats.humanNeeded} />
            <MiniCount label="Pend" value={stats.pending} />
            <MiniCount label="Sent" value={stats.sent} />
            <MiniCount label="Fail" value={stats.failed} />
          </div>

          <button
            onClick={sendPendingWhatsApp}
            disabled={sendingPending}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
            {sendingPending ? "Sending pending..." : "Send pending WhatsApp"}
          </button>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={18} className="text-white/35" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone or message..."
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>

          <label className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
            <Filter size={16} className="text-white/35" />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-11 w-full bg-transparent text-sm outline-none"
            >
              {statuses.map((item) => (
                <option
                  key={item.value}
                  value={item.value}
                  className="bg-[#05070d]"
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>

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
            <div className="flex h-full items-center justify-center text-sm text-white/40">
              Loading WhatsApp chats...
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <MessageCircle size={30} className="text-white/35" />
              <h2 className="mt-4 text-lg font-semibold">
                No WhatsApp chats yet
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/40">
                WhatsApp webhook conversations will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => selectConversation(conversation.id)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${
                    selectedId === conversation.id
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
                        {conversation.customer?.phone || "No phone"}
                      </p>
                    </div>

                    <StatusBadge status={conversation.status} />
                  </div>

                  <p className="mt-4 line-clamp-2 text-sm leading-5 text-white/55">
                    {conversation.lastMessage ||
                      conversation.aiSummary ||
                      "No message yet"}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
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

                    {conversation.bookingCreated ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100/70">
                        <CalendarCheck size={12} />
                        Booking
                      </span>
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
            <MessageCircle size={34} className="text-white/35" />
            <h2 className="mt-5 text-2xl font-semibold">
              Select a WhatsApp chat
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-white/40">
              Read AI replies, customer messages, delivery status and send human
              replies.
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-white/10 p-5">
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/55">
                      <MessageCircle size={13} />
                      WhatsApp
                    </span>
                    <StatusBadge status={selectedConversation.status} />
                    <PriorityBadge priority={selectedConversation.priority} />
                  </div>

                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                    {selectedConversation.customer?.fullName ||
                      "Unknown Customer"}
                  </h2>

                  <p className="mt-2 text-sm text-white/45">
                    {selectedConversation.customer?.phone || "No phone"} ·{" "}
                    {selectedConversation.intent
                      ? formatEnum(selectedConversation.intent)
                      : "No intent"}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <SmallStat
                    icon={<Bot size={15} />}
                    label="Confidence"
                    value={`${selectedConversation.aiConfidence || 0}%`}
                  />
                  <SmallStat
                    icon={<CheckCircle2 size={15} />}
                    label="Messages"
                    value={String(selectedConversation.messages?.length || 0)}
                  />
                  <SmallStat
                    icon={<Send size={15} />}
                    label="Outbox"
                    value={String(selectedOutbound.length)}
                  />
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
                <section className="flex min-h-[520px] flex-col rounded-[28px] border border-white/10 bg-black/20">
                  <div className="shrink-0 border-b border-white/10 p-4">
                    <h3 className="text-lg font-semibold tracking-[-0.03em]">
                      Conversation
                    </h3>
                    <p className="mt-1 text-sm text-white/35">
                      Customer, AI and human messages.
                    </p>
                  </div>

                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    {loadingDetail ? (
                      <div className="flex h-full items-center justify-center text-sm text-white/40">
                        Loading conversation...
                      </div>
                    ) : selectedConversation.messages?.length ? (
                      selectedConversation.messages.map((message) => (
                        <MessageBubble key={message.id} message={message} />
                      ))
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-white/40">
                        No messages yet.
                      </div>
                    )}
                  </div>

                  <form
                    onSubmit={sendHumanReply}
                    className="shrink-0 border-t border-white/10 p-4"
                  >
                    <div className="flex gap-3 rounded-2xl border border-white/10 bg-black/30 p-2">
                      <input
                        value={replyText}
                        onChange={(event) => setReplyText(event.target.value)}
                        placeholder="Write a human WhatsApp reply..."
                        className="h-12 min-w-0 flex-1 bg-transparent px-4 text-sm outline-none placeholder:text-white/25"
                      />

                      <button
                        type="submit"
                        disabled={sendingReply || !replyText.trim()}
                        className="flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Send size={16} />
                        {sendingReply ? "Saving..." : "Reply"}
                      </button>
                    </div>
                  </form>
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
                      value={selectedConversation.customer?.fullName || "Unknown"}
                    />
                    <InfoRow
                      label="Phone"
                      value={selectedConversation.customer?.phone || "-"}
                    />
                    <InfoRow
                      label="Email"
                      value={selectedConversation.customer?.email || "-"}
                    />
                  </Panel>

                  <Panel title="Delivery status" icon={<Send size={20} />}>
                    {selectedOutbound.length ? (
                      <div className="space-y-3">
                        {selectedOutbound.slice(0, 5).map((item) => (
                          <div
                            key={item.id}
                            className="rounded-2xl border border-white/10 bg-black/25 p-4"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <OutboundStatusBadge status={item.status} />
                              <p className="text-[11px] text-white/30">
                                {formatDateTime(item.createdAt)}
                              </p>
                            </div>

                            <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/50">
                              {item.body}
                            </p>

                            {item.errorMessage ? (
                              <p className="mt-3 text-xs leading-5 text-red-200/75">
                                {item.errorMessage}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-white/40">
                        No outbound WhatsApp messages for this customer yet.
                      </p>
                    )}
                  </Panel>

                  <Panel title="Linked work" icon={<CalendarCheck size={20} />}>
                    <InfoRow
                      label="Tasks"
                      value={String(selectedConversation.tasks?.length || 0)}
                    />
                    <InfoRow
                      label="Bookings"
                      value={String(selectedConversation.bookings?.length || 0)}
                    />
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

function StatusBadge({ status }: { status: Status }) {
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

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/40">
      {formatEnum(priority)}
    </span>
  );
}

function OutboundStatusBadge({ status }: { status: OutboundStatus }) {
  const icon =
    status === "SENT" ? (
      <CheckCircle2 size={13} />
    ) : status === "FAILED" ? (
      <XCircle size={13} />
    ) : (
      <Clock3 size={13} />
    );

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/50">
      {icon}
      {formatEnum(status)}
    </span>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const sender = message.senderType || "CUSTOMER";
  const isHuman = sender === "HUMAN";
  const isAi = sender === "AI";

  return (
    <div
      className={`flex ${
        isHuman ? "justify-end" : isAi ? "justify-start" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[78%] rounded-[26px] border p-4 ${
          isHuman
            ? "border-white/10 bg-white text-black"
            : isAi
              ? "border-cyan-400/15 bg-cyan-400/10 text-cyan-50"
              : "border-white/10 bg-white/[0.06] text-white"
        }`}
      >
        <div
          className={`mb-2 flex items-center gap-2 text-[11px] ${
            isHuman ? "text-black/50" : "text-white/35"
          }`}
        >
          {isHuman ? <UserRound size={13} /> : isAi ? <Bot size={13} /> : <Phone size={13} />}
          {formatEnum(sender)}
        </div>

        <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>

        <p
          className={`mt-3 text-[11px] ${
            isHuman ? "text-black/40" : "text-white/25"
          }`}
        >
          {formatDateTime(message.createdAt)}
        </p>
      </div>
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