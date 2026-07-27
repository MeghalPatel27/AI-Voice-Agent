import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bot,
  CheckCircle2,
  Clock3,
  Filter,
  MessageCircle,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type OutboundStatus = "PENDING" | "SENT" | "FAILED";
type Channel = "AI_CALL" | "WHATSAPP" | "WEBSITE_CHAT";

type Customer = {
  fullName?: string | null;
  phone?: string | null;
};

type Conversation = {
  id: string;
  intent?: string | null;
  priority: string;
  status: string;
};

type OutboundMessage = {
  id: string;
  companyId: string;
  conversationId?: string | null;
  customerId?: string | null;
  channel: Channel;
  toPhone: string;
  body: string;
  status: OutboundStatus;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: Customer | null;
  conversation?: Conversation | null;
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
  results: {
    id: string;
    channel: string;
    toPhone: string;
    status: "SENT" | "FAILED";
    providerMessageId?: string;
    errorMessage?: string;
  }[];
};

const statuses = [
  { label: "All status", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Sent", value: "SENT" },
  { label: "Failed", value: "FAILED" },
];

const channels = [
  { label: "All channels", value: "ALL" },
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "AI Call", value: "AI_CALL" },
  { label: "Website Chat", value: "WEBSITE_CHAT" },
];

export default function OutboxPage() {
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [selectedMessage, setSelectedMessage] =
    useState<OutboundMessage | null>(null);

  const [status, setStatus] = useState("ALL");
  const [channel, setChannel] = useState("ALL");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedMessageRef = useRef(selectedMessage);

  useEffect(() => {
    selectedMessageRef.current = selectedMessage;
  }, [selectedMessage]);

  const loadMessages = useCallback(async (nextSelectedId?: string) => {
    try {
      setError("");
      setLoading(true);

      const params = new URLSearchParams();

      if (status !== "ALL") params.set("status", status);
      if (channel !== "ALL") params.set("channel", channel);

      const query = params.toString();

      const data = await apiFetch<OutboundResponse>(
        `/api/outbound${query ? `?${query}` : ""}`
      );

      const filtered = search.trim()
        ? data.messages.filter((item) => {
            const text = [
              item.toPhone,
              item.body,
              item.status,
              item.channel,
              item.customer?.fullName,
              item.customer?.phone,
              item.errorMessage,
              item.providerMessageId,
              item.conversation?.intent,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();

            return text.includes(search.trim().toLowerCase());
          })
        : data.messages;

      setMessages(filtered);

      const nextMessage =
        filtered.find((item) => item.id === nextSelectedId) ||
        filtered.find((item) => item.id === selectedMessageRef.current?.id) ||
        filtered[0] ||
        null;

      setSelectedMessage(nextMessage);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load outbound messages"
      );
    } finally {
      setLoading(false);
    }
  }, [status, channel, search]);

  async function sendPending() {
    try {
      setSending(true);
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

      await loadMessages(selectedMessage?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send pending");
    } finally {
      setSending(false);
    }
  }

  async function retrySelected() {
    if (!selectedMessage) return;

    try {
      setRetrying(true);
      setError("");
      setNotice("");

      await apiFetch(`/api/outbound/${selectedMessage.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "PENDING",
        }),
      });

      const data = await apiFetch<SendPendingResponse>(
        "/api/outbound/send-pending",
        {
          method: "POST",
        }
      );

      setNotice(
        `Retry complete. Found ${data.summary.found}, sent ${data.summary.sent}, failed ${data.summary.failed}.`
      );

      await loadMessages(selectedMessage.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry message");
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadMessages();
    }, 250);

    return () => clearTimeout(timer);
  }, [loadMessages]);

  const stats = useMemo(() => {
    return {
      total: messages.length,
      pending: messages.filter((item) => item.status === "PENDING").length,
      sent: messages.filter((item) => item.status === "SENT").length,
      failed: messages.filter((item) => item.status === "FAILED").length,
    };
  }, [messages]);

  return (
    <section className="grid h-[calc(100vh-112px)] min-h-[680px] gap-4 xl:grid-cols-[430px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        <div className="shrink-0 border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.04em]">
                Outbox
              </h1>
              <p className="mt-1 text-sm text-white/40">
                AI and human messages queued for delivery
              </p>
            </div>

            <button
              onClick={() => loadMessages()}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/60 hover:text-white"
            >
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            <MiniCount label="Total" value={stats.total} />
            <MiniCount label="Pend" value={stats.pending} />
            <MiniCount label="Sent" value={stats.sent} />
            <MiniCount label="Fail" value={stats.failed} />
          </div>

          <button
            onClick={sendPending}
            disabled={sending}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
            {sending ? "Sending pending..." : "Send pending messages"}
          </button>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={18} className="text-white/35" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search phone, body, error..."
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
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

            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
              <MessageCircle size={16} className="text-white/35" />
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                className="h-11 w-full bg-transparent text-sm outline-none"
              >
                {channels.map((item) => (
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
              Loading outbox...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <Send size={30} className="text-white/35" />
              <h2 className="mt-4 text-lg font-semibold">
                No outbound messages
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/40">
                AI replies and human replies will appear here before and after
                delivery.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedMessage(item)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${
                    selectedMessage?.id === item.id
                      ? "border-white/20 bg-white/[0.08]"
                      : "border-white/10 bg-black/15 hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <ChannelBadge channel={item.channel} />
                        <StatusBadge status={item.status} />
                      </div>

                      <p className="mt-3 text-sm font-semibold">
                        {item.customer?.fullName || item.toPhone}
                      </p>

                      <p className="mt-1 text-xs text-white/35">
                        To: {item.toPhone}
                      </p>
                    </div>

                    <OutboundIcon status={item.status} />
                  </div>

                  <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/45">
                    {item.body}
                  </p>

                  {item.errorMessage ? (
                    <p className="mt-3 line-clamp-1 text-xs text-red-200/70">
                      {item.errorMessage}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        {!selectedMessage ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <Send size={34} className="text-white/35" />
            <h2 className="mt-5 text-2xl font-semibold">
              Select an outbound message
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-white/40">
              Check delivery state, provider ID, error details and retry failed
              messages.
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-white/10 p-5">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ChannelBadge channel={selectedMessage.channel} />
                    <StatusBadge status={selectedMessage.status} />
                  </div>

                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                    {selectedMessage.customer?.fullName ||
                      selectedMessage.toPhone}
                  </h2>

                  <p className="mt-2 text-sm text-white/45">
                    Created {formatDateTime(selectedMessage.createdAt)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={sendPending}
                    disabled={sending}
                    className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-black disabled:opacity-50"
                  >
                    <Send size={16} />
                    Send pending
                  </button>

                  {selectedMessage.status === "FAILED" ? (
                    <button
                      onClick={retrySelected}
                      disabled={retrying}
                      className="flex items-center gap-2 rounded-2xl bg-orange-500/15 px-4 py-3 text-sm text-orange-100 hover:bg-orange-500/20 disabled:opacity-50"
                    >
                      <RotateCcw size={16} />
                      {retrying ? "Retrying..." : "Retry selected"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
                <div className="space-y-5">
                  <Panel title="Delivery" icon={<Send size={20} />}>
                    <InfoRow label="Status" value={formatEnum(selectedMessage.status)} />
                    <InfoRow label="Channel" value={formatEnum(selectedMessage.channel)} />
                    <InfoRow label="To phone" value={selectedMessage.toPhone} />
                    <InfoRow
                      label="Provider ID"
                      value={selectedMessage.providerMessageId || "-"}
                    />
                    <InfoRow
                      label="Updated"
                      value={formatDateTime(selectedMessage.updatedAt)}
                    />
                  </Panel>

                  <Panel title="Customer" icon={<Phone size={20} />}>
                    <InfoRow
                      label="Name"
                      value={selectedMessage.customer?.fullName || "Unknown"}
                    />
                    <InfoRow
                      label="Phone"
                      value={
                        selectedMessage.customer?.phone ||
                        selectedMessage.toPhone ||
                        "-"
                      }
                    />
                  </Panel>

                  <Panel title="Conversation" icon={<Bot size={20} />}>
                    <InfoRow
                      label="Intent"
                      value={formatEnum(selectedMessage.conversation?.intent)}
                    />
                    <InfoRow
                      label="Priority"
                      value={formatEnum(selectedMessage.conversation?.priority)}
                    />
                    <InfoRow
                      label="Status"
                      value={formatEnum(selectedMessage.conversation?.status)}
                    />
                  </Panel>
                </div>

                <div className="space-y-5">
                  <Panel title="Message body" icon={<MessageCircle size={20} />}>
                    <p className="whitespace-pre-wrap text-sm leading-7 text-white/60">
                      {selectedMessage.body}
                    </p>
                  </Panel>

                  {selectedMessage.errorMessage ? (
                    <Panel title="Error details" icon={<ShieldAlert size={20} />}>
                      <p className="whitespace-pre-wrap text-sm leading-7 text-red-100/80">
                        {selectedMessage.errorMessage}
                      </p>
                    </Panel>
                  ) : null}

                  <Panel title="How this works" icon={<Clock3 size={20} />}>
                    <p className="text-sm leading-7 text-white/45">
                      AI replies and human replies are first saved as outbound
                      messages. The delivery engine sends pending WhatsApp
                      messages and updates them to SENT or FAILED.
                    </p>
                  </Panel>
                </div>
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

function StatusBadge({ status }: { status: OutboundStatus }) {
  const label = formatEnum(status);

  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
      {label}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: Channel }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/50">
      {formatEnum(channel)}
    </span>
  );
}

function OutboundIcon({ status }: { status: OutboundStatus }) {
  const className =
    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-black";

  if (status === "SENT") {
    return (
      <div className={className}>
        <CheckCircle2 size={20} />
      </div>
    );
  }

  if (status === "FAILED") {
    return (
      <div className={className}>
        <XCircle size={20} />
      </div>
    );
  }

  return (
    <div className={className}>
      <Clock3 size={20} />
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
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}