import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Flame,
  IndianRupee,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { apiFetch } from "./lib/api";
import { Industry, useAuth } from "./auth/AuthContext";

type PaymentMetric = {
  connected: boolean;
  value: number | null;
  count?: number | null;
  currency: string;
  message: string;
};

type FocusItem = {
  title: string;
  detail: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
};

type HotLead = {
  id: string;
  customerName: string;
  customerPhone: string;
  channel: string;
  status: string;
  priority: string;
  intent?: string | null;
  aiSummary?: string | null;
  lastMessage?: string | null;
  updatedAt: string;
};

type TaskItem = {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueAt?: string | null;
  customerName: string;
  customerPhone: string;
  channel?: string | null;
};

type DashboardSummary = {
  company: {
    id: string;
    name: string;
    industry: Industry;
  };

  industry: Industry;

  aiCeoReport: string;

  totalLeads: number;
  hotLeads: number;
  missedCalls: number;
  pendingFollowUps: number;
  delayedTasks: number;

  pendingPayments: PaymentMetric;
  revenueEstimate: PaymentMetric;

  ownerFocus: FocusItem[];

  callsHandledToday: number;
  whatsappChatsToday: number;
  staffFollowUps: number;
  bookingsMadeToday: number;
  liveAiCalls: number;
  liveAiChats: number;
  emergencyTransfers: number;
  aiSolvedPercent: number;
  handoverPercent: number;
  riskStatus: string;

  recentHotLeads: HotLead[];
  delayedTaskList: TaskItem[];
  pendingFollowUpList: TaskItem[];
};

type MetricCard = {
  label: string;
  value: number | string;
  helper: string;
  icon: typeof Phone;
  tone?: "normal" | "warning" | "danger" | "success";
};

const industryTitle: Record<Industry, string> = {
  HOSPITAL: "Owner Dashboard",
  CLINIC: "Owner Dashboard",
  HOTEL: "Owner Dashboard",
  RESTAURANT: "Owner Dashboard",
  REAL_ESTATE: "Owner Dashboard",
  OTHER: "Owner Dashboard",
};

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value?: string | null) {
  if (!value) return "No due date";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(metric: PaymentMetric) {
  if (!metric.connected || metric.value === null) {
    return "Not connected";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: metric.currency || "INR",
    maximumFractionDigits: 0,
  }).format(metric.value);
}

export default function CommandCenter() {
  const { user } = useAuth();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadSummary(options?: { silent?: boolean }) {
    try {
      setError("");
      if (!options?.silent) {
        setLoading(true);
      }

      const data = await apiFetch<DashboardSummary>("/api/dashboard/summary");

      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadSummary();
  }, []);

  useEffect(() => {
    if (!summary || summary.liveAiCalls <= 0) return;

    const timer = window.setInterval(() => {
      void loadSummary({ silent: true });
    }, 4000);

    return () => window.clearInterval(timer);
  }, [summary?.liveAiCalls]);

  const metrics = useMemo<MetricCard[]>(() => {
    if (!summary) return [];

    return [
      {
        label: "Total leads",
        value: summary.totalLeads,
        helper: "Real customers saved in CRM",
        icon: UsersRound,
        tone: "normal",
      },
      {
        label: "Hot leads",
        value: summary.hotLeads,
        helper: "High or critical active leads",
        icon: Flame,
        tone: summary.hotLeads > 0 ? "danger" : "success",
      },
      {
        label: "Missed calls",
        value: summary.missedCalls,
        helper: "Missed AI calls today",
        icon: Phone,
        tone: summary.missedCalls > 0 ? "warning" : "success",
      },
      {
        label: "Pending follow-ups",
        value: summary.pendingFollowUps,
        helper: "Open or doing staff tasks",
        icon: CheckCircle2,
        tone: summary.pendingFollowUps > 0 ? "warning" : "success",
      },
      {
        label: "Delayed tasks",
        value: summary.delayedTasks,
        helper: "Past due and not completed",
        icon: Clock3,
        tone: summary.delayedTasks > 0 ? "danger" : "success",
      },
      {
        label: "Pending payments",
        value: formatMoney(summary.pendingPayments),
        helper: summary.pendingPayments.message,
        icon: IndianRupee,
        tone: summary.pendingPayments.connected ? "warning" : "normal",
      },
      {
        label: "Revenue estimate",
        value: formatMoney(summary.revenueEstimate),
        helper: summary.revenueEstimate.message,
        icon: TrendingUp,
        tone: summary.revenueEstimate.connected ? "success" : "normal",
      },
      {
        label: "Bookings today",
        value: summary.bookingsMadeToday,
        helper: "Real booking requests created today",
        icon: CalendarCheck,
        tone: "normal",
      },
    ];
  }, [summary]);

  if (loading) {
    return (
      <section className="flex min-h-[calc(100vh-120px)] items-center justify-center">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-6 py-5 text-sm text-white/60">
          Loading real business dashboard...
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex min-h-[calc(100vh-120px)] items-center justify-center">
        <div className="max-w-xl rounded-[34px] border border-red-500/20 bg-red-500/10 p-7 text-center">
          <ShieldAlert className="mx-auto text-red-200" size={36} />
          <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em]">
            Dashboard failed to load
          </h2>
          <p className="mt-3 text-sm leading-6 text-red-100/70">{error}</p>

          <button
            onClick={() => {
              void loadSummary();
            }}
            className="mt-6 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black"
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  if (!summary) return null;

  const pageTitle = industryTitle[summary.industry || user?.industry || "OTHER"];

  return (
    <section className="space-y-5">
      <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6 md:p-7">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-white/55">
              <Bot size={14} />
              Today’s AI CEO Report
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
              {pageTitle}
            </h1>

            <p className="mt-4 max-w-4xl text-sm leading-6 text-white/55 md:text-base md:leading-7">
              {summary.aiCeoReport}
            </p>
          </div>

          <button
            onClick={() => {
              void loadSummary();
            }}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 hover:text-white"
          >
            <RefreshCw size={16} />
            Refresh real data
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <MiniPanel
            label="AI solved"
            value={`${summary.aiSolvedPercent}%`}
            subtext="Without human handover"
          />
          <MiniPanel
            label="Human handover"
            value={`${summary.handoverPercent}%`}
            subtext="Needs staff attention"
          />
          <MiniPanel
            label="Live AI calls"
            value={summary.liveAiCalls}
            subtext="Currently active"
          />
          <MiniPanel
            label="Chats active"
            value={summary.liveAiChats}
            subtext="WhatsApp + website"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_430px]">
        <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-white/55">
                <Target size={14} />
                Owner Focus
              </div>

              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">
                What you should focus on today
              </h2>
              <p className="mt-2 text-sm text-white/45">
                Built only from real calls, leads, tasks and handovers in your database.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {summary.ownerFocus.map((item, index) => (
              <FocusCard key={`${item.title}-${index}`} item={item} />
            ))}
          </div>
        </div>

        <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-white/55">
            <AlertTriangle size={14} />
            Real Data Status
          </div>

          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">
            Connected sources
          </h2>

          <div className="mt-5 space-y-3">
            <ConnectionRow
              label="Leads"
              status="Connected"
              detail="Reading real customers and conversations."
            />
            <ConnectionRow
              label="WhatsApp"
              status="Connected if Cloud API is configured"
              detail="Dashboard reads real WhatsApp conversations saved in CRM."
            />
            <ConnectionRow
              label="Calls"
              status="Connected if provider/webhook is configured"
              detail="Dashboard reads real call records from the Call table."
            />
            <ConnectionRow
              label="Payments"
              status="Not connected"
              detail={summary.pendingPayments.message}
            />
            <ConnectionRow
              label="Revenue"
              status="Not connected"
              detail={summary.revenueEstimate.message}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <RealList
          title="Hot leads"
          emptyTitle="No hot leads right now"
          emptyDescription="High and critical active leads will appear here."
        >
          {summary.recentHotLeads.map((lead) => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </RealList>

        <RealList
          title="Delayed tasks"
          emptyTitle="No delayed tasks"
          emptyDescription="Tasks past their due date will appear here."
        >
          {summary.delayedTaskList.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </RealList>
      </div>

      <RealList
        title="Pending follow-ups"
        emptyTitle="No pending follow-ups"
        emptyDescription="Open and doing tasks will appear here."
      >
        {summary.pendingFollowUpList.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </RealList>
    </section>
  );
}

function MetricCard({ label, value, helper, icon: Icon, tone = "normal" }: MetricCard) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/20 bg-red-500/10"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10"
        : tone === "success"
          ? "border-emerald-500/20 bg-emerald-500/10"
          : "border-white/10 bg-white/[0.04]";

  return (
    <div className={`rounded-[30px] border p-5 ${toneClass}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-white/45">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
            {value}
          </p>
        </div>

        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white/70">
          <Icon size={20} />
        </div>
      </div>

      <p className="mt-4 line-clamp-2 text-xs leading-5 text-white/40">
        {helper}
      </p>
    </div>
  );
}

function MiniPanel({
  label,
  value,
  subtext,
}: {
  label: string;
  value: ReactNode;
  subtext: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
      <p className="mt-1 text-xs text-white/35">{subtext}</p>
    </div>
  );
}

function FocusCard({ item }: { item: FocusItem }) {
  const priorityClass =
    item.priority === "CRITICAL"
      ? "bg-red-500/10 text-red-100 border-red-500/20"
      : item.priority === "HIGH"
        ? "bg-amber-500/10 text-amber-100 border-amber-500/20"
        : item.priority === "MEDIUM"
          ? "bg-cyan-500/10 text-cyan-100 border-cyan-500/20"
          : "bg-white/5 text-white/70 border-white/10";

  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <h3 className="font-semibold tracking-[-0.02em]">{item.title}</h3>
          <p className="mt-2 text-sm leading-6 text-white/45">{item.detail}</p>
        </div>

        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs ${priorityClass}`}
        >
          {formatEnum(item.priority)}
        </span>
      </div>
    </div>
  );
}

function ConnectionRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="mt-1 text-xs text-white/40">{detail}</p>
        </div>

        <span className="max-w-[160px] rounded-full bg-white/10 px-3 py-1 text-right text-[11px] text-white/55">
          {status}
        </span>
      </div>
    </div>
  );
}

function RealList({
  title,
  emptyTitle,
  emptyDescription,
  children,
}: {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5">
      <h2 className="text-2xl font-semibold tracking-[-0.04em]">{title}</h2>

      <div className="mt-5 space-y-3">
        {hasChildren ? (
          children
        ) : (
          <div className="rounded-3xl border border-white/10 bg-black/20 p-6 text-center">
            <p className="font-semibold">{emptyTitle}</p>
            <p className="mt-2 text-sm text-white/40">{emptyDescription}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LeadRow({ lead }: { lead: HotLead }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="font-semibold">{lead.customerName}</p>
          <p className="mt-1 text-xs text-white/35">{lead.customerPhone}</p>
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-white/50">
            {lead.aiSummary || lead.lastMessage || "No summary available"}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/55">
            {formatEnum(lead.channel)}
          </span>
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-100">
            {formatEnum(lead.priority)}
          </span>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: TaskItem }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="font-semibold">{task.title}</p>
          <p className="mt-1 text-xs text-white/35">
            {task.customerName} · {task.customerPhone}
          </p>
          <p className="mt-3 text-sm text-white/45">
            Due: {formatDate(task.dueAt)}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/55">
            {formatEnum(task.status)}
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/55">
            {formatEnum(task.priority)}
          </span>
        </div>
      </div>
    </div>
  );
}