import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle2,
  Clock3,
  CreditCard,
  Database,
  Edit3,
  KeyRound,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Trash2,
  UserRound,
  UsersRound,
  Workflow,
  Zap,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type Section =
  | "COMPANY"
  | "TEAM"
  | "CHANNELS"
  | "AI"
  | "CRM"
  | "NOTIFICATIONS"
  | "BILLING"
  | "SECURITY";

type AiTab = "BEHAVIOR" | "KNOWLEDGE" | "HANDOFF" | "TEST";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  isActive: boolean;
  department?: string | null;
  jobTitle?: string | null;
  workloadCapacity?: number | null;
  permissions?: Record<string, boolean> | null;
  twoFactorEnabled?: boolean;
  lastActiveAt?: string | null;
  createdAt?: string;
};

type KnowledgeItem = {
  id: string;
  title: string;
  category: string;
  content: string;
  enabled?: boolean;
  isActive?: boolean;
  sourceType?: string | null;
  fileUrl?: string | null;
  updatedAt: string;
};

type CrmStage = {
  id: string;
  name: string;
  color?: string | null;
  order: number;
  isEnabled: boolean;
  requiredFields?: string[];
  automationRule?: Record<string, unknown>;
};

type HandoffRule = {
  id: string;
  name: string;
  condition: string;
  action: string;
  assignedUserId?: string | null;
  notificationChannel?: string | null;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  isEnabled: boolean;
};

type NotificationRule = {
  id: string;
  name: string;
  event: string;
  recipients?: string[];
  channels?: string[];
  isEnabled: boolean;
};

type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  message: string;
  createdAt: string;
};

type IntegrationConnection = {
  id?: string;
  provider: string;
  channel?: string | null;
  status: string;
  displayName?: string | null;
  accountId?: string | null;
  phoneNumber?: string | null;
  webhookUrl?: string | null;
  mode?: string | null;
  lastCheckedAt?: string | null;
  lastEventAt?: string | null;
  lastError?: string | null;
  metadata?: Record<string, any> | null;
};

type SettingsResponse = {
  company: {
    id: string;
    name: string;
  };
  settings: Record<string, any>;
  teamMembers: TeamMember[];
  knowledgeItems: KnowledgeItem[];
  crmStages: CrmStage[];
  handoffRules: HandoffRule[];
  notificationRules: NotificationRule[];
  auditLogs: AuditLog[];
  integrationConnections?: IntegrationConnection[];
  setupHealth: {
    completed: number;
    total: number;
    percent: number;
    checks: {
      key: string;
      label: string;
      complete: boolean;
      description: string;
    }[];
  };
  integrations: Record<string, any>;
  billing: {
    status: string;
    message: string;
    plan: string;
    usage: {
      aiMessages: number;
      callMinutes: number;
      whatsappMessages: number;
      teamSeats: number;
    };
  };
};

const sections: {
  value: Section;
  label: string;
  description: string;
  icon: ReactNode;
}[] = [
  {
    value: "COMPANY",
    label: "Company",
    description: "Profile, hours, contact numbers",
    icon: <Building2 size={18} />,
  },
  {
    value: "TEAM",
    label: "Team & Permissions",
    description: "Roles, permissions, password reset",
    icon: <UsersRound size={18} />,
  },
  {
    value: "CHANNELS",
    label: "Channels",
    description: "WhatsApp, calls, website, email",
    icon: <MessageCircle size={18} />,
  },
  {
    value: "AI",
    label: "AI Setup",
    description: "Behavior, knowledge, handoff, test",
    icon: <Bot size={18} />,
  },
  {
    value: "CRM",
    label: "CRM & Workflow",
    description: "Stages and task rules",
    icon: <Workflow size={18} />,
  },
  {
    value: "NOTIFICATIONS",
    label: "Notifications",
    description: "Alerts and recipients",
    icon: <Zap size={18} />,
  },
  {
    value: "BILLING",
    label: "Billing",
    description: "Plan and usage",
    icon: <CreditCard size={18} />,
  },
  {
    value: "SECURITY",
    label: "Security",
    description: "2FA, audit logs, data",
    icon: <Shield size={18} />,
  },
];

const aiTabs: {
  value: AiTab;
  label: string;
}[] = [
  { value: "BEHAVIOR", label: "AI Behavior" },
  { value: "KNOWLEDGE", label: "Knowledge Base" },
  { value: "HANDOFF", label: "Handoff Rules" },
  { value: "TEST", label: "Test AI" },
];

const permissionOptions = [
  {
    key: "canViewLeads",
    label: "View leads",
    description: "Can open and inspect lead records.",
  },
  {
    key: "canReplyWhatsapp",
    label: "Reply to WhatsApp",
    description: "Can send WhatsApp replies to customers.",
  },
  {
    key: "canHandleCalls",
    label: "Handle calls",
    description: "Can manage call handoffs and callbacks.",
  },
  {
    key: "canAssignTasks",
    label: "Assign tasks",
    description: "Can assign work to team members.",
  },
  {
    key: "canApproveTasks",
    label: "Approve tasks",
    description: "Can review submitted work.",
  },
  {
    key: "canViewReports",
    label: "View reports",
    description: "Can see business reports and performance.",
  },
  {
    key: "canManageSettings",
    label: "Manage settings",
    description: "Can change workspace setup.",
  },
  {
    key: "canManageBilling",
    label: "Manage billing",
    description: "Can view plan and payment settings.",
  },
];

const defaultPermissions: Record<string, boolean> = {
  canViewLeads: true,
  canReplyWhatsapp: false,
  canHandleCalls: false,
  canAssignTasks: false,
  canApproveTasks: false,
  canViewReports: false,
  canManageSettings: false,
  canManageBilling: false,
};

const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function formatDate(value?: string | null) {
  if (!value) return "Not available";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function labelFromEnum(value?: string | null) {
  if (!value) return "-";

  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function splitList(value: string) {
  return value
    .split(/,|\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: any) {
  if (!Array.isArray(value)) return "";
  return value.join("\n");
}

function normalizeBusinessHours(value: any) {
  if (Array.isArray(value)) return value;

  return days.map((day) => ({
    day,
    open: day !== "Sunday",
    from: "10:00",
    to: "20:00",
  }));
}

function statusTone(status?: string) {
  if (status === "CONNECTED" || status === "LIVE") return "success";
  if (status === "ERROR") return "danger";
  return "warning";
}

function priorityTone(priority: string) {
  if (priority === "CRITICAL") return "danger";
  if (priority === "HIGH") return "warning";
  if (priority === "MEDIUM") return "info";
  return "normal";
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>("COMPANY");
  const [data, setData] = useState<SettingsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function loadSettings() {
    try {
      setLoading(true);
      setError("");

      const response = await apiFetch<SettingsResponse>(
        "/api/settings/control-room"
      );

      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  async function runSave<T>(label: string, fn: () => Promise<T>) {
    try {
      setSaving(label);
      setError("");
      setNotice("");

      const result = await fn();

      setNotice("Saved successfully");
      await loadSettings();

      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
      throw err;
    } finally {
      setSaving("");
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  if (loading && !data) {
    return (
      <section className="flex min-h-[calc(100vh-150px)] items-center justify-center">
        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/50">
          <Loader2 className="animate-spin" size={18} />
          Loading settings control room...
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-[34px] border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-100">
        {error || "Settings failed to load."}
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-cyan-200">
              <Shield size={14} />
              SaaS Control Room
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
              Settings
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
              Control company setup, team access, channels, AI behavior,
              workflow, notifications, billing and security.
            </p>
          </div>

          <button
            onClick={loadSettings}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 hover:text-white"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        <div className="mt-6 rounded-[28px] border border-white/10 bg-black/20 p-5">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div>
              <p className="text-sm font-semibold text-white/75">
                Setup Checklist
              </p>
              <p className="mt-1 text-sm text-white/40">
                Setup {data.setupHealth.completed}/{data.setupHealth.total}{" "}
                complete
              </p>
            </div>

            <div className="h-3 overflow-hidden rounded-full bg-white/10 xl:w-[420px]">
              <div
                className="h-full rounded-full bg-white"
                style={{
                  width: `${data.setupHealth.percent}%`,
                }}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {data.setupHealth.checks.map((check) => (
              <div
                key={check.key}
                className={`rounded-2xl border p-4 ${
                  check.complete
                    ? "border-emerald-500/20 bg-emerald-500/10"
                    : "border-amber-500/20 bg-amber-500/10"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {check.complete ? (
                    <CheckCircle2 size={16} className="text-emerald-100" />
                  ) : (
                    <AlertTriangle size={16} className="text-amber-100" />
                  )}
                  {check.label}
                </div>

                <p className="mt-2 text-xs leading-5 text-white/45">
                  {check.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {notice ? (
          <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="h-fit rounded-[34px] border border-white/10 bg-white/[0.04] p-3">
          <div className="space-y-2">
            {sections.map((section) => (
              <button
                key={section.value}
                onClick={() => setActiveSection(section.value)}
                className={`w-full rounded-[24px] border p-4 text-left transition ${
                  activeSection === section.value
                    ? "border-cyan-200/60 bg-cyan-400/[0.08]"
                    : "border-transparent hover:border-white/10 hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-white/55">
                    {section.icon}
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{section.label}</p>
                    <p className="mt-1 text-xs leading-5 text-white/35">
                      {section.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          <IntegrationStatusStrip data={data} />

          {activeSection === "COMPANY" ? (
            <CompanySection data={data} saving={saving} onSave={runSave} />
          ) : null}

          {activeSection === "TEAM" ? (
            <TeamPermissionsSection
              data={data}
              saving={saving}
              onSave={runSave}
            />
          ) : null}

          {activeSection === "CHANNELS" ? (
            <ChannelsSection data={data} saving={saving} onSave={runSave} />
          ) : null}

          {activeSection === "AI" ? (
            <AiSetupSection data={data} saving={saving} onSave={runSave} />
          ) : null}

          {activeSection === "CRM" ? (
            <CrmWorkflowSection data={data} saving={saving} onSave={runSave} />
          ) : null}

          {activeSection === "NOTIFICATIONS" ? (
            <NotificationsSection
              data={data}
              saving={saving}
              onSave={runSave}
            />
          ) : null}

          {activeSection === "BILLING" ? <BillingSection data={data} /> : null}

          {activeSection === "SECURITY" ? (
            <SecuritySection data={data} saving={saving} onSave={runSave} />
          ) : null}
        </main>
      </div>
    </section>
  );
}

function IntegrationStatusStrip({ data }: { data: SettingsResponse }) {
  const integrations = [
    {
      label: "WhatsApp",
      status: data.integrations.whatsapp?.status,
      mode: data.integrations.whatsapp?.mode,
      detail: data.integrations.whatsapp?.businessNumber || "Meta Cloud API",
    },
    {
      label: "Calls",
      status: data.integrations.calls?.status,
      mode: data.integrations.calls?.mode,
      detail:
        data.integrations.calls?.businessPhoneNumber ||
        data.integrations.calls?.provider ||
        "Twilio Realtime",
    },
    {
      label: "Website",
      status: data.integrations.websiteChat?.status,
      mode: data.integrations.websiteChat?.mode,
      detail: "Website widget",
    },
    {
      label: "Email",
      status: data.integrations.email?.status,
      mode: data.integrations.email?.mode,
      detail: data.integrations.email?.fromEmail || "Email channel",
    },
    {
      label: "Payment",
      status: data.integrations.payment?.status,
      mode: data.integrations.payment?.mode,
      detail: "Manual billing",
    },
  ];

  return (
    <section className="rounded-[30px] border border-white/10 bg-white/[0.035] p-4">
      <div className="grid gap-3 md:grid-cols-5">
        {integrations.map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-white/10 bg-black/20 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-white/35">{item.label}</p>
                <p className="mt-1 truncate text-xs text-white/25">
                  {item.detail}
                </p>
              </div>

              {item.status === "CONNECTED" || item.status === "LIVE" ? (
                <CheckCircle2 size={16} className="shrink-0 text-emerald-200" />
              ) : (
                <AlertTriangle size={16} className="shrink-0 text-amber-200" />
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={statusTone(String(item.status))}>
                {String(item.status || "NOT_CONNECTED")}
              </Badge>

              {item.mode ? <Badge>{String(item.mode)}</Badge> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompanySection({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const settings = data.settings;

  const [companyName, setCompanyName] = useState(data.company.name || "");
  const [businessType, setBusinessType] = useState(settings.businessType || "");
  const [address, setAddress] = useState(settings.address || "");
  const [city, setCity] = useState(settings.city || "");
  const [country, setCountry] = useState(settings.country || "India");
  const [timezone, setTimezone] = useState(settings.timezone || "Asia/Kolkata");
  const [defaultLanguage, setDefaultLanguage] = useState(
    settings.defaultLanguage || "English"
  );
  const [supportedLanguages, setSupportedLanguages] = useState(
    joinList(settings.supportedLanguages) || "English"
  );
  const [websiteUrl, setWebsiteUrl] = useState(settings.websiteUrl || "");
  const [brandTone, setBrandTone] = useState(settings.brandTone || "");
  const [mainWhatsappNumber, setMainWhatsappNumber] = useState(
    settings.mainWhatsappNumber || ""
  );
  const [mainCallNumber, setMainCallNumber] = useState(
    settings.mainCallNumber || ""
  );
  const [callForwardingNumber, setCallForwardingNumber] = useState(
    settings.callForwardingNumber || ""
  );
  const [emergencyEscalationNumber, setEmergencyEscalationNumber] = useState(
    settings.emergencyEscalationNumber || ""
  );
  const [closedDays, setClosedDays] = useState(
    Array.isArray(settings.closedDays) ? settings.closedDays.join("\n") : ""
  );
  const [businessHours, setBusinessHours] = useState(
    normalizeBusinessHours(settings.businessHours)
  );

  useEffect(() => {
    setCompanyName(data.company.name || "");
    setBusinessType(settings.businessType || "");
    setAddress(settings.address || "");
    setCity(settings.city || "");
    setCountry(settings.country || "India");
    setTimezone(settings.timezone || "Asia/Kolkata");
    setDefaultLanguage(settings.defaultLanguage || "English");
    setSupportedLanguages(joinList(settings.supportedLanguages) || "English");
    setWebsiteUrl(settings.websiteUrl || "");
    setBrandTone(settings.brandTone || "");
    setMainWhatsappNumber(settings.mainWhatsappNumber || "");
    setMainCallNumber(settings.mainCallNumber || "");
    setCallForwardingNumber(settings.callForwardingNumber || "");
    setEmergencyEscalationNumber(settings.emergencyEscalationNumber || "");
    setClosedDays(
      Array.isArray(settings.closedDays) ? settings.closedDays.join("\n") : ""
    );
    setBusinessHours(normalizeBusinessHours(settings.businessHours));
  }, [data.company.name, settings]);

  async function submit(event: FormEvent) {
    event.preventDefault();

    await onSave("company", async () => {
      await apiFetch("/api/settings/company", {
        method: "PATCH",
        body: JSON.stringify({
          companyName,
          businessType,
          address,
          city,
          country,
          timezone,
          defaultLanguage,
          supportedLanguages: splitList(supportedLanguages),
          websiteUrl,
          brandTone,
          mainWhatsappNumber,
          mainCallNumber,
          callForwardingNumber,
          emergencyEscalationNumber,
          closedDays: splitList(closedDays),
          businessHours,
        }),
      });
    });
  }

  return (
    <Panel title="Company Profile" icon={<Building2 size={18} />}>
      <form onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-2">
          <Field label="Company name">
            <Input value={companyName} onChange={setCompanyName} />
          </Field>

          <Field label="Business type">
            <Input
              value={businessType}
              onChange={setBusinessType}
              placeholder="Your business type"
            />
          </Field>

          <Field label="Address">
            <Input value={address} onChange={setAddress} />
          </Field>

          <Field label="City">
            <Input value={city} onChange={setCity} />
          </Field>

          <Field label="Country">
            <Input value={country} onChange={setCountry} />
          </Field>

          <Field label="Timezone">
            <Input value={timezone} onChange={setTimezone} />
          </Field>

          <Field label="Default language">
            <Input value={defaultLanguage} onChange={setDefaultLanguage} />
          </Field>

          <Field label="Supported languages">
            <Textarea
              value={supportedLanguages}
              onChange={setSupportedLanguages}
              placeholder="English&#10;Hindi&#10;Gujarati"
              rows={4}
            />
          </Field>

          <Field label="Website URL">
            <Input value={websiteUrl} onChange={setWebsiteUrl} />
          </Field>

          <Field label="Brand tone">
            <Input
              value={brandTone}
              onChange={setBrandTone}
              placeholder="Premium, friendly, clinical..."
            />
          </Field>

          <Field label="Main WhatsApp number">
            <Input
              value={mainWhatsappNumber}
              onChange={setMainWhatsappNumber}
            />
          </Field>

          <Field label="Main call number">
            <Input value={mainCallNumber} onChange={setMainCallNumber} />
          </Field>

          <Field label="Call forwarding number">
            <Input
              value={callForwardingNumber}
              onChange={setCallForwardingNumber}
            />
          </Field>

          <Field label="Emergency escalation number">
            <Input
              value={emergencyEscalationNumber}
              onChange={setEmergencyEscalationNumber}
            />
          </Field>

          <div className="xl:col-span-2">
            <Field label="Closed / holiday dates">
              <Textarea
                value={closedDays}
                onChange={setClosedDays}
                placeholder="2026-08-15&#10;2026-10-02"
                rows={4}
              />
            </Field>
          </div>
        </div>

        <div className="rounded-[26px] border border-white/10 bg-black/20 p-5">
          <p className="text-sm font-semibold text-white/75">
            Business Hours
          </p>

          <div className="mt-4 space-y-3">
            {businessHours.map((row: any, index: number) => (
              <div
                key={row.day}
                className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 md:grid-cols-[160px_130px_1fr_1fr]"
              >
                <p className="self-center text-sm font-medium">{row.day}</p>

                <select
                  value={row.open ? "OPEN" : "CLOSED"}
                  onChange={(event) => {
                    const next = [...businessHours];
                    next[index] = {
                      ...row,
                      open: event.target.value === "OPEN",
                    };
                    setBusinessHours(next);
                  }}
                  className="h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm outline-none"
                >
                  <option value="OPEN" className="bg-[#05070d]">
                    Open
                  </option>
                  <option value="CLOSED" className="bg-[#05070d]">
                    Closed
                  </option>
                </select>

                <input
                  type="time"
                  value={row.from}
                  disabled={!row.open}
                  onChange={(event) => {
                    const next = [...businessHours];
                    next[index] = {
                      ...row,
                      from: event.target.value,
                    };
                    setBusinessHours(next);
                  }}
                  className="h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm outline-none disabled:opacity-40"
                />

                <input
                  type="time"
                  value={row.to}
                  disabled={!row.open}
                  onChange={(event) => {
                    const next = [...businessHours];
                    next[index] = {
                      ...row,
                      to: event.target.value,
                    };
                    setBusinessHours(next);
                  }}
                  className="h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm outline-none disabled:opacity-40"
                />
              </div>
            ))}
          </div>
        </div>

        <SaveButton saving={saving === "company"} />
      </form>
    </Panel>
  );
}

function TeamPermissionsSection({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const [selectedMemberId, setSelectedMemberId] = useState(
    data.teamMembers[0]?.id || ""
  );

  const selected = useMemo(() => {
    return (
      data.teamMembers.find((member) => member.id === selectedMemberId) ||
      data.teamMembers[0] ||
      null
    );
  }, [data.teamMembers, selectedMemberId]);

  const [role, setRole] = useState<"OWNER" | "ADMIN" | "STAFF">(
    selected?.role || "STAFF"
  );
  const [department, setDepartment] = useState(selected?.department || "");
  const [jobTitle, setJobTitle] = useState(selected?.jobTitle || "");
  const [capacity, setCapacity] = useState(selected?.workloadCapacity || 8);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({
    ...defaultPermissions,
    ...(selected?.permissions || {}),
  });
  const [resetPassword, setResetPassword] = useState("");

  useEffect(() => {
    if (!selectedMemberId && data.teamMembers[0]) {
      setSelectedMemberId(data.teamMembers[0].id);
    }
  }, [data.teamMembers, selectedMemberId]);

  useEffect(() => {
    if (!selected) return;

    setRole(selected.role);
    setDepartment(selected.department || "");
    setJobTitle(selected.jobTitle || "");
    setCapacity(selected.workloadCapacity || 8);
    setPermissions({
      ...defaultPermissions,
      ...(selected.permissions || {}),
    });
    setResetPassword("");
  }, [selected?.id]);

  async function saveMember(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;

    await onSave("team", async () => {
      await apiFetch(`/api/settings/team/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          role,
          department,
          jobTitle,
          workloadCapacity: capacity,
          permissions,
        }),
      });
    });
  }

  async function resetMemberPassword() {
    if (!selected || !resetPassword.trim()) return;

    await onSave("password", async () => {
      await apiFetch(`/api/settings/team/${selected.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({
          password: resetPassword,
        }),
      });

      setResetPassword("");
    });
  }

  if (data.teamMembers.length === 0) {
    return (
      <Panel title="Team & Permissions" icon={<UsersRound size={18} />}>
        <EmptyBox text="No team members found. Invite members from the Team page first." />
      </Panel>
    );
  }

  return (
    <Panel title="Team & Permissions" icon={<UsersRound size={18} />}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold text-white/75">
            Select a team member
          </p>
          <p className="mt-1 text-sm leading-6 text-white/40">
            Choose one person, then manage their role, department, permissions
            and password.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {data.teamMembers.map((member) => (
            <button
              key={member.id}
              onClick={() => setSelectedMemberId(member.id)}
              className={`rounded-[24px] border p-4 text-left transition ${
                selected?.id === member.id
                  ? "border-cyan-200/60 bg-cyan-400/[0.08]"
                  : "border-white/10 bg-black/20 hover:bg-white/[0.05]"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-white/55">
                  <UserRound size={18} />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {member.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-white/40">
                    {member.email}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{member.role}</Badge>
                    <Badge tone={member.isActive ? "success" : "muted"}>
                      {member.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {selected ? (
          <form onSubmit={saveMember} className="space-y-6">
            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div>
                  <p className="text-xl font-semibold tracking-[-0.04em]">
                    {selected.name}
                  </p>
                  <p className="mt-1 text-sm text-white/40">
                    {selected.email}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge>{selected.role}</Badge>
                  <Badge tone={selected.isActive ? "success" : "muted"}>
                    {selected.isActive ? "Active account" : "Inactive account"}
                  </Badge>
                </div>
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                <Field label="Role">
                  <select
                    value={role}
                    onChange={(event) =>
                      setRole(event.target.value as "OWNER" | "ADMIN" | "STAFF")
                    }
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  >
                    <option value="OWNER" className="bg-[#05070d]">
                      Owner
                    </option>
                    <option value="ADMIN" className="bg-[#05070d]">
                      Admin
                    </option>
                    <option value="STAFF" className="bg-[#05070d]">
                      Staff
                    </option>
                  </select>
                </Field>

                <Field label="Workload capacity">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={capacity}
                    onChange={(event) =>
                      setCapacity(Number(event.target.value))
                    }
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  />
                </Field>

                <Field label="Department">
                  <Input
                    value={department}
                    onChange={setDepartment}
                    placeholder="Sales, Support, Reception..."
                  />
                </Field>

                <Field label="Job title">
                  <Input
                    value={jobTitle}
                    onChange={setJobTitle}
                    placeholder="Manager, Receptionist..."
                  />
                </Field>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div>
                  <p className="text-sm font-semibold text-white/75">
                    Access permissions
                  </p>
                  <p className="mt-1 text-sm leading-6 text-white/40">
                    Turn on only what this person should be allowed to access.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setPermissions({
                      ...defaultPermissions,
                      canViewLeads: true,
                    })
                  }
                  className="h-11 rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm text-white/60 hover:text-white"
                >
                  Reset Permissions
                </button>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {permissionOptions.map((permission) => (
                  <label
                    key={permission.key}
                    className={`rounded-[22px] border p-4 transition ${
                      permissions[permission.key]
                        ? "border-cyan-300/30 bg-cyan-400/[0.08]"
                        : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold">
                          {permission.label}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-white/40">
                          {permission.description}
                        </p>
                      </div>

                      <input
                        type="checkbox"
                        checked={Boolean(permissions[permission.key])}
                        onChange={(event) =>
                          setPermissions({
                            ...permissions,
                            [permission.key]: event.target.checked,
                          })
                        }
                        className="mt-1 shrink-0"
                      />
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
              <p className="text-sm font-semibold text-white/75">
                Password reset
              </p>
              <p className="mt-1 text-sm leading-6 text-white/40">
                Use this only when a team member cannot access their account.
              </p>

              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                <Input
                  type="password"
                  value={resetPassword}
                  onChange={setResetPassword}
                  placeholder="New password"
                />

                <button
                  type="button"
                  disabled={saving === "password" || !resetPassword.trim()}
                  onClick={resetMemberPassword}
                  className="h-12 rounded-2xl border border-white/10 bg-white/[0.05] px-5 text-sm text-white/70 hover:text-white disabled:opacity-40"
                >
                  {saving === "password" ? "Resetting..." : "Reset"}
                </button>
              </div>
            </div>

            <SaveButton saving={saving === "team"} />
          </form>
        ) : null}
      </div>
    </Panel>
  );
}

function ChannelsSection({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const [active, setActive] = useState<
    "whatsapp" | "calls" | "websiteChat" | "email"
  >("whatsapp");

  const [settings, setSettings] = useState<Record<string, any>>(
    data.integrations.whatsapp || {}
  );

  const [whatsappProviderMode, setWhatsappProviderMode] = useState<"mock" | "cloud">("mock");
  const [businessWhatsappNumber, setBusinessWhatsappNumber] = useState("");
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState("");
  const [whatsappBusinessAccountId, setWhatsappBusinessAccountId] = useState("");
  const [whatsappGraphApiVersion, setWhatsappGraphApiVersion] = useState("v20.0");
  const [whatsappWebhookVerifyToken, setWhatsappWebhookVerifyToken] = useState("airadesk_verify_token");
  const [whatsappAccessToken, setWhatsappAccessToken] = useState("");
  const [whatsappAccessTokenSet, setWhatsappAccessTokenSet] = useState(false);
  const [whatsappAccessTokenPreview, setWhatsappAccessTokenPreview] = useState("");
  const [whatsappWebhookUrl, setWhatsappWebhookUrl] = useState("");
  const [whatsappStatus, setWhatsappStatus] = useState("NOT_CONNECTED");

  useEffect(() => {
    setSettings(data.integrations[active] || {});
  }, [active, data.integrations]);

  useEffect(() => {
    if (active !== "whatsapp") return;

    let mounted = true;

    apiFetch<{ config: Record<string, any> }>("/api/whatsapp-integration")
      .then((response) => {
        if (!mounted) return;

        const config = response.config || {};
        setWhatsappProviderMode(config.whatsappProviderMode || "mock");
        setBusinessWhatsappNumber(config.businessWhatsappNumber || config.mainWhatsappNumber || config.whatsappNumber || "");
        setWhatsappPhoneNumberId(config.whatsappPhoneNumberId || "");
        setWhatsappBusinessAccountId(config.whatsappBusinessAccountId || "");
        setWhatsappGraphApiVersion(config.whatsappGraphApiVersion || "v20.0");
        setWhatsappWebhookVerifyToken(config.whatsappWebhookVerifyToken || "airadesk_verify_token");
        setWhatsappAccessTokenSet(Boolean(config.whatsappAccessTokenSet));
        setWhatsappAccessTokenPreview(config.whatsappAccessTokenPreview || "");
        setWhatsappWebhookUrl(config.webhookUrl || settings.webhookUrl || "");
        setWhatsappStatus(config.status || (config.connected ? "CONNECTED" : "NOT_CONNECTED"));
        setWhatsappAccessToken("");
      })
      .catch(() => {
        if (!mounted) return;
        setWhatsappStatus(settings.status || "NOT_CONNECTED");
      });

    return () => {
      mounted = false;
    };
  }, [active, data.integrations, settings.status, settings.webhookUrl]);

  const connection = settings.connection || null;
  const isRuntimeChannel = active === "calls" || active === "whatsapp";
  const isConnected =
    active === "whatsapp"
      ? whatsappStatus === "CONNECTED" || whatsappStatus === "LIVE"
      : settings.status === "CONNECTED" || settings.status === "LIVE";

  async function saveChannel() {
    await onSave(`channel-${active}`, async () => {
      await apiFetch(`/api/settings/channels/${active}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings,
        }),
      });
    });
  }

  async function saveWhatsAppIntegration() {
    await onSave("channel-whatsapp", async () => {
      const response = await apiFetch<{ config: Record<string, any> }>(
        "/api/whatsapp-integration",
        {
          method: "PATCH",
          body: JSON.stringify({
            whatsappProviderMode,
            businessWhatsappNumber,
            whatsappPhoneNumberId,
            whatsappBusinessAccountId,
            whatsappGraphApiVersion,
            whatsappWebhookVerifyToken,
            whatsappAccessToken: whatsappAccessToken.trim() || undefined,
          }),
        }
      );

      const config = response.config || {};
      setWhatsappStatus(config.status || (config.connected ? "CONNECTED" : "NOT_CONNECTED"));
      setWhatsappAccessTokenSet(Boolean(config.whatsappAccessTokenSet));
      setWhatsappAccessTokenPreview(config.whatsappAccessTokenPreview || "");
      setWhatsappWebhookUrl(config.webhookUrl || "");
      setWhatsappAccessToken("");
    });
  }

  async function testChannel() {
    if (active === "whatsapp") {
      const to = window.prompt("Send test WhatsApp to which customer number? Use country code, example +919586410399");
      if (!to?.trim()) return;

      const body = window.prompt("Test message", "Hi, this is a real WhatsApp message from AiraDesk.");
      if (!body?.trim()) return;

      await onSave("test-whatsapp", async () => {
        await apiFetch("/api/whatsapp-integration/test-send", {
          method: "POST",
          body: JSON.stringify({
            to: to.trim(),
            body: body.trim(),
          }),
        });
      });
      return;
    }

    await onSave(`test-${active}`, async () => {
      await apiFetch(`/api/settings/channels/${active}/test`, {
        method: "POST",
      });
    });
  }

  async function copyText(value?: string) {
    if (!value) return;

    await navigator.clipboard.writeText(value);
  }

  return (
    <Panel title="Channels" icon={<MessageCircle size={18} />}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {[
            ["whatsapp", "WhatsApp"],
            ["calls", "Calls"],
            ["websiteChat", "Website Chat"],
            ["email", "Email"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActive(key as typeof active)}
              className={`rounded-full border px-4 py-2 text-sm ${
                active === key
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-white/[0.05] text-white/55 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xl font-semibold tracking-[-0.04em]">
                  {active === "whatsapp"
                    ? "Real WhatsApp Business"
                    : active === "calls"
                      ? "Realtime Call Setup"
                      : active === "websiteChat"
                        ? "Website Chat"
                        : "Email"}
                </p>

                <Badge tone={statusTone(active === "whatsapp" ? whatsappStatus : settings.status)}>
                  {active === "whatsapp" ? whatsappStatus : settings.status || "NOT_CONNECTED"}
                </Badge>

                {active === "whatsapp" ? (
                  <Badge>{whatsappProviderMode === "cloud" ? "CLOUD API" : "DEMO"}</Badge>
                ) : settings.mode ? (
                  <Badge>{settings.mode}</Badge>
                ) : null}
              </div>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/40">
                {active === "calls"
                  ? "Voice status is calculated from Twilio, OpenAI and your public webhook URL."
                  : active === "whatsapp"
                    ? "This is the real WhatsApp sender used by Inbox. If this is not connected, CRM replies will not pretend to send."
                    : active === "websiteChat"
                      ? "Website chat can be controlled from here."
                      : "Email setup can be controlled from here."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={testChannel}
                disabled={saving === `test-${active}` || saving === "test-whatsapp"}
                className="h-11 rounded-2xl border border-white/10 bg-white/[0.05] px-5 text-sm text-white/70 hover:text-white disabled:opacity-50"
              >
                {saving === `test-${active}` || saving === "test-whatsapp" ? "Testing..." : "Send test"}
              </button>

              {!isRuntimeChannel ? (
                <button
                  type="button"
                  onClick={saveChannel}
                  disabled={saving === `channel-${active}`}
                  className="h-11 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {saving === `channel-${active}` ? "Saving..." : "Save"}
                </button>
              ) : null}
            </div>
          </div>

          {active === "whatsapp" ? (
            <div className="mt-6 space-y-5">
              <div
                className={`rounded-[26px] border p-5 ${
                  isConnected
                    ? "border-emerald-500/20 bg-emerald-500/10"
                    : "border-amber-500/20 bg-amber-500/10"
                }`}
              >
                <div className="flex items-start gap-3">
                  {isConnected ? (
                    <CheckCircle2
                      size={20}
                      className="mt-0.5 shrink-0 text-emerald-100"
                    />
                  ) : (
                    <AlertTriangle
                      size={20}
                      className="mt-0.5 shrink-0 text-amber-100"
                    />
                  )}

                  <div>
                    <p className="text-sm font-semibold">
                      {isConnected
                        ? "Real WhatsApp sending is connected"
                        : "Real WhatsApp sending is not connected"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/55">
                      {isConnected
                        ? "Messages sent from Inbox will go to the customer’s real WhatsApp through Meta Cloud API."
                        : "Add your Meta Cloud API credentials below. Until this is connected, Inbox will block fake WhatsApp sending."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Field label="Business WhatsApp number">
                  <Input
                    value={businessWhatsappNumber}
                    onChange={setBusinessWhatsappNumber}
                    placeholder="+919586410399"
                  />
                </Field>

                <Field label="Provider mode">
                  <select
                    value={whatsappProviderMode}
                    onChange={(event) =>
                      setWhatsappProviderMode(event.target.value as "mock" | "cloud")
                    }
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  >
                    <option value="mock" className="bg-[#05070d]">
                      Demo / Not live
                    </option>
                    <option value="cloud" className="bg-[#05070d]">
                      Live Meta Cloud API
                    </option>
                  </select>
                </Field>

                <Field label="Phone Number ID">
                  <Input
                    value={whatsappPhoneNumberId}
                    onChange={setWhatsappPhoneNumberId}
                    placeholder="Meta phone_number_id"
                  />
                </Field>

                <Field label="WhatsApp Business Account ID">
                  <Input
                    value={whatsappBusinessAccountId}
                    onChange={setWhatsappBusinessAccountId}
                    placeholder="WABA ID"
                  />
                </Field>

                <Field label="Graph API version">
                  <Input
                    value={whatsappGraphApiVersion}
                    onChange={setWhatsappGraphApiVersion}
                    placeholder="v20.0"
                  />
                </Field>

                <Field label="Webhook verify token">
                  <Input
                    value={whatsappWebhookVerifyToken}
                    onChange={setWhatsappWebhookVerifyToken}
                    placeholder="airadesk_verify_token"
                  />
                </Field>

                <div className="xl:col-span-2">
                  <Field
                    label={
                      whatsappAccessTokenSet
                        ? `Access token currently saved: ${whatsappAccessTokenPreview}`
                        : "Access token"
                    }
                  >
                    <Input
                      type="password"
                      value={whatsappAccessToken}
                      onChange={setWhatsappAccessToken}
                      placeholder={
                        whatsappAccessTokenSet
                          ? "Paste new token only if you want to replace it"
                          : "Paste Meta access token"
                      }
                    />
                  </Field>
                </div>
              </div>

              <WebhookCopyBox
                label="Meta WhatsApp webhook URL"
                value={whatsappWebhookUrl || settings.webhookUrl}
                onCopy={copyText}
              />

              <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-5">
                <p className="text-sm font-semibold text-white/75">
                  How this becomes real
                </p>
                <p className="mt-2 text-sm leading-6 text-white/45">
                  Use the webhook URL above in Meta Developer Dashboard, subscribe to messages, then send a test message from this screen. After that, Inbox messages will go to the real customer WhatsApp number.
                </p>
              </div>

              <button
                type="button"
                onClick={saveWhatsAppIntegration}
                disabled={saving === "channel-whatsapp"}
                className="h-11 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
              >
                {saving === "channel-whatsapp" ? "Saving..." : "Save real WhatsApp connection"}
              </button>
            </div>
          ) : null}

          {active === "calls" ? (
            <div className="mt-6 space-y-5">
              <div
                className={`rounded-[26px] border p-5 ${
                  isConnected
                    ? "border-emerald-500/20 bg-emerald-500/10"
                    : "border-amber-500/20 bg-amber-500/10"
                }`}
              >
                <div className="flex items-start gap-3">
                  {isConnected ? (
                    <CheckCircle2
                      size={20}
                      className="mt-0.5 shrink-0 text-emerald-100"
                    />
                  ) : (
                    <AlertTriangle
                      size={20}
                      className="mt-0.5 shrink-0 text-amber-100"
                    />
                  )}

                  <div>
                    <p className="text-sm font-semibold">
                      {isConnected
                        ? "Twilio realtime voice is connected"
                        : "Twilio realtime voice is not fully connected"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/55">
                      {isConnected
                        ? "Calls can now enter your backend through Twilio Media Streams and OpenAI Realtime."
                        : "Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, OPENAI_API_KEY and PUBLIC_WEBHOOK_URL in backend .env."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <ReadOnlyInfo
                  label="Provider"
                  value={settings.provider || connection?.provider || "-"}
                />

                <ReadOnlyInfo
                  label="Business phone number"
                  value={settings.businessPhoneNumber || connection?.phoneNumber || "-"}
                />

                <ReadOnlyInfo
                  label="AI voice agent"
                  value={settings.aiVoiceAgent || "-"}
                />

                <ReadOnlyInfo
                  label="Realtime enabled"
                  value={settings.realtimeEnabled ? "Yes" : "No"}
                />

                <ReadOnlyInfo
                  label="Webhook status"
                  value={settings.webhookStatus || "-"}
                />

                <ReadOnlyInfo
                  label="Last checked"
                  value={formatDate(connection?.lastCheckedAt)}
                />
              </div>

              <div className="grid gap-4">
                <WebhookCopyBox
                  label="Twilio voice webhook URL"
                  value={settings.webhookUrl}
                  onCopy={copyText}
                />

                <WebhookCopyBox
                  label="Realtime WebSocket URL"
                  value={settings.websocketUrl}
                  onCopy={copyText}
                />
              </div>

              <button
                type="button"
                onClick={saveChannel}
                disabled={saving === `channel-${active}`}
                className="h-11 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
              >
                {saving === `channel-${active}` ? "Saving..." : "Save call preferences"}
              </button>
            </div>
          ) : null}

          {active === "websiteChat" ? (
            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <SwitchField
                label="Widget enabled"
                value={Boolean(settings.widgetEnabled)}
                onChange={(value) =>
                  setSettings({
                    ...settings,
                    widgetEnabled: value,
                  })
                }
              />

              <Field label="Greeting message">
                <Input
                  value={settings.greeting || ""}
                  onChange={(value) =>
                    setSettings({
                      ...settings,
                      greeting: value,
                    })
                  }
                />
              </Field>
            </div>
          ) : null}

          {active === "email" ? (
            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <Field label="From email">
                <Input
                  value={settings.fromEmail || ""}
                  onChange={(value) =>
                    setSettings({
                      ...settings,
                      fromEmail: value,
                    })
                  }
                />
              </Field>

              <Field label="Reply mode">
                <select
                  value={settings.replyMode || "DRAFT_ONLY"}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      replyMode: event.target.value,
                    })
                  }
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                >
                  <option value="AUTO_REPLY" className="bg-[#05070d]">
                    Auto reply
                  </option>
                  <option value="DRAFT_ONLY" className="bg-[#05070d]">
                    Draft only
                  </option>
                  <option value="HUMAN_APPROVAL" className="bg-[#05070d]">
                    Human approval required
                  </option>
                  <option value="OFF" className="bg-[#05070d]">
                    Off
                  </option>
                </select>
              </Field>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function ReadOnlyInfo({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 break-words text-sm font-medium text-white/70">
        {value || "-"}
      </p>
    </div>
  );
}

function WebhookCopyBox({
  label,
  value,
  onCopy,
}: {
  label: string;
  value?: string | null;
  onCopy: (value?: string) => void;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div className="min-w-0">
          <p className="text-xs text-white/35">{label}</p>
          <p className="mt-2 break-all font-mono text-xs leading-5 text-white/65">
            {value || "Not available"}
          </p>
        </div>

        <button
          type="button"
          disabled={!value}
          onClick={() => onCopy(value || "")}
          className="h-10 shrink-0 rounded-2xl border border-white/10 bg-black/25 px-4 text-xs text-white/60 hover:text-white disabled:opacity-40"
        >
          Copy
        </button>
      </div>
    </div>
  );
}

function CodeLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 break-all font-mono text-xs leading-5 text-white/65">
        {value}
      </p>
    </div>
  );
}

function AiSetupSection({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const [activeTab, setActiveTab] = useState<AiTab>("BEHAVIOR");

  return (
    <div className="space-y-5">
      <Panel title="AI Setup" icon={<Bot size={18} />}>
        <div className="flex flex-wrap gap-2">
          {aiTabs.map((tab) => (
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

        <p className="mt-4 text-sm leading-6 text-white/42">
          Set what the AI can say, what it can do, what it should never do, when
          it must hand off, and test answers before going live.
        </p>
      </Panel>

      {activeTab === "BEHAVIOR" ? (
        <AiBehaviorPanel data={data} saving={saving} onSave={onSave} />
      ) : null}

      {activeTab === "KNOWLEDGE" ? (
        <KnowledgeBaseManager data={data} saving={saving} onSave={onSave} />
      ) : null}

      {activeTab === "HANDOFF" ? (
        <HandoffRulesManager data={data} saving={saving} onSave={onSave} />
      ) : null}

      {activeTab === "TEST" ? (
        <TestAiPanel saving={saving} onSave={onSave} />
      ) : null}
    </div>
  );
}

function AiBehaviorPanel({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const settings = data.settings;

  const [aiName, setAiName] = useState(settings.aiName || "AI Assistant");
  const [aiTone, setAiTone] = useState(settings.aiTone || "Professional");
  const [aiReplyMode, setAiReplyMode] = useState(
    settings.aiReplyMode || "DRAFT_ONLY"
  );
  const [aiReplyLength, setAiReplyLength] = useState(
    settings.aiReplyLength || "MEDIUM"
  );
  const [aiConfidenceThreshold, setAiConfidenceThreshold] = useState(
    settings.aiConfidenceThreshold || 75
  );
  const [allowedActions, setAllowedActions] = useState(
    joinList(settings.aiAllowedActions) ||
      "Answer FAQs\nSend brochure\nBook meeting\nCreate lead\nCreate task\nCollect customer details\nTransfer to human"
  );
  const [restrictedActions, setRestrictedActions] = useState(
    joinList(settings.aiRestrictedActions) ||
      "Cannot give discount\nCannot confirm payment\nCannot make legal claims\nCannot give medical advice\nCannot promise delivery date"
  );
  const [fallbackResponse, setFallbackResponse] = useState(
    settings.aiFallbackResponse || "Let me connect you with a team member."
  );

  useEffect(() => {
    setAiName(settings.aiName || "AI Assistant");
    setAiTone(settings.aiTone || "Professional");
    setAiReplyMode(settings.aiReplyMode || "DRAFT_ONLY");
    setAiReplyLength(settings.aiReplyLength || "MEDIUM");
    setAiConfidenceThreshold(settings.aiConfidenceThreshold || 75);
    setAllowedActions(
      joinList(settings.aiAllowedActions) ||
        "Answer FAQs\nSend brochure\nBook meeting\nCreate lead\nCreate task\nCollect customer details\nTransfer to human"
    );
    setRestrictedActions(
      joinList(settings.aiRestrictedActions) ||
        "Cannot give discount\nCannot confirm payment\nCannot make legal claims\nCannot give medical advice\nCannot promise delivery date"
    );
    setFallbackResponse(
      settings.aiFallbackResponse || "Let me connect you with a team member."
    );
  }, [settings]);

  async function saveAi(event: FormEvent) {
    event.preventDefault();

    await onSave("ai", async () => {
      await apiFetch("/api/settings/ai-behavior", {
        method: "PATCH",
        body: JSON.stringify({
          aiName,
          aiTone,
          aiReplyMode,
          aiReplyLength,
          aiConfidenceThreshold,
          aiAllowedActions: splitList(allowedActions),
          aiRestrictedActions: splitList(restrictedActions),
          aiFallbackResponse: fallbackResponse || null,
        }),
      });
    });
  }

  return (
    <Panel title="AI Behavior" icon={<Bot size={18} />}>
      <form onSubmit={saveAi} className="space-y-6">
        <div className="rounded-[26px] border border-cyan-500/20 bg-cyan-500/10 p-5">
          <p className="text-sm font-semibold text-cyan-100">
            Current AI mode
          </p>
          <p className="mt-2 text-sm leading-6 text-cyan-100/70">
            {aiReplyMode === "AUTO_REPLY"
              ? "AI can reply directly to customers."
              : aiReplyMode === "DRAFT_ONLY"
                ? "AI creates draft replies but does not send automatically."
                : aiReplyMode === "HUMAN_APPROVAL"
                  ? "AI replies need human approval before sending."
                  : "AI replies are turned off."}
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Field label="AI name">
            <Input value={aiName} onChange={setAiName} />
          </Field>

          <Field label="AI tone">
            <Input
              value={aiTone}
              onChange={setAiTone}
              placeholder="Professional, friendly, premium..."
            />
          </Field>

          <Field label="AI reply mode">
            <select
              value={aiReplyMode}
              onChange={(event) => setAiReplyMode(event.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              <option value="AUTO_REPLY" className="bg-[#05070d]">
                Auto reply
              </option>
              <option value="DRAFT_ONLY" className="bg-[#05070d]">
                Draft only
              </option>
              <option value="HUMAN_APPROVAL" className="bg-[#05070d]">
                Human approval required
              </option>
              <option value="OFF" className="bg-[#05070d]">
                Off
              </option>
            </select>
          </Field>

          <Field label="Reply length">
            <select
              value={aiReplyLength}
              onChange={(event) => setAiReplyLength(event.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              <option value="SHORT" className="bg-[#05070d]">
                Short
              </option>
              <option value="MEDIUM" className="bg-[#05070d]">
                Medium
              </option>
              <option value="DETAILED" className="bg-[#05070d]">
                Detailed
              </option>
            </select>
          </Field>

          <Field label="Confidence threshold">
            <input
              type="number"
              min={1}
              max={100}
              value={aiConfidenceThreshold}
              onChange={(event) =>
                setAiConfidenceThreshold(Number(event.target.value))
              }
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            />
          </Field>

          <Field label="Fallback response">
            <Input value={fallbackResponse} onChange={setFallbackResponse} />
          </Field>

          <Field label="Allowed actions">
            <Textarea
              value={allowedActions}
              onChange={setAllowedActions}
              rows={8}
              placeholder="Answer FAQs&#10;Send brochure&#10;Book meeting"
            />
          </Field>

          <Field label="Restricted actions">
            <Textarea
              value={restrictedActions}
              onChange={setRestrictedActions}
              rows={8}
              placeholder="Cannot give discount&#10;Cannot confirm payment"
            />
          </Field>
        </div>

        <SaveButton saving={saving === "ai"} />
      </form>
    </Panel>
  );
}

function KnowledgeBaseManager({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("FAQ");
  const [content, setContent] = useState("");
  const [enabled, setEnabled] = useState(true);

  const filtered = useMemo(() => {
    const value = search.toLowerCase().trim();

    return data.knowledgeItems.filter((item) => {
      if (!value) return true;

      return `${item.title} ${item.category} ${item.content}`
        .toLowerCase()
        .includes(value);
    });
  }, [data.knowledgeItems, search]);

  function resetForm() {
    setEditing(null);
    setTitle("");
    setCategory("FAQ");
    setContent("");
    setEnabled(true);
  }

  function editItem(item: KnowledgeItem) {
    setEditing(item);
    setTitle(item.title);
    setCategory(item.category);
    setContent(item.content);
    setEnabled(item.enabled !== false && item.isActive !== false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();

    await onSave("knowledge", async () => {
      if (editing) {
        await apiFetch(`/api/settings/knowledge/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title,
            category,
            content,
            enabled,
          }),
        });
      } else {
        await apiFetch("/api/settings/knowledge", {
          method: "POST",
          body: JSON.stringify({
            title,
            category,
            content,
            enabled,
            sourceType: "MANUAL",
          }),
        });
      }

      resetForm();
    });
  }

  async function remove(item: KnowledgeItem) {
    if (!window.confirm(`Delete "${item.title}"?`)) return;

    await onSave("knowledge-delete", async () => {
      await apiFetch(`/api/settings/knowledge/${item.id}`, {
        method: "DELETE",
      });
    });
  }

  return (
    <Panel title="Knowledge Base" icon={<Database size={18} />}>
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={16} className="text-white/30" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search knowledge..."
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>

          <div className="space-y-3">
            {filtered.length === 0 ? (
              <EmptyBox text="No knowledge items found." />
            ) : (
              filtered.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[24px] border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{item.title}</p>
                        <Badge>{item.category}</Badge>
                        <Badge
                          tone={
                            item.enabled === false || item.isActive === false
                              ? "muted"
                              : "success"
                          }
                        >
                          {item.enabled === false || item.isActive === false
                            ? "Disabled"
                            : "Used by AI"}
                        </Badge>
                      </div>

                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/45">
                        {item.content}
                      </p>
                      <p className="mt-3 text-xs text-white/30">
                        Updated {formatDate(item.updatedAt)}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => editItem(item)}
                        className="rounded-xl border border-white/10 p-2 text-white/55 hover:text-white"
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(item)}
                        className="rounded-xl border border-red-500/20 p-2 text-red-100"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <form
          onSubmit={save}
          className="space-y-4 rounded-[26px] border border-white/10 bg-black/20 p-5"
        >
          <div>
            <p className="text-sm font-semibold text-white/75">
              {editing ? "Edit Knowledge" : "Add Knowledge"}
            </p>
            <p className="mt-1 text-sm leading-6 text-white/40">
              This is what AI will use to answer customers.
            </p>
          </div>

          <Field label="Title">
            <Input value={title} onChange={setTitle} />
          </Field>

          <Field label="Category">
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              {[
                "Services",
                "Pricing",
                "FAQ",
                "Policies",
                "Offers",
                "Products",
                "Business Info",
                "Objection Handling",
                "Handoff Rules",
              ].map((item) => (
                <option key={item} value={item} className="bg-[#05070d]">
                  {item}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Content">
            <Textarea value={content} onChange={setContent} rows={10} />
          </Field>

          <SwitchField label="Used by AI" value={enabled} onChange={setEnabled} />

          <div className="grid gap-2 md:grid-cols-[1fr_110px]">
            <button
              disabled={saving === "knowledge"}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:opacity-50"
            >
              {saving === "knowledge" ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              Save
            </button>

            <button
              type="button"
              onClick={resetForm}
              className="h-12 rounded-2xl border border-white/10 px-4 text-sm text-white/60 hover:text-white"
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </Panel>
  );
}

function HandoffRulesManager({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const [editing, setEditing] = useState<HandoffRule | null>(null);
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("");
  const [action, setAction] = useState("Handoff to manager");
  const [notificationChannel, setNotificationChannel] = useState(
    "Dashboard + WhatsApp"
  );
  const [priority, setPriority] = useState<
    "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  >("HIGH");
  const [isEnabled, setIsEnabled] = useState(true);

  function reset() {
    setEditing(null);
    setName("");
    setCondition("");
    setAction("Handoff to manager");
    setNotificationChannel("Dashboard + WhatsApp");
    setPriority("HIGH");
    setIsEnabled(true);
  }

  function edit(rule: HandoffRule) {
    setEditing(rule);
    setName(rule.name);
    setCondition(rule.condition);
    setAction(rule.action);
    setNotificationChannel(rule.notificationChannel || "Dashboard + WhatsApp");
    setPriority(rule.priority);
    setIsEnabled(rule.isEnabled);
  }

  async function save(event: FormEvent) {
    event.preventDefault();

    await onSave("handoff", async () => {
      const payload = {
        name,
        condition,
        action,
        notificationChannel,
        priority,
        isEnabled,
      };

      if (editing) {
        await apiFetch(`/api/settings/handoff-rules/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/api/settings/handoff-rules", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      reset();
    });
  }

  async function toggle(rule: HandoffRule) {
    await onSave("handoff-toggle", async () => {
      await apiFetch(`/api/settings/handoff-rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          isEnabled: !rule.isEnabled,
        }),
      });
    });
  }

  async function remove(rule: HandoffRule) {
    if (!window.confirm(`Delete "${rule.name}"?`)) return;

    await onSave("handoff-delete", async () => {
      await apiFetch(`/api/settings/handoff-rules/${rule.id}`, {
        method: "DELETE",
      });
    });
  }

  return (
    <Panel title="Structured Handoff Rules" icon={<AlertTriangle size={18} />}>
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="space-y-3">
          {data.handoffRules.length === 0 ? (
            <EmptyBox text="No handoff rules yet." />
          ) : (
            data.handoffRules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-[24px] border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{rule.name}</p>
                      <Badge tone={rule.isEnabled ? "success" : "muted"}>
                        {rule.isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                      <Badge tone={priorityTone(rule.priority)}>
                        {rule.priority}
                      </Badge>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-white/45">
                      <span className="text-white/70">If:</span>{" "}
                      {rule.condition}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-white/45">
                      <span className="text-white/70">Then:</span>{" "}
                      {rule.action}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-white/45">
                      <span className="text-white/70">Notify:</span>{" "}
                      {rule.notificationChannel || "Dashboard"}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => edit(rule)}
                      className="rounded-xl border border-white/10 p-2 text-white/55 hover:text-white"
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(rule)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:text-white"
                    >
                      {rule.isEnabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(rule)}
                      className="rounded-xl border border-red-500/20 p-2 text-red-100"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={save}
          className="space-y-4 rounded-[26px] border border-white/10 bg-black/20 p-5"
        >
          <p className="text-sm font-semibold text-white/75">
            {editing ? "Edit Rule" : "Add Rule"}
          </p>

          <Field label="Rule name">
            <Input
              value={name}
              onChange={setName}
              placeholder="Customer asks for refund"
            />
          </Field>

          <Field label="Condition">
            <Textarea
              value={condition}
              onChange={setCondition}
              rows={4}
              placeholder="Customer says refund, angry, emergency..."
            />
          </Field>

          <Field label="Action">
            <Input value={action} onChange={setAction} />
          </Field>

          <Field label="Notification channel">
            <Input
              value={notificationChannel}
              onChange={setNotificationChannel}
            />
          </Field>

          <Field label="Priority">
            <select
              value={priority}
              onChange={(event) =>
                setPriority(
                  event.target.value as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
                )
              }
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              <option value="CRITICAL" className="bg-[#05070d]">
                Critical
              </option>
              <option value="HIGH" className="bg-[#05070d]">
                High
              </option>
              <option value="MEDIUM" className="bg-[#05070d]">
                Medium
              </option>
              <option value="LOW" className="bg-[#05070d]">
                Low
              </option>
            </select>
          </Field>

          <SwitchField label="Enabled" value={isEnabled} onChange={setIsEnabled} />

          <div className="grid gap-2 md:grid-cols-[1fr_110px]">
            <button
              disabled={saving === "handoff"}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:opacity-50"
            >
              <Plus size={16} />
              {editing ? "Save Rule" : "Add Rule"}
            </button>

            <button
              type="button"
              onClick={reset}
              className="h-12 rounded-2xl border border-white/10 px-4 text-sm text-white/60 hover:text-white"
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </Panel>
  );
}

function TestAiPanel({
  saving,
  onSave,
}: {
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [matchedTitle, setMatchedTitle] = useState("");

  async function testAiAnswer(event: FormEvent) {
    event.preventDefault();

    if (!question.trim()) return;

    await onSave("test-ai", async () => {
      const response = await apiFetch<{
        answer: string;
        confidence: number;
        matchedItem: null | {
          id: string;
          title: string;
          category: string;
        };
      }>("/api/settings/knowledge/test-answer", {
        method: "POST",
        body: JSON.stringify({
          question,
        }),
      });

      setAnswer(response.answer);
      setConfidence(response.confidence);
      setMatchedTitle(response.matchedItem?.title || "");
    });
  }

  return (
    <Panel title="Test AI Answer" icon={<Bot size={18} />}>
      <form onSubmit={testAiAnswer} className="space-y-5">
        <div className="rounded-[26px] border border-cyan-500/20 bg-cyan-500/10 p-5">
          <p className="text-sm font-semibold text-cyan-100">
            Test before going live
          </p>
          <p className="mt-2 text-sm leading-6 text-cyan-100/70">
            Ask the AI a real customer question. If the answer is weak, add or
            improve knowledge before allowing auto-replies.
          </p>
        </div>

        <Field label="Customer question">
          <Textarea
            value={question}
            onChange={setQuestion}
            rows={4}
            placeholder="What is your consultation fee?"
          />
        </Field>

        <button
          disabled={saving === "test-ai" || !question.trim()}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
        >
          {saving === "test-ai" ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <Bot size={16} />
          )}
          Test AI Answer
        </button>

        {answer ? (
          <div className="rounded-[26px] border border-white/10 bg-black/20 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-white/75">AI Answer</p>
              {confidence !== null ? (
                <Badge tone={confidence >= 70 ? "success" : "warning"}>
                  Confidence {confidence}%
                </Badge>
              ) : null}
              {matchedTitle ? <Badge>Matched: {matchedTitle}</Badge> : null}
            </div>

            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-white/62">
              {answer}
            </p>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

function CrmWorkflowSection({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  return (
    <div className="space-y-5">
      <CrmStagesManager data={data} saving={saving} onSave={onSave} />
      <TaskWorkflowManager data={data} saving={saving} onSave={onSave} />
    </div>
  );
}

function CrmStagesManager({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const [editing, setEditing] = useState<CrmStage | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("cyan");
  const [order, setOrder] = useState(data.crmStages.length + 1);
  const [isEnabled, setIsEnabled] = useState(true);

  function reset() {
    setEditing(null);
    setName("");
    setColor("cyan");
    setOrder(data.crmStages.length + 1);
    setIsEnabled(true);
  }

  function edit(stage: CrmStage) {
    setEditing(stage);
    setName(stage.name);
    setColor(stage.color || "cyan");
    setOrder(stage.order);
    setIsEnabled(stage.isEnabled);
  }

  async function save(event: FormEvent) {
    event.preventDefault();

    await onSave("crm-stage", async () => {
      const payload = {
        name,
        color,
        order,
        isEnabled,
        requiredFields: editing?.requiredFields || [],
        automationRule: editing?.automationRule || {},
      };

      if (editing) {
        await apiFetch(`/api/settings/crm-stages/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/api/settings/crm-stages", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      reset();
    });
  }

  async function toggle(stage: CrmStage) {
    await onSave("crm-toggle", async () => {
      await apiFetch(`/api/settings/crm-stages/${stage.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          isEnabled: !stage.isEnabled,
        }),
      });
    });
  }

  async function remove(stage: CrmStage) {
    if (!window.confirm(`Delete stage "${stage.name}"?`)) return;

    await onSave("crm-delete", async () => {
      await apiFetch(`/api/settings/crm-stages/${stage.id}`, {
        method: "DELETE",
      });
    });
  }

  return (
    <Panel title="Pipeline Stages" icon={<Workflow size={18} />}>
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          {data.crmStages.map((stage) => (
            <div
              key={stage.id}
              className="rounded-[24px] border border-white/10 bg-black/20 p-4"
            >
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">
                      {stage.order}. {stage.name}
                    </p>
                    <Badge tone={stage.isEnabled ? "success" : "muted"}>
                      {stage.isEnabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <Badge>{stage.color || "default"}</Badge>
                  </div>

                  <p className="mt-2 text-sm text-white/40">
                    Required fields:{" "}
                    {Array.isArray(stage.requiredFields) &&
                    stage.requiredFields.length
                      ? stage.requiredFields.join(", ")
                      : "None"}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => edit(stage)}
                    className="rounded-xl border border-white/10 p-2 text-white/55 hover:text-white"
                  >
                    <Edit3 size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(stage)}
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:text-white"
                  >
                    {stage.isEnabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(stage)}
                    className="rounded-xl border border-red-500/20 p-2 text-red-100"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={save}
          className="space-y-4 rounded-[26px] border border-white/10 bg-black/20 p-5"
        >
          <p className="text-sm font-semibold text-white/75">
            {editing ? "Edit Stage" : "Add Stage"}
          </p>

          <Field label="Stage name">
            <Input value={name} onChange={setName} />
          </Field>

          <Field label="Color">
            <Input value={color} onChange={setColor} />
          </Field>

          <Field label="Order">
            <input
              type="number"
              value={order}
              onChange={(event) => setOrder(Number(event.target.value))}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            />
          </Field>

          <SwitchField label="Enabled" value={isEnabled} onChange={setIsEnabled} />

          <div className="grid gap-2 md:grid-cols-[1fr_110px]">
            <button
              disabled={saving === "crm-stage"}
              className="h-12 rounded-2xl bg-white text-sm font-semibold text-black disabled:opacity-50"
            >
              {editing ? "Save" : "Add"}
            </button>

            <button
              type="button"
              onClick={reset}
              className="h-12 rounded-2xl border border-white/10 px-4 text-sm text-white/60"
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </Panel>
  );
}

function TaskWorkflowManager({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const current = data.settings.taskWorkflowSettings || {};
  const [managerApprovalRequired, setManagerApprovalRequired] = useState(
    Boolean(current.managerApprovalRequired)
  );
  const [proofRequired, setProofRequired] = useState(
    Boolean(current.proofRequired)
  );
  const [overdueReminderHours, setOverdueReminderHours] = useState(
    current.overdueReminderHours || 24
  );
  const [employeeCanMarkBlocked, setEmployeeCanMarkBlocked] = useState(
    current.employeeCanMarkBlocked !== false
  );
  const [employeeCanCompleteTask, setEmployeeCanCompleteTask] = useState(
    current.employeeCanCompleteTask !== false
  );
  const [statuses, setStatuses] = useState(
    Array.isArray(current.statuses)
      ? current.statuses.join("\n")
      : "To Do\nIn Progress\nBlocked\nSubmitted\nCompleted\nNeeds Changes"
  );

  useEffect(() => {
    const next = data.settings.taskWorkflowSettings || {};
    setManagerApprovalRequired(Boolean(next.managerApprovalRequired));
    setProofRequired(Boolean(next.proofRequired));
    setOverdueReminderHours(next.overdueReminderHours || 24);
    setEmployeeCanMarkBlocked(next.employeeCanMarkBlocked !== false);
    setEmployeeCanCompleteTask(next.employeeCanCompleteTask !== false);
    setStatuses(
      Array.isArray(next.statuses)
        ? next.statuses.join("\n")
        : "To Do\nIn Progress\nBlocked\nSubmitted\nCompleted\nNeeds Changes"
    );
  }, [data.settings.taskWorkflowSettings]);

  async function save(event: FormEvent) {
    event.preventDefault();

    await onSave("task-workflow", async () => {
      await apiFetch("/api/settings/task-workflow", {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            managerApprovalRequired,
            proofRequired,
            overdueReminderHours,
            employeeCanMarkBlocked,
            employeeCanCompleteTask,
            statuses: splitList(statuses),
          },
        }),
      });
    });
  }

  return (
    <Panel title="Task Workflow Rules" icon={<CheckCircle2 size={18} />}>
      <form onSubmit={save} className="space-y-5">
        <div className="grid gap-4 xl:grid-cols-2">
          <SwitchField
            label="Manager approval required"
            value={managerApprovalRequired}
            onChange={setManagerApprovalRequired}
          />

          <SwitchField
            label="Proof required"
            value={proofRequired}
            onChange={setProofRequired}
          />

          <SwitchField
            label="Employee can mark blocked"
            value={employeeCanMarkBlocked}
            onChange={setEmployeeCanMarkBlocked}
          />

          <SwitchField
            label="Employee can complete task"
            value={employeeCanCompleteTask}
            onChange={setEmployeeCanCompleteTask}
          />

          <Field label="Overdue reminder hours">
            <input
              type="number"
              value={overdueReminderHours}
              onChange={(event) =>
                setOverdueReminderHours(Number(event.target.value))
              }
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            />
          </Field>

          <Field label="Task statuses">
            <Textarea value={statuses} onChange={setStatuses} rows={7} />
          </Field>
        </div>

        <SaveButton saving={saving === "task-workflow"} />
      </form>
    </Panel>
  );
}

function NotificationsSection({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const [editing, setEditing] = useState<NotificationRule | null>(null);
  const [name, setName] = useState("");
  const [event, setEvent] = useState("NEW_HOT_LEAD");
  const [recipients, setRecipients] = useState("Owner");
  const [channels, setChannels] = useState("In-app\nEmail");
  const [isEnabled, setIsEnabled] = useState(true);

  function reset() {
    setEditing(null);
    setName("");
    setEvent("NEW_HOT_LEAD");
    setRecipients("Owner");
    setChannels("In-app\nEmail");
    setIsEnabled(true);
  }

  function edit(rule: NotificationRule) {
    setEditing(rule);
    setName(rule.name);
    setEvent(rule.event);
    setRecipients(Array.isArray(rule.recipients) ? rule.recipients.join("\n") : "");
    setChannels(Array.isArray(rule.channels) ? rule.channels.join("\n") : "");
    setIsEnabled(rule.isEnabled);
  }

  async function save(eventObject: FormEvent) {
    eventObject.preventDefault();

    await onSave("notification", async () => {
      const payload = {
        name,
        event,
        recipients: splitList(recipients),
        channels: splitList(channels),
        isEnabled,
      };

      if (editing) {
        await apiFetch(`/api/settings/notification-rules/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/api/settings/notification-rules", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      reset();
    });
  }

  async function toggle(rule: NotificationRule) {
    await onSave("notification-toggle", async () => {
      await apiFetch(`/api/settings/notification-rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          isEnabled: !rule.isEnabled,
        }),
      });
    });
  }

  async function remove(rule: NotificationRule) {
    if (!window.confirm(`Delete "${rule.name}"?`)) return;

    await onSave("notification-delete", async () => {
      await apiFetch(`/api/settings/notification-rules/${rule.id}`, {
        method: "DELETE",
      });
    });
  }

  return (
    <Panel title="Notification Rules" icon={<Zap size={18} />}>
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          {data.notificationRules.length === 0 ? (
            <EmptyBox text="No notification rules yet." />
          ) : (
            data.notificationRules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-[24px] border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{rule.name}</p>
                      <Badge tone={rule.isEnabled ? "success" : "muted"}>
                        {rule.isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-white/40">
                      {labelFromEnum(rule.event)}
                    </p>
                    <p className="mt-1 text-sm text-white/40">
                      Channels: {(rule.channels || []).join(", ") || "None"}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => edit(rule)}
                      className="rounded-xl border border-white/10 p-2 text-white/55 hover:text-white"
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(rule)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:text-white"
                    >
                      {rule.isEnabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(rule)}
                      className="rounded-xl border border-red-500/20 p-2 text-red-100"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={save}
          className="space-y-4 rounded-[26px] border border-white/10 bg-black/20 p-5"
        >
          <p className="text-sm font-semibold text-white/75">
            {editing ? "Edit Alert Rule" : "Add Alert Rule"}
          </p>

          <Field label="Rule name">
            <Input
              value={name}
              onChange={setName}
              placeholder="Notify owner for hot leads"
            />
          </Field>

          <Field label="Event">
            <select
              value={event}
              onChange={(eventValue) => setEvent(eventValue.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              {[
                "NEW_HOT_LEAD",
                "HUMAN_HANDOFF",
                "MISSED_CALL",
                "MEETING_BOOKED",
                "FOLLOW_UP_OVERDUE",
                "TASK_DELAYED",
                "WORK_SUBMITTED",
                "PAYMENT_OVERDUE",
                "AI_FAILED",
              ].map((item) => (
                <option key={item} value={item} className="bg-[#05070d]">
                  {labelFromEnum(item)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Recipients">
            <Textarea value={recipients} onChange={setRecipients} rows={4} />
          </Field>

          <Field label="Channels">
            <Textarea value={channels} onChange={setChannels} rows={4} />
          </Field>

          <SwitchField label="Enabled" value={isEnabled} onChange={setIsEnabled} />

          <div className="grid gap-2 md:grid-cols-[1fr_110px]">
            <button className="h-12 rounded-2xl bg-white text-sm font-semibold text-black">
              {editing ? "Save Rule" : "Add Rule"}
            </button>

            <button
              type="button"
              onClick={reset}
              className="h-12 rounded-2xl border border-white/10 px-4 text-sm text-white/60"
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </Panel>
  );
}

function BillingSection({ data }: { data: SettingsResponse }) {
  return (
    <Panel title="Billing" icon={<CreditCard size={18} />}>
      <div className="rounded-[28px] border border-white/10 bg-black/20 p-6">
        <p className="text-2xl font-semibold tracking-[-0.04em]">
          {data.billing.plan}
        </p>

        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/45">
          {data.billing.message}
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <Metric label="AI messages" value={data.billing.usage.aiMessages} />
          <Metric label="Call minutes" value={data.billing.usage.callMinutes} />
          <Metric
            label="WhatsApp messages"
            value={data.billing.usage.whatsappMessages}
          />
          <Metric label="Team seats" value={data.billing.usage.teamSeats} />
        </div>

        <button className="mt-6 rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-3 text-sm text-white/70 hover:text-white">
          Contact Support
        </button>
      </div>
    </Panel>
  );
}

function SecuritySection({
  data,
  saving,
  onSave,
}: {
  data: SettingsResponse;
  saving: string;
  onSave: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const current = data.settings.securitySettings || {};
  const [twoFactorRequired, setTwoFactorRequired] = useState(
    Boolean(current.twoFactorRequired)
  );
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(
    current.sessionTimeoutMinutes || 1440
  );
  const [auditLogsEnabled, setAuditLogsEnabled] = useState(
    current.auditLogsEnabled !== false
  );
  const [dataRetentionDays, setDataRetentionDays] = useState(
    current.dataRetentionDays || 365
  );

  useEffect(() => {
    const next = data.settings.securitySettings || {};
    setTwoFactorRequired(Boolean(next.twoFactorRequired));
    setSessionTimeoutMinutes(next.sessionTimeoutMinutes || 1440);
    setAuditLogsEnabled(next.auditLogsEnabled !== false);
    setDataRetentionDays(next.dataRetentionDays || 365);
  }, [data.settings.securitySettings]);

  async function save(event: FormEvent) {
    event.preventDefault();

    await onSave("security", async () => {
      await apiFetch("/api/settings/security", {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            twoFactorRequired,
            sessionTimeoutMinutes,
            auditLogsEnabled,
            dataRetentionDays,
          },
        }),
      });
    });
  }

  return (
    <div className="space-y-5">
      <Panel title="Security Controls" icon={<Shield size={18} />}>
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-2">
            <SwitchField
              label="Require two-factor authentication"
              value={twoFactorRequired}
              onChange={setTwoFactorRequired}
            />

            <SwitchField
              label="Audit logs enabled"
              value={auditLogsEnabled}
              onChange={setAuditLogsEnabled}
            />

            <Field label="Session timeout minutes">
              <input
                type="number"
                value={sessionTimeoutMinutes}
                onChange={(event) =>
                  setSessionTimeoutMinutes(Number(event.target.value))
                }
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
              />
            </Field>

            <Field label="Data retention days">
              <input
                type="number"
                value={dataRetentionDays}
                onChange={(event) =>
                  setDataRetentionDays(Number(event.target.value))
                }
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
              />
            </Field>
          </div>

          <SaveButton saving={saving === "security"} />
        </form>
      </Panel>

      <Panel title="Audit Logs" icon={<KeyRound size={18} />}>
        <div className="space-y-3">
          {data.auditLogs.length === 0 ? (
            <EmptyBox text="No audit logs yet." />
          ) : (
            data.auditLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <p className="text-sm font-semibold">{log.message}</p>
                <p className="mt-1 text-xs text-white/35">
                  {log.action} · {log.entityType} · {formatDate(log.createdAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel title="Danger Zone" icon={<AlertTriangle size={18} />}>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
          <p className="text-sm font-semibold text-red-100">
            Delete workspace
          </p>
          <p className="mt-2 text-sm leading-6 text-red-100/65">
            This is disabled for safety. Contact support if a workspace needs to
            be permanently removed.
          </p>
        </div>
      </Panel>
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
    <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
      <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-white/70">
        {icon}
        {title}
      </div>

      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-white/48">{label}</span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25 disabled:opacity-45"
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 5,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full resize-y rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
    />
  );
}

function SwitchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-[56px] items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
      <span className="leading-5">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
        className="shrink-0"
      />
    </label>
  );
}

function SaveButton({ saving }: { saving: boolean }) {
  return (
    <button
      disabled={saving}
      className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
    >
      {saving ? (
        <Loader2 className="animate-spin" size={16} />
      ) : (
        <Save size={16} />
      )}
      Save Changes
    </button>
  );
}

function Badge({
  children,
  tone = "normal",
}: {
  children: ReactNode;
  tone?: string;
}) {
  const className =
    tone === "success"
      ? "bg-emerald-500/10 text-emerald-100"
      : tone === "danger"
        ? "bg-red-500/10 text-red-100"
        : tone === "warning"
          ? "bg-amber-500/10 text-amber-100"
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

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-sm text-white/40">
      {text}
    </div>
  );
}