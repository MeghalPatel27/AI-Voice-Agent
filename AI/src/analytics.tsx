import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Inbox,
  LineChart,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type AnalyticsSummary = {
  totalCustomers: number;
  totalConversations: number;
  totalTasks: number;
  openTasks: number;
  doneTasks: number;
  humanRequiredConversations: number;
  aiHandledConversations: number;
  convertedConversations: number;
  bookingCreatedConversations: number;
  whatsappConversations: number;
  callConversations: number;
  websiteChatConversations: number;
  liveAgents: number;
  aiHandledRate: number;
  humanHandoverRate: number;
  conversionRate: number;
};

type BreakdownItem = {
  label: string;
  value: number;
};

type TrendItem = {
  label: string;
  count: number;
};

type RecentConversation = {
  id: string;
  customerName: string;
  customerPhone: string;
  channel: string;
  status: string;
  priority: string;
  intent?: string | null;
  aiSummary?: string | null;
  humanNeeded: boolean;
  createdAt: string;
};

type AnalyticsResponse = {
  summary: AnalyticsSummary;
  channelBreakdown: BreakdownItem[];
  priorityBreakdown: BreakdownItem[];
  statusBreakdown: BreakdownItem[];
  taskStatusBreakdown: BreakdownItem[];
  trend: TrendItem[];
  recentConversations: RecentConversation[];
};

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAnalytics() {
    try {
      setError("");
      setLoading(true);

      const response = await apiFetch<AnalyticsResponse>(
        "/api/analytics/overview"
      );

      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setError("");
        const response = await apiFetch<AnalyticsResponse>(
          "/api/analytics/overview"
        );
        if (cancelled) return;
        setData(response);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load analytics"
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const maxTrendCount = useMemo(() => {
    if (!data?.trend.length) return 1;
    return Math.max(...data.trend.map((item) => item.count), 1);
  }, [data]);

  if (loading) {
    return (
      <section className="glass flex min-h-[calc(100vh-190px)] items-center justify-center rounded-[2rem] p-6">
        <div className="text-center">
          <RefreshCw className="mx-auto animate-spin text-white/50" size={30} />
          <p className="mt-4 text-sm text-white/50">Loading analytics...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="glass flex min-h-[calc(100vh-190px)] items-center justify-center rounded-[2rem] p-6">
        <div className="max-w-xl text-center">
          <ShieldAlert className="mx-auto text-red-300" size={34} />
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
            Analytics failed to load
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/50">{error}</p>

          <button
            onClick={loadAnalytics}
            className="mt-6 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black"
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const summary = data.summary;

  return (
    <section className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AnalyticsCard
          icon={Inbox}
          label="Total conversations"
          value={String(summary.totalConversations)}
          subtext="All WhatsApp, call and chat conversations"
        />

        <AnalyticsCard
          icon={Bot}
          label="AI handled"
          value={`${summary.aiHandledRate}%`}
          subtext={`${summary.aiHandledConversations} conversations without handover`}
        />

        <AnalyticsCard
          icon={UsersRound}
          label="Human handovers"
          value={String(summary.humanRequiredConversations)}
          subtext={`${summary.humanHandoverRate}% needed staff attention`}
        />

        <AnalyticsCard
          icon={CalendarCheck}
          label="Bookings created"
          value={String(summary.bookingCreatedConversations)}
          subtext={`${summary.conversionRate}% conversion rate`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="glass rounded-[2rem] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em]">
                7-day conversation trend
              </h2>
              <p className="mt-2 text-sm text-white/45">
                Real conversation volume from your PostgreSQL database.
              </p>
            </div>

            <button
              onClick={loadAnalytics}
              className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>

          <div className="mt-8 flex h-[260px] items-end gap-3">
            {data.trend.map((item) => {
              const height = Math.max((item.count / maxTrendCount) * 100, 5);

              return (
                <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-3">
                  <div className="flex h-[210px] w-full items-end rounded-2xl border border-white/10 bg-black/20 p-2">
                    <div
                      className="w-full rounded-xl bg-white"
                      style={{ height: `${height}%` }}
                    />
                  </div>

                  <div className="text-center">
                    <p className="text-xs font-semibold text-white">
                      {item.count}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      {item.label}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <BreakdownPanel
            title="Channel split"
            icon={<MessageCircle size={20} />}
            items={data.channelBreakdown}
          />

          <BreakdownPanel
            title="Priority split"
            icon={<ShieldAlert size={20} />}
            items={data.priorityBreakdown}
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <div className="space-y-5">
          <MiniStatGrid
            items={[
              {
                label: "Customers",
                value: summary.totalCustomers,
                icon: <UsersRound size={18} />,
              },
              {
                label: "Open tasks",
                value: summary.openTasks,
                icon: <Clock3 size={18} />,
              },
              {
                label: "Done tasks",
                value: summary.doneTasks,
                icon: <CheckCircle2 size={18} />,
              },
              {
                label: "Live agents",
                value: summary.liveAgents,
                icon: <Bot size={18} />,
              },
            ]}
          />

          <BreakdownPanel
            title="Conversation status"
            icon={<BarChart3 size={20} />}
            items={data.statusBreakdown}
          />

          <BreakdownPanel
            title="Task status"
            icon={<CheckCircle2 size={20} />}
            items={data.taskStatusBreakdown}
          />
        </div>

        <div className="glass rounded-[2rem] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em]">
                Recent conversations
              </h2>
              <p className="mt-2 text-sm text-white/45">
                Latest customer interactions entering the CRM.
              </p>
            </div>

            <LineChart size={24} className="text-cyan-200" />
          </div>

          <div className="mt-6 space-y-3">
            {data.recentConversations.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-black/20 p-6 text-center text-sm text-white/45">
                No conversations yet.
              </div>
            ) : (
              data.recentConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className="rounded-3xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <ChannelBadge channel={conversation.channel} />
                        <StatusBadge value={conversation.status} />
                        <PriorityBadge value={conversation.priority} />
                      </div>

                      <h3 className="mt-3 truncate text-base font-semibold">
                        {conversation.customerName}
                      </h3>

                      <p className="mt-1 text-xs text-white/35">
                        {conversation.customerPhone}
                      </p>
                    </div>

                    <p className="shrink-0 text-xs text-white/35">
                      {new Date(conversation.createdAt).toLocaleString()}
                    </p>
                  </div>

                  <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/50">
                    {conversation.aiSummary || "No summary available."}
                  </p>

                  {conversation.intent ? (
                    <p className="mt-3 text-xs text-cyan-200/70">
                      Intent: {formatEnum(conversation.intent)}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function AnalyticsCard({
  icon: Icon,
  label,
  value,
  subtext,
}: {
  icon: typeof Inbox;
  label: string;
  value: string;
  subtext: string;
}) {
  return (
    <div className="glass rounded-[2rem] p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-white/42">{label}</p>
          <h3 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            {value}
          </h3>
        </div>

        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300/15 text-cyan-200">
          <Icon size={21} />
        </div>
      </div>

      <p className="mt-5 text-xs leading-5 text-white/38">{subtext}</p>
    </div>
  );
}

function BreakdownPanel({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: BreakdownItem[];
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="glass rounded-[2rem] p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-black">
          {icon}
        </div>

        <h3 className="text-lg font-semibold">{title}</h3>
      </div>

      <div className="mt-5 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/40">
            No data yet.
          </div>
        ) : (
          items.map((item) => {
            const percent = total === 0 ? 0 : Math.round((item.value / total) * 100);

            return (
              <div key={item.label}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm text-white/55">{formatEnum(item.label)}</p>
                  <p className="text-sm font-medium text-white">
                    {item.value} · {percent}%
                  </p>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-white"
                    style={{ width: `${Math.max(percent, item.value > 0 ? 5 : 0)}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function MiniStatGrid({
  items,
}: {
  items: { label: string; value: number; icon: ReactNode }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="soft-card rounded-[1.5rem] p-4"
        >
          <div className="text-cyan-200">{item.icon}</div>
          <p className="mt-4 text-xs text-white/38">{item.label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const icon =
    channel === "AI_CALL" ? (
      <Phone size={13} />
    ) : channel === "WHATSAPP" ? (
      <MessageCircle size={13} />
    ) : (
      <Bot size={13} />
    );

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/55">
      {icon}
      {formatEnum(channel)}
    </span>
  );
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/55">
      {formatEnum(value)}
    </span>
  );
}

function PriorityBadge({ value }: { value: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
      {formatEnum(value)}
    </span>
  );
}

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => {
    return char.toUpperCase();
  });
}