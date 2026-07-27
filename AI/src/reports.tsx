import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  Funnel,
  IndianRupee,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  UsersRound,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type RangeKey =
  | "TODAY"
  | "YESTERDAY"
  | "LAST_7_DAYS"
  | "LAST_30_DAYS"
  | "THIS_MONTH"
  | "CUSTOM";

type TabKey =
  | "OVERVIEW"
  | "SALES_FUNNEL"
  | "CONVERSATIONS"
  | "SOURCES"
  | "TEAM_TASKS"
  | "REVENUE";

type ComparedMetric = {
  value: number;
  previous: number;
  change: number;
  direction: "UP" | "DOWN" | "FLAT";
};

type ReportsResponse = {
  period: {
    start: string;
    end: string;
    label: string;
    compareLabel: string;
  };
  compareEnabled: boolean;

  aiSummary: {
    title: string;
    summary: string;
    actions: string[];
  };

  businessHealth: {
    newLeads: ComparedMetric;
    hotLeads: ComparedMetric;
    followUpsDue: ComparedMetric;
    meetingsBooked: ComparedMetric;
    missedOpportunities: ComparedMetric;
    delayedTasks: ComparedMetric;
    conversionRate: ComparedMetric;
  };

  needsAttention: {
    title: string;
    description: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
    actionLabel: string;
    actionPath: string;
  }[];

  salesFunnel: {
    stages: {
      key: string;
      label: string;
      value: number;
      notConnected?: boolean;
    }[];
    insight: string;
    quotationConnected: boolean;
  };

  sourcePerformance: {
    rows: {
      source: string;
      leads: number;
      hot: number;
      meetings: number;
      won: number;
      lost: number;
      conversionRate: number;
      quality: string;
      avgResponseTime: string;
    }[];
    insight: string;
  };

  followUp: {
    due: number;
    overdue: number;
    hotWithoutFollowUp: number;
    followUpWithoutDate: number;
    completed: number;
    insight: string;
  };

  missedOpportunities: {
    total: number;
    items: {
      type: string;
      title: string;
      description: string;
      severity: "HIGH" | "MEDIUM" | "LOW";
      actionLabel: string;
      actionPath: string;
    }[];
  };

  conversationPerformance: {
    whatsapp: number;
    calls: number;
    website: number;
    missedCalls: number;
    humanHandoffs: number;
    aiHandled: number;
    meetingsFromConversations: number;
    avgCallDuration: number;
    commonIntents: {
      intent: string;
      count: number;
    }[];
    insight: string;
  };

  teamTaskReport: {
    assigned: number;
    completed: number;
    delayed: number;
    blocked: number;
    waitingReview: number;
    employees: {
      id: string;
      name: string;
      active: number;
      completed: number;
      delayed: number;
      blocked: number;
      workloadCapacity: number;
      workloadPercent: number;
    }[];
    mostDelayed: {
      id: string;
      name: string;
      delayed: number;
    } | null;
    mostOverloaded: {
      id: string;
      name: string;
      workloadPercent: number;
    } | null;
    insight: string;
  };

  revenue: {
    connected: boolean;
    collected: number | null;
    pending: number | null;
    pipelineValue: number | null;
    expectedRevenue: number | null;
    overduePayments: number | null;
    message: string;
    setupOptions: string[];
  };

  modules: {
    exportPdfEnabled: boolean;
    scheduleReportEnabled: boolean;
    revenueConnected: boolean;
    quotationConnected: boolean;
  };
};

const rangeOptions: {
  label: string;
  value: RangeKey;
}[] = [
  { label: "Today", value: "TODAY" },
  { label: "Yesterday", value: "YESTERDAY" },
  { label: "Last 7 days", value: "LAST_7_DAYS" },
  { label: "Last 30 days", value: "LAST_30_DAYS" },
  { label: "This month", value: "THIS_MONTH" },
  { label: "Custom", value: "CUSTOM" },
];

const tabs: {
  label: string;
  value: TabKey;
}[] = [
  { label: "Overview", value: "OVERVIEW" },
  { label: "Sales Funnel", value: "SALES_FUNNEL" },
  { label: "Conversations", value: "CONVERSATIONS" },
  { label: "Sources", value: "SOURCES" },
  { label: "Team & Tasks", value: "TEAM_TASKS" },
  { label: "Revenue", value: "REVENUE" },
];

function formatDate(value?: string | null) {
  if (!value) return "-";

  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatSeconds(seconds: number) {
  if (!seconds) return "0s";

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  if (minutes <= 0) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

function toneForSeverity(severity: "HIGH" | "MEDIUM" | "LOW") {
  if (severity === "HIGH") return "danger";
  if (severity === "MEDIUM") return "warning";
  return "normal";
}

function comparisonText(metric: ComparedMetric) {
  if (metric.direction === "FLAT") return "No change";
  const sign = metric.direction === "UP" ? "+" : "";
  return `${sign}${metric.change}% vs previous`;
}

export default function ReportsPage() {
  const navigate = useNavigate();

  const [range, setRange] = useState<RangeKey>("LAST_7_DAYS");
  const [compare, setCompare] = useState(true);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("OVERVIEW");

  const [report, setReport] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReports = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams({
        range,
        compare: compare ? "true" : "false",
      });

      if (range === "CUSTOM" && customStart && customEnd) {
        params.set("startDate", customStart);
        params.set("endDate", customEnd);
      }

      const data = await apiFetch<ReportsResponse>(
        `/api/reports/overview?${params.toString()}`
      );

      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [range, compare, customStart, customEnd]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadReports();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [loadReports]);

  const maxFunnelValue = useMemo(() => {
    if (!report) return 1;
    return Math.max(1, ...report.salesFunnel.stages.map((stage) => stage.value));
  }, [report]);

  if (loading && !report) {
    return (
      <section className="flex min-h-[calc(100vh-150px)] items-center justify-center">
        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/50">
          <Loader2 className="animate-spin" size={18} />
          Loading business intelligence...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-cyan-200">
              <BarChart3 size={14} />
              AI CEO Business Intelligence
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
              Reports
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
              Understand what is working, what is leaking money, and what needs
              action.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.print()}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black"
            >
              <Download size={16} />
              Export PDF
            </button>

            <button
              onClick={() =>
                alert("Scheduled reports are not connected yet.")
              }
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 hover:text-white"
            >
              <Send size={16} />
              Schedule
            </button>

            <button
              onClick={loadReports}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 hover:text-white"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 xl:grid-cols-[240px_170px_170px_180px]">
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as RangeKey)}
            className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          >
            {rangeOptions.map((item) => (
              <option key={item.value} value={item.value} className="bg-[#05070d]">
                {item.label}
              </option>
            ))}
          </select>

          {range === "CUSTOM" ? (
            <>
              <input
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
              />

              <input
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
              />
            </>
          ) : (
            <>
              <div className="hidden xl:block" />
              <div className="hidden xl:block" />
            </>
          )}

          <button
            onClick={() => setCompare((value) => !value)}
            className={`h-12 rounded-2xl border px-4 text-sm ${
              compare
                ? "border-white bg-white text-black"
                : "border-white/10 bg-black/25 text-white/50"
            }`}
          >
            Compare previous
          </button>
        </div>

        {report ? (
          <p className="mt-4 text-xs text-white/35">
            Showing {formatDate(report.period.start)} –{" "}
            {formatDate(report.period.end)}
          </p>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}
      </section>

      {!report ? null : (
        <>
          <section className="rounded-[34px] border border-cyan-500/20 bg-cyan-500/10 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
              <Sparkles size={18} />
              {report.aiSummary.title}
            </div>

            <p className="mt-4 max-w-5xl text-sm leading-7 text-cyan-50/75">
              {report.aiSummary.summary}
            </p>

            <div className="mt-5 grid gap-3 xl:grid-cols-3">
              {report.aiSummary.actions.map((action, index) => (
                <div
                  key={action}
                  className="rounded-[24px] border border-cyan-500/20 bg-black/20 p-4"
                >
                  <p className="text-xs text-cyan-100/45">
                    Recommended action {index + 1}
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-cyan-50">
                    {action}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <HealthCard
              label="New Leads"
              metric={report.businessHealth.newLeads}
              icon={<Target size={18} />}
              onClick={() => navigate("/leads")}
            />
            <HealthCard
              label="Hot Leads"
              metric={report.businessHealth.hotLeads}
              icon={<AlertTriangle size={18} />}
              tone={report.businessHealth.hotLeads.value > 0 ? "warning" : "normal"}
              onClick={() => navigate("/leads")}
            />
            <HealthCard
              label="Follow-ups Due"
              metric={report.businessHealth.followUpsDue}
              icon={<Clock3 size={18} />}
              tone={
                report.businessHealth.followUpsDue.value > 0
                  ? "warning"
                  : "normal"
              }
              onClick={() => navigate("/leads")}
            />
            <HealthCard
              label="Meetings"
              metric={report.businessHealth.meetingsBooked}
              icon={<CalendarClock size={18} />}
              onClick={() => navigate("/leads")}
            />
            <HealthCard
              label="Missed Opportunities"
              metric={report.businessHealth.missedOpportunities}
              icon={<AlertTriangle size={18} />}
              tone={
                report.businessHealth.missedOpportunities.value > 0
                  ? "danger"
                  : "normal"
              }
              onClick={() => navigate("/inbox")}
            />
            <HealthCard
              label="Delayed Tasks"
              metric={report.businessHealth.delayedTasks}
              icon={<CheckCircle2 size={18} />}
              tone={
                report.businessHealth.delayedTasks.value > 0
                  ? "danger"
                  : "normal"
              }
              onClick={() => navigate("/tasks?filter=OVERDUE")}
            />
            <HealthCard
              label="Conversion"
              metric={report.businessHealth.conversionRate}
              suffix="%"
              icon={<Funnel size={18} />}
              onClick={() => setActiveTab("SALES_FUNNEL")}
            />
          </section>

          <section className="rounded-[34px] border border-amber-500/20 bg-amber-500/10 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
              <AlertTriangle size={18} />
              Needs Attention
            </div>

            <p className="mt-2 text-sm text-amber-100/65">
              These are the business leaks and incomplete setups that need owner
              action.
            </p>

            <div className="mt-5 grid gap-3 xl:grid-cols-2">
              {report.needsAttention.length === 0 ? (
                <div className="rounded-[26px] border border-amber-500/20 bg-black/20 p-5 text-sm text-amber-100/65 xl:col-span-2">
                  No urgent business issue detected for this period.
                </div>
              ) : (
                report.needsAttention.map((item) => (
                  <button
                    key={`${item.title}-${item.actionPath}`}
                    onClick={() => navigate(item.actionPath)}
                    className="rounded-[26px] border border-amber-500/20 bg-black/20 p-5 text-left transition hover:bg-black/30"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneForSeverity(item.severity)}>
                        {item.severity}
                      </Badge>
                      <p className="font-semibold text-amber-50">
                        {item.title}
                      </p>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-amber-100/70">
                      {item.description}
                    </p>

                    <p className="mt-4 text-sm font-semibold text-amber-50">
                      {item.actionLabel} →
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    activeTab === tab.value
                      ? "border-white bg-white text-black"
                      : "border-white/10 bg-white/[0.05] text-white/55 hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          {activeTab === "OVERVIEW" ? (
            <OverviewTab report={report} navigate={navigate} />
          ) : null}

          {activeTab === "SALES_FUNNEL" ? (
            <SalesFunnelTab report={report} maxFunnelValue={maxFunnelValue} />
          ) : null}

          {activeTab === "CONVERSATIONS" ? (
            <ConversationsTab report={report} />
          ) : null}

          {activeTab === "SOURCES" ? <SourcesTab report={report} /> : null}

          {activeTab === "TEAM_TASKS" ? (
            <TeamTasksTab report={report} navigate={navigate} />
          ) : null}

          {activeTab === "REVENUE" ? (
            <RevenueTab report={report} navigate={navigate} />
          ) : null}
        </>
      )}
    </section>
  );
}

function OverviewTab({
  report,
  navigate,
}: {
  report: ReportsResponse;
  navigate: (path: string) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Sales Funnel Snapshot" icon={<Funnel size={18} />}>
        <div className="space-y-3">
          {report.salesFunnel.stages.map((stage) => (
            <div key={stage.key} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{stage.label}</p>
                <p className="text-2xl font-semibold tracking-[-0.04em]">
                  {stage.notConnected ? "Not connected" : stage.value}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-sm leading-6 text-white/45">
          {report.salesFunnel.insight}
        </p>
      </Panel>

      <Panel title="Missed Opportunities" icon={<AlertTriangle size={18} />}>
        {report.missedOpportunities.items.length === 0 ? (
          <EmptySmall text="No missed opportunity pattern found." />
        ) : (
          <div className="space-y-3">
            {report.missedOpportunities.items.map((item) => (
              <button
                key={item.title}
                onClick={() => navigate(item.actionPath)}
                className="w-full rounded-2xl border border-white/10 bg-black/20 p-4 text-left hover:bg-white/[0.05]"
              >
                <Badge tone={toneForSeverity(item.severity)}>
                  {item.severity}
                </Badge>
                <p className="mt-3 text-sm font-semibold">{item.title}</p>
                <p className="mt-2 text-sm leading-6 text-white/40">
                  {item.description}
                </p>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Follow-up Health" icon={<Clock3 size={18} />}>
        <div className="grid grid-cols-2 gap-3">
          <MetricBox label="Due" value={report.followUp.due} />
          <MetricBox label="Overdue" value={report.followUp.overdue} />
          <MetricBox
            label="Hot without follow-up"
            value={report.followUp.hotWithoutFollowUp}
          />
          <MetricBox
            label="Follow-up no date"
            value={report.followUp.followUpWithoutDate}
          />
        </div>

        <p className="mt-4 text-sm leading-6 text-white/45">
          {report.followUp.insight}
        </p>
      </Panel>

      <Panel title="Conversation Health" icon={<MessageCircle size={18} />}>
        <div className="grid grid-cols-2 gap-3">
          <MetricBox label="WhatsApp" value={report.conversationPerformance.whatsapp} />
          <MetricBox label="Calls" value={report.conversationPerformance.calls} />
          <MetricBox label="Missed Calls" value={report.conversationPerformance.missedCalls} />
          <MetricBox label="Human Handoffs" value={report.conversationPerformance.humanHandoffs} />
        </div>

        <p className="mt-4 text-sm leading-6 text-white/45">
          {report.conversationPerformance.insight}
        </p>
      </Panel>
    </div>
  );
}

function SalesFunnelTab({
  report,
  maxFunnelValue,
}: {
  report: ReportsResponse;
  maxFunnelValue: number;
}) {
  return (
    <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
        <Funnel size={18} />
        Sales Funnel
      </div>

      <p className="mt-2 text-sm text-white/40">
        See where leads are dropping before they turn into customers.
      </p>

      <div className="mt-6 space-y-4">
        {report.salesFunnel.stages.map((stage) => {
          const width = stage.notConnected
            ? 100
            : Math.max(8, (stage.value / maxFunnelValue) * 100);

          return (
            <div key={stage.key}>
              <div className="mb-2 flex items-center justify-between gap-4">
                <p className="text-sm font-semibold">{stage.label}</p>
                <p className="text-sm text-white/45">
                  {stage.notConnected ? "Not connected" : stage.value}
                </p>
              </div>

              <div className="h-12 overflow-hidden rounded-2xl border border-white/10 bg-black/25">
                <div
                  className={`h-full rounded-2xl ${
                    stage.notConnected ? "bg-white/10" : "bg-white/70"
                  }`}
                  style={{
                    width: `${width}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-[26px] border border-cyan-500/20 bg-cyan-500/10 p-5">
        <p className="text-sm font-semibold text-cyan-100">AI insight</p>
        <p className="mt-2 text-sm leading-6 text-cyan-100/70">
          {report.salesFunnel.insight}
        </p>
      </div>
    </section>
  );
}

function ConversationsTab({ report }: { report: ReportsResponse }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Conversation Performance" icon={<MessageCircle size={18} />}>
        <div className="grid grid-cols-2 gap-3">
          <MetricBox label="WhatsApp chats" value={report.conversationPerformance.whatsapp} />
          <MetricBox label="Calls received" value={report.conversationPerformance.calls} />
          <MetricBox label="Website chats" value={report.conversationPerformance.website} />
          <MetricBox label="Missed calls" value={report.conversationPerformance.missedCalls} />
          <MetricBox label="AI handled" value={report.conversationPerformance.aiHandled} />
          <MetricBox label="Human handoffs" value={report.conversationPerformance.humanHandoffs} />
          <MetricBox
            label="Meetings from conv."
            value={report.conversationPerformance.meetingsFromConversations}
          />
          <MetricBox
            label="Avg call duration"
            value={formatSeconds(report.conversationPerformance.avgCallDuration)}
          />
        </div>

        <p className="mt-4 text-sm leading-6 text-white/45">
          {report.conversationPerformance.insight}
        </p>
      </Panel>

      <Panel title="Common Customer Intents" icon={<Sparkles size={18} />}>
        {report.conversationPerformance.commonIntents.length === 0 ? (
          <EmptySmall text="No customer intent data yet." />
        ) : (
          <div className="space-y-3">
            {report.conversationPerformance.commonIntents.map((intent) => (
              <div
                key={intent.intent}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <p className="text-sm font-semibold">{intent.intent}</p>
                <Badge>{intent.count}</Badge>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function SourcesTab({ report }: { report: ReportsResponse }) {
  return (
    <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
        <BarChart3 size={18} />
        Source Quality
      </div>

      <p className="mt-2 text-sm text-white/40">
        Which sources create good leads, hot leads, meetings and wins.
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[940px] text-left text-sm">
          <thead className="text-xs text-white/35">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Leads</th>
              <th className="px-4 py-3">Hot</th>
              <th className="px-4 py-3">Meetings</th>
              <th className="px-4 py-3">Won</th>
              <th className="px-4 py-3">Lost</th>
              <th className="px-4 py-3">Conversion</th>
              <th className="px-4 py-3">Quality</th>
              <th className="px-4 py-3">Avg response</th>
            </tr>
          </thead>

          <tbody>
            {report.sourcePerformance.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-white/40">
                  No source data yet.
                </td>
              </tr>
            ) : (
              report.sourcePerformance.rows.map((row) => (
                <tr key={row.source} className="border-t border-white/10">
                  <td className="px-4 py-4 font-semibold">{row.source}</td>
                  <td className="px-4 py-4 text-white/65">{row.leads}</td>
                  <td className="px-4 py-4 text-white/65">{row.hot}</td>
                  <td className="px-4 py-4 text-white/65">{row.meetings}</td>
                  <td className="px-4 py-4 text-white/65">{row.won}</td>
                  <td className="px-4 py-4 text-white/65">{row.lost}</td>
                  <td className="px-4 py-4 text-white/65">
                    {row.conversionRate}%
                  </td>
                  <td className="px-4 py-4">
                    <Badge>{row.quality}</Badge>
                  </td>
                  <td className="px-4 py-4 text-white/45">
                    {row.avgResponseTime}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-[26px] border border-cyan-500/20 bg-cyan-500/10 p-5">
        <p className="text-sm font-semibold text-cyan-100">AI insight</p>
        <p className="mt-2 text-sm leading-6 text-cyan-100/70">
          {report.sourcePerformance.insight}
        </p>
      </div>
    </section>
  );
}

function TeamTasksTab({
  report,
  navigate,
}: {
  report: ReportsResponse;
  navigate: (path: string) => void;
}) {
  if (report.teamTaskReport.assigned === 0) {
    return (
      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-8">
        <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.06] text-white/40">
            <UsersRound size={34} />
          </div>

          <h3 className="mt-5 text-2xl font-semibold tracking-[-0.04em]">
            No task report yet
          </h3>

          <p className="mt-3 max-w-md text-sm leading-6 text-white/40">
            Assign tasks to start tracking workload, delays, blocked work and
            team execution.
          </p>

          <button
            onClick={() => navigate("/tasks")}
            className="mt-6 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black"
          >
            Create Task
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Team & Task Performance" icon={<UsersRound size={18} />}>
        <div className="grid grid-cols-2 gap-3">
          <MetricBox label="Tasks assigned" value={report.teamTaskReport.assigned} />
          <MetricBox label="Completed" value={report.teamTaskReport.completed} />
          <MetricBox label="Delayed" value={report.teamTaskReport.delayed} />
          <MetricBox label="Blocked" value={report.teamTaskReport.blocked} />
          <MetricBox label="Waiting review" value={report.teamTaskReport.waitingReview} />
        </div>

        <p className="mt-4 text-sm leading-6 text-white/45">
          {report.teamTaskReport.insight}
        </p>
      </Panel>

      <Panel title="Employee Workload" icon={<UsersRound size={18} />}>
        <div className="space-y-3">
          {report.teamTaskReport.employees.map((employee) => (
            <div
              key={employee.id}
              className="rounded-2xl border border-white/10 bg-black/20 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{employee.name}</p>
                <Badge
                  tone={employee.workloadPercent > 100 ? "danger" : "normal"}
                >
                  {employee.workloadPercent}% load
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2">
                <Mini label="Active" value={employee.active} />
                <Mini label="Done" value={employee.completed} />
                <Mini label="Delayed" value={employee.delayed} />
                <Mini label="Blocked" value={employee.blocked} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function RevenueTab({
  report,
  navigate,
}: {
  report: ReportsResponse;
  navigate: (path: string) => void;
}) {
  if (!report.revenue.connected) {
    return (
      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.06] text-white/40">
            <IndianRupee size={34} />
          </div>

          <h3 className="mt-5 text-3xl font-semibold tracking-[-0.05em]">
            Revenue tracking is not active
          </h3>

          <p className="mt-4 text-sm leading-7 text-white/45">
            {report.revenue.message}
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {report.revenue.setupOptions.map((option) => (
              <div
                key={option}
                className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/65"
              >
                {option}
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate("/settings")}
            className="mt-6 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black"
          >
            Set Up Revenue
          </button>
        </div>
      </section>
    );
  }

  return (
    <Panel title="Revenue Report" icon={<IndianRupee size={18} />}>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricBox label="Collected" value={report.revenue.collected || 0} />
        <MetricBox label="Pending" value={report.revenue.pending || 0} />
        <MetricBox label="Pipeline" value={report.revenue.pipelineValue || 0} />
      </div>
    </Panel>
  );
}

function HealthCard({
  label,
  metric,
  suffix = "",
  icon,
  tone = "normal",
  onClick,
}: {
  label: string;
  metric: ComparedMetric;
  suffix?: string;
  icon: ReactNode;
  tone?: "normal" | "warning" | "danger";
  onClick: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/20 bg-red-500/10"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10"
        : "border-white/10 bg-white/[0.04]";

  return (
    <button
      onClick={onClick}
      className={`rounded-[26px] border p-4 text-left transition hover:bg-white/[0.07] ${toneClass}`}
    >
      <div className="flex items-center justify-between gap-3 text-white/50">
        <p className="text-xs">{label}</p>
        {icon}
      </div>

      <p className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
        {metric.value}
        {suffix}
      </p>

      <p
        className={`mt-2 text-xs ${
          metric.direction === "UP"
            ? "text-emerald-100"
            : metric.direction === "DOWN"
              ? "text-red-100"
              : "text-white/35"
        }`}
      >
        {comparisonText(metric)}
      </p>
    </button>
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
    <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
      <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-white/70">
        {icon}
        {title}
      </div>

      {children}
    </section>
  );
}

function MetricBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
        {value}
      </p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Badge({
  children,
  tone = "normal",
}: {
  children: ReactNode;
  tone?: "normal" | "warning" | "danger" | "success";
}) {
  const className =
    tone === "danger"
      ? "bg-red-500/10 text-red-100"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-100"
        : tone === "success"
          ? "bg-emerald-500/10 text-emerald-100"
          : "bg-white/10 text-white/55";

  return (
    <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs ${className}`}>
      {children}
    </span>
  );
}

function EmptySmall({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-sm text-white/40">
      {text}
    </div>
  );
}