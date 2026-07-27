import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Headphones,
  MessageCircle,
  Pause,
  Phone,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  TestTube2,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type Channel = "AI_CALL" | "WHATSAPP" | "WEBSITE_CHAT";
type AgentStatus = "LIVE" | "TESTING" | "PAUSED" | "NOT_CONNECTED";

type AiAgent = {
  id: string;
  companyId: string;
  name: string;
  channel: Channel;
  status: AgentStatus;
  language?: string | null;
  instructions?: string | null;
  createdAt: string;
  updatedAt: string;
};

type AgentsResponse = {
  agents: AiAgent[];
};

type AgentResponse = {
  message: string;
  agent: AiAgent;
};

const channels: { label: string; value: Channel }[] = [
  { label: "AI Call", value: "AI_CALL" },
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "Website Chat", value: "WEBSITE_CHAT" },
];

const statuses: { label: string; value: AgentStatus }[] = [
  { label: "Live", value: "LIVE" },
  { label: "Testing", value: "TESTING" },
  { label: "Paused", value: "PAUSED" },
  { label: "Not Connected", value: "NOT_CONNECTED" },
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AiAgent | null>(null);

  const [name, setName] = useState("WhatsApp Sales Agent");
  const [channel, setChannel] = useState<Channel>("WHATSAPP");
  const [status, setStatus] = useState<AgentStatus>("TESTING");
  const [language, setLanguage] = useState("en-IN");
  const [instructions, setInstructions] = useState(
    "Handle customer enquiries, ask one question at a time, qualify the lead, create a task when human follow-up is needed, and never promise anything outside company rules."
  );

  const [editName, setEditName] = useState("");
  const [editChannel, setEditChannel] = useState<Channel>("WHATSAPP");
  const [editStatus, setEditStatus] = useState<AgentStatus>("TESTING");
  const [editLanguage, setEditLanguage] = useState("en-IN");
  const [editInstructions, setEditInstructions] = useState("");

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadAgents(nextSelectedId?: string) {
    try {
      setError("");
      setLoading(true);

      const data = await apiFetch<AgentsResponse>("/api/agents");

      setAgents(data.agents);

      const nextAgent =
        data.agents.find((agent) => agent.id === nextSelectedId) ||
        data.agents.find((agent) => agent.id === selectedAgent?.id) ||
        data.agents[0] ||
        null;

      setSelectedAgent(nextAgent);
      syncEditForm(nextAgent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }

  function syncEditForm(agent: AiAgent | null) {
    if (!agent) {
      setEditName("");
      setEditChannel("WHATSAPP");
      setEditStatus("TESTING");
      setEditLanguage("en-IN");
      setEditInstructions("");
      return;
    }

    setEditName(agent.name);
    setEditChannel(agent.channel);
    setEditStatus(agent.status);
    setEditLanguage(agent.language || "en-IN");
    setEditInstructions(agent.instructions || "");
  }

  async function createAgent(event: FormEvent) {
    event.preventDefault();

    if (!name.trim()) return;

    try {
      setCreating(true);
      setError("");
      setMessage("");

      const data = await apiFetch<AgentResponse>("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          channel,
          status,
          language: language.trim() || "en-IN",
          instructions: instructions.trim() || undefined,
        }),
      });

      setMessage("Agent created successfully.");
      await loadAgents(data.agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  }

  async function saveAgent(event?: FormEvent) {
    event?.preventDefault();

    if (!selectedAgent || !editName.trim()) return;

    try {
      setSaving(true);
      setError("");
      setMessage("");

      const data = await apiFetch<AgentResponse>(`/api/agents/${selectedAgent.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          channel: editChannel,
          status: editStatus,
          language: editLanguage.trim() || "en-IN",
          instructions: editInstructions.trim() || undefined,
        }),
      });

      setMessage("Agent updated successfully.");
      await loadAgents(data.agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent");
    } finally {
      setSaving(false);
    }
  }

  async function quickStatus(agent: AiAgent, nextStatus: AgentStatus) {
    try {
      setError("");
      setMessage("");

      const data = await apiFetch<AgentResponse>(`/api/agents/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: nextStatus,
        }),
      });

      setMessage(`Agent status changed to ${formatEnum(nextStatus)}.`);
      await loadAgents(data.agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  }

  function selectAgent(agent: AiAgent) {
    setSelectedAgent(agent);
    syncEditForm(agent);
  }

  useEffect(() => {
    loadAgents();
  }, []);

  const stats = useMemo(() => {
    return {
      total: agents.length,
      live: agents.filter((agent) => agent.status === "LIVE").length,
      testing: agents.filter((agent) => agent.status === "TESTING").length,
      paused: agents.filter((agent) => agent.status === "PAUSED").length,
    };
  }, [agents]);

  if (loading) {
    return (
      <section className="flex min-h-[calc(100vh-120px)] items-center justify-center">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-6 py-5 text-sm text-white/60">
          Loading AI agents...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6 md:p-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-white/55">
              <Sparkles size={14} />
              AI CEO Operators
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
              Control the agents that run calls, WhatsApp and chat.
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-6 text-white/50 md:text-base md:leading-7">
              This is where a client controls their AI operators: channel,
              status, language and instructions. Next we will connect these
              settings directly into the AI decision engine.
            </p>
          </div>

          <button
            onClick={() => loadAgents()}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 py-3 text-sm text-white/70 hover:text-white"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {message}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)_420px]">
        <aside className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={<Bot size={18} />} label="Total" value={stats.total} />
            <StatCard icon={<CheckCircle2 size={18} />} label="Live" value={stats.live} />
            <StatCard icon={<TestTube2 size={18} />} label="Testing" value={stats.testing} />
            <StatCard icon={<Pause size={18} />} label="Paused" value={stats.paused} />
          </div>

          <form
            onSubmit={createAgent}
            className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5"
          >
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-black">
                <Plus size={19} />
              </div>

              <div>
                <h2 className="text-lg font-semibold tracking-[-0.03em]">
                  Create agent
                </h2>
                <p className="mt-1 text-sm leading-5 text-white/40">
                  Add a new AI operator for a channel.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <Field label="Agent name">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  placeholder="WhatsApp Sales Agent"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Channel">
                  <select
                    value={channel}
                    onChange={(event) => setChannel(event.target.value as Channel)}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  >
                    {channels.map((item) => (
                      <option key={item.value} value={item.value} className="bg-[#05070d]">
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Status">
                  <select
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as AgentStatus)
                    }
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  >
                    {statuses.map((item) => (
                      <option key={item.value} value={item.value} className="bg-[#05070d]">
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Language">
                <input
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  placeholder="en-IN"
                />
              </Field>

              <Field label="Instructions">
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  className="min-h-36 w-full resize-none rounded-3xl border border-white/10 bg-black/25 px-5 py-4 text-sm leading-7 outline-none placeholder:text-white/25"
                  placeholder="Tell this agent what it should do."
                />
              </Field>

              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={16} />
                {creating ? "Creating..." : "Create agent"}
              </button>
            </div>
          </form>
        </aside>

        <main className="min-h-[680px] overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
          <div className="border-b border-white/10 p-5">
            <h2 className="text-2xl font-semibold tracking-[-0.04em]">
              Agent fleet
            </h2>
            <p className="mt-1 text-sm text-white/40">
              Live records from PostgreSQL.
            </p>
          </div>

          <div className="max-h-[720px] overflow-y-auto p-4">
            {agents.length === 0 ? (
              <div className="flex min-h-[460px] flex-col items-center justify-center px-8 text-center">
                <Bot size={34} className="text-white/35" />
                <h3 className="mt-5 text-xl font-semibold">No agents yet</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-white/40">
                  Create your WhatsApp, call or website chat agent. The next
                  upgrade will connect these agent rules to the AI brain.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => selectAgent(agent)}
                    className={`w-full rounded-3xl border p-4 text-left transition ${
                      selectedAgent?.id === agent.id
                        ? "border-white/20 bg-white/[0.08]"
                        : "border-white/10 bg-black/15 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <ChannelBadge channel={agent.channel} />
                          <StatusBadge status={agent.status} />
                        </div>

                        <h3 className="mt-4 text-lg font-semibold">
                          {agent.name}
                        </h3>

                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/45">
                          {agent.instructions || "No instructions added yet."}
                        </p>
                      </div>

                      <AgentIcon channel={agent.channel} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <MiniPill label="Language" value={agent.language || "en-IN"} />
                      <MiniPill label="Updated" value={formatDate(agent.updatedAt)} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>

        <aside className="space-y-5">
          <form
            onSubmit={saveAgent}
            className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5"
          >
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-black">
                <Save size={19} />
              </div>

              <div>
                <h2 className="text-lg font-semibold tracking-[-0.03em]">
                  Edit selected agent
                </h2>
                <p className="mt-1 text-sm leading-5 text-white/40">
                  Update status and instructions.
                </p>
              </div>
            </div>

            {!selectedAgent ? (
              <div className="rounded-3xl border border-white/10 bg-black/25 p-5 text-sm leading-6 text-white/45">
                Select or create an agent first.
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="Agent name">
                  <input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Channel">
                    <select
                      value={editChannel}
                      onChange={(event) =>
                        setEditChannel(event.target.value as Channel)
                      }
                      className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                    >
                      {channels.map((item) => (
                        <option key={item.value} value={item.value} className="bg-[#05070d]">
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Status">
                    <select
                      value={editStatus}
                      onChange={(event) =>
                        setEditStatus(event.target.value as AgentStatus)
                      }
                      className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                    >
                      {statuses.map((item) => (
                        <option key={item.value} value={item.value} className="bg-[#05070d]">
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Language">
                  <input
                    value={editLanguage}
                    onChange={(event) => setEditLanguage(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  />
                </Field>

                <Field label="Instructions">
                  <textarea
                    value={editInstructions}
                    onChange={(event) => setEditInstructions(event.target.value)}
                    className="min-h-44 w-full resize-none rounded-3xl border border-white/10 bg-black/25 px-5 py-4 text-sm leading-7 outline-none placeholder:text-white/25"
                  />
                </Field>

                <button
                  type="submit"
                  disabled={saving || !editName.trim()}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save size={16} />
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            )}
          </form>

          {selectedAgent ? (
            <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-5 flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-black">
                  <ShieldCheck size={19} />
                </div>

                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.03em]">
                    Quick controls
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-white/40">
                    Change operating mode instantly.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => quickStatus(selectedAgent, "LIVE")}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500/15 text-sm font-medium text-emerald-100 hover:bg-emerald-500/20"
                >
                  <CheckCircle2 size={16} />
                  Make live
                </button>

                <button
                  onClick={() => quickStatus(selectedAgent, "TESTING")}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500/15 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20"
                >
                  <TestTube2 size={16} />
                  Testing mode
                </button>

                <button
                  onClick={() => quickStatus(selectedAgent, "PAUSED")}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-orange-500/15 text-sm font-medium text-orange-100 hover:bg-orange-500/20"
                >
                  <Pause size={16} />
                  Pause agent
                </button>
              </div>

              <div className="mt-5 rounded-3xl border border-white/10 bg-black/25 p-4">
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <AlertTriangle size={16} />
                  Startup note
                </div>
                <p className="mt-2 text-sm leading-6 text-white/42">
                  Status is saved in the database. In the next step, the webhook
                  AI brain will check these agents before replying to customers.
                </p>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-white/50">{label}</span>
      {children}
    </label>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-white/40">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function AgentIcon({ channel }: { channel: Channel }) {
  const className =
    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-black";

  if (channel === "AI_CALL") {
    return (
      <div className={className}>
        <Phone size={20} />
      </div>
    );
  }

  if (channel === "WHATSAPP") {
    return (
      <div className={className}>
        <MessageCircle size={20} />
      </div>
    );
  }

  return (
    <div className={className}>
      <Headphones size={20} />
    </div>
  );
}

function ChannelBadge({ channel }: { channel: Channel }) {
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

function StatusBadge({ status }: { status: AgentStatus }) {
  const icon =
    status === "LIVE" ? (
      <CheckCircle2 size={13} />
    ) : status === "TESTING" ? (
      <TestTube2 size={13} />
    ) : status === "PAUSED" ? (
      <Pause size={13} />
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

function MiniPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] text-white/40">
      {label}: <span className="text-white/65">{value}</span>
    </span>
  );
}

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => {
    return char.toUpperCase();
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}