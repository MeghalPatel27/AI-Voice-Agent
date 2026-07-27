import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  UserMinus,
  UserPlus,
  UserRound,
  UsersRound,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type Role = "OWNER" | "ADMIN" | "STAFF";

type TaskPreview = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueAt?: string | null;
  delayed: boolean;
  delayLabel: string;
  customerName: string;
  taskType: string;
  source: string;
  blockedReason?: string | null;
  aiNotes: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

type TeamMember = {
  id: string;
  name: string;
  email: string | null;
  role: Role | string;
  isActive: boolean;
  deactivatedAt?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  workloadCapacity: number;
  type: "USER" | "UNASSIGNED" | "MANUAL";

  status: string;
  statusTone: string;
  needsAttention: boolean;
  workloadPercent: number;
  workloadLabel: string;

  score: number | null;
  scoreLabel: string;
  scoreReason: string;

  activeTasks: number;
  completedTasks: number;
  delayedTasks: number;
  blockedTasks: number;
  criticalTasks: number;
  totalTasks: number;

  reasons: string[];

  activeTaskList: TaskPreview[];
  delayedTaskList: TaskPreview[];
  blockedTaskList: TaskPreview[];
  completedTaskList: TaskPreview[];

  lastActiveAt?: string | null;
};

type BasicMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
};

type AttentionItem = {
  id: string;
  name: string;
  status: string;
  reason: string;
  workloadPercent: number;
  activeTasks: number;
  delayedTasks: number;
  blockedTasks: number;
  criticalTasks: number;
};

type TeamResponse = {
  summary: {
    totalMembers: number;
    activeMembers: number;
    inactiveMembers: number;
    overloaded: number;
    needsAttention: number;
    noWork: number;
    unassignedTasks: number;
  };
  members: TeamMember[];
  attentionQueue: AttentionItem[];
  teamMembers: BasicMember[];
  modules: {
    deactivateEnabled: boolean;
    permissionsEnabled: boolean;
    attendanceEnabled: boolean;
  };
};

type TeamFilter =
  | "ALL"
  | "ACTIVE"
  | "INACTIVE"
  | "NEEDS_ATTENTION"
  | "OVERLOADED"
  | "NO_WORK";

const filters: {
  label: string;
  value: TeamFilter;
}[] = [
  { label: "All", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Inactive", value: "INACTIVE" },
  { label: "Needs Attention", value: "NEEDS_ATTENTION" },
  { label: "Overloaded", value: "OVERLOADED" },
  { label: "No Work", value: "NO_WORK" },
];

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value?: string | null) {
  if (!value) return "No deadline";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getToneClass(tone: string) {
  if (tone === "danger") return "border-red-500/20 bg-red-500/10 text-red-100";
  if (tone === "warning")
    return "border-amber-500/20 bg-amber-500/10 text-amber-100";
  if (tone === "success")
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
  if (tone === "info")
    return "border-cyan-500/20 bg-cyan-500/10 text-cyan-100";
  if (tone === "muted") return "border-white/10 bg-white/[0.04] text-white/35";

  return "border-white/10 bg-white/[0.06] text-white/60";
}

function priorityTone(priority: string) {
  if (priority === "CRITICAL") return "danger";
  if (priority === "HIGH") return "warning";
  if (priority === "MEDIUM") return "info";
  return "normal";
}

export default function TeamPage() {
  const navigate = useNavigate();

  const [filter, setFilter] = useState<TeamFilter>("ALL");
  const [search, setSearch] = useState("");

  const [summary, setSummary] = useState<TeamResponse["summary"]>({
    totalMembers: 0,
    activeMembers: 0,
    inactiveMembers: 0,
    overloaded: 0,
    needsAttention: 0,
    noWork: 0,
    unassignedTasks: 0,
  });

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [attentionQueue, setAttentionQueue] = useState<AttentionItem[]>([]);
  const [teamMembers, setTeamMembers] = useState<BasicMember[]>([]);

  const [selectedId, setSelectedId] = useState("");
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);

  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("STAFF");
  const [inviteDepartment, setInviteDepartment] = useState("");
  const [inviteJobTitle, setInviteJobTitle] = useState("");
  const [inviteCapacity, setInviteCapacity] = useState(8);

  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<Role>("STAFF");
  const [editDepartment, setEditDepartment] = useState("");
  const [editJobTitle, setEditJobTitle] = useState("");
  const [editCapacity, setEditCapacity] = useState(8);

  const [deactivateStrategy, setDeactivateStrategy] =
    useState<"MOVE_TO_UNASSIGNED" | "REASSIGN" | "KEEP_ASSIGNED">(
      "MOVE_TO_UNASSIGNED"
    );
  const [reassignToUserId, setReassignToUserId] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function syncEditForm(member: TeamMember | null) {
    if (!member || member.type !== "USER") return;

    setEditName(member.name);
    setEditRole(member.role as Role);
    setEditDepartment(member.department || "");
    setEditJobTitle(member.jobTitle || "");
    setEditCapacity(member.workloadCapacity || 8);
  }

  async function loadTeam(nextSelectedId?: string) {
    try {
      setError("");
      setLoading(true);

      const data = await apiFetch<TeamResponse>("/api/team/overview");

      setSummary(data.summary);
      setMembers(data.members);
      setAttentionQueue(data.attentionQueue);
      setTeamMembers(data.teamMembers);

      const nextId =
        nextSelectedId ||
        selectedId ||
        data.members.find((member) => member.type === "USER" && member.isActive)
          ?.id ||
        data.members[0]?.id ||
        "";

      setSelectedId(nextId);

      const found = data.members.find((member) => member.id === nextId) || null;
      setSelectedMember(found);
      syncEditForm(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  function selectMember(member: TeamMember) {
    setSelectedId(member.id);
    setSelectedMember(member);
    syncEditForm(member);
  }

  async function inviteMember(event: FormEvent) {
    event.preventDefault();

    try {
      setSaving("invite");
      setError("");
      setNotice("");

      await apiFetch("/api/team/invite", {
        method: "POST",
        body: JSON.stringify({
          name: inviteName,
          email: inviteEmail,
          password: invitePassword,
          role: inviteRole,
          department: inviteDepartment || null,
          jobTitle: inviteJobTitle || null,
          workloadCapacity: inviteCapacity,
        }),
      });

      setInviteName("");
      setInviteEmail("");
      setInvitePassword("");
      setInviteRole("STAFF");
      setInviteDepartment("");
      setInviteJobTitle("");
      setInviteCapacity(8);
      setShowInvite(false);
      setNotice("Team member invited");

      await loadTeam();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite member");
    } finally {
      setSaving("");
    }
  }

  async function saveMember(event: FormEvent) {
    event.preventDefault();

    if (!selectedMember || selectedMember.type !== "USER") return;

    try {
      setSaving("profile");
      setError("");
      setNotice("");

      await apiFetch(`/api/team/members/${selectedMember.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName,
          role: editRole,
          department: editDepartment || null,
          jobTitle: editJobTitle || null,
          workloadCapacity: editCapacity,
        }),
      });

      setNotice("Member updated");
      await loadTeam(selectedMember.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update member");
    } finally {
      setSaving("");
    }
  }

  async function deactivateMember(event: FormEvent) {
    event.preventDefault();

    if (!selectedMember || selectedMember.type !== "USER") return;

    try {
      setSaving("deactivate");
      setError("");
      setNotice("");

      await apiFetch(`/api/team/members/${selectedMember.id}/deactivate`, {
        method: "POST",
        body: JSON.stringify({
          taskStrategy: deactivateStrategy,
          reassignToUserId:
            deactivateStrategy === "REASSIGN" ? reassignToUserId : null,
        }),
      });

      setShowDeactivate(false);
      setDeactivateStrategy("MOVE_TO_UNASSIGNED");
      setReassignToUserId("");
      setNotice("Member deactivated");

      await loadTeam(selectedMember.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to deactivate member"
      );
    } finally {
      setSaving("");
    }
  }

  async function reactivateMember() {
    if (!selectedMember || selectedMember.type !== "USER") return;

    try {
      setSaving("reactivate");
      setError("");
      setNotice("");

      await apiFetch(`/api/team/members/${selectedMember.id}/reactivate`, {
        method: "POST",
      });

      setNotice("Member reactivated");
      await loadTeam(selectedMember.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reactivate member"
      );
    } finally {
      setSaving("");
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setError("");
        const data = await apiFetch<TeamResponse>("/api/team/overview");
        if (cancelled) return;

        setSummary(data.summary);
        setMembers(data.members);
        setAttentionQueue(data.attentionQueue);
        setTeamMembers(data.teamMembers);

        const nextId =
          data.members.find((member) => member.type === "USER" && member.isActive)
            ?.id ||
          data.members[0]?.id ||
          "";

        setSelectedId(nextId);

        const found = data.members.find((member) => member.id === nextId) || null;
        setSelectedMember(found);
        syncEditForm(found);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load team");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      if (filter === "ACTIVE" && (!member.isActive || member.type !== "USER")) {
        return false;
      }

      if (filter === "INACTIVE" && member.isActive) return false;

      if (filter === "NEEDS_ATTENTION" && !member.needsAttention) return false;

      if (filter === "OVERLOADED" && member.workloadPercent < 120) return false;

      if (
        filter === "NO_WORK" &&
        !(member.type === "USER" && member.isActive && member.totalTasks === 0)
      ) {
        return false;
      }

      if (search.trim()) {
        const value = search.toLowerCase();
        const haystack = `${member.name} ${member.email || ""} ${
          member.role
        } ${member.department || ""} ${member.jobTitle || ""}`.toLowerCase();

        if (!haystack.includes(value)) return false;
      }

      return true;
    });
  }, [members, filter, search]);

  const activeReassignOptions = teamMembers.filter(
    (member) => member.isActive && member.id !== selectedMember?.id
  );

  if (loading) {
    return (
      <section className="flex min-h-[calc(100vh-150px)] items-center justify-center">
        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/50">
          <Loader2 className="animate-spin" size={18} />
          Loading team management...
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
              <UsersRound size={14} />
              People Management
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
              Team
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
              Manage staff, roles, departments, capacity, active/inactive status
              and people-level performance.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowInvite((value) => !value)}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black"
            >
              <UserPlus size={16} />
              Invite Member
            </button>

            <button
              onClick={() => loadTeam()}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 hover:text-white"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          <SummaryCard label="Total" value={summary.totalMembers} />
          <SummaryCard label="Active" value={summary.activeMembers} tone="success" />
          <SummaryCard
            label="Inactive"
            value={summary.inactiveMembers}
            tone={summary.inactiveMembers > 0 ? "muted" : "normal"}
          />
          <SummaryCard
            label="Overloaded"
            value={summary.overloaded}
            tone={summary.overloaded > 0 ? "danger" : "normal"}
          />
          <SummaryCard
            label="Needs Attention"
            value={summary.needsAttention}
            tone={summary.needsAttention > 0 ? "warning" : "normal"}
          />
          <SummaryCard
            label="No Work"
            value={summary.noWork}
            tone={summary.noWork > 0 ? "warning" : "normal"}
          />
          <SummaryCard
            label="Unassigned Work"
            value={summary.unassignedTasks}
            tone={summary.unassignedTasks > 0 ? "danger" : "normal"}
          />
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

      {showInvite ? (
        <InviteMemberForm
          name={inviteName}
          email={inviteEmail}
          password={invitePassword}
          role={inviteRole}
          department={inviteDepartment}
          jobTitle={inviteJobTitle}
          capacity={inviteCapacity}
          setName={setInviteName}
          setEmail={setInviteEmail}
          setPassword={setInvitePassword}
          setRole={setInviteRole}
          setDepartment={setInviteDepartment}
          setJobTitle={setInviteJobTitle}
          setCapacity={setInviteCapacity}
          saving={saving === "invite"}
          onSubmit={inviteMember}
        />
      ) : null}

      <section className="rounded-[34px] border border-amber-500/20 bg-amber-500/10 p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
          <AlertTriangle size={18} />
          People Attention Queue
        </div>

        <p className="mt-2 text-sm text-amber-100/65">
          This is people-level risk: overloaded staff, delayed staff, inactive
          work ownership and unassigned work.
        </p>

        <div className="mt-5 grid gap-3 xl:grid-cols-4">
          {attentionQueue.length === 0 ? (
            <div className="rounded-[26px] border border-amber-500/20 bg-black/20 p-5 text-sm text-amber-100/65 xl:col-span-4">
              No people issue right now.
            </div>
          ) : (
            attentionQueue.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  const member = members.find((next) => next.id === item.id);
                  if (member) selectMember(member);
                }}
                className="rounded-[26px] border border-amber-500/20 bg-black/20 p-4 text-left transition hover:bg-black/30"
              >
                <p className="font-semibold text-amber-50">{item.name}</p>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-amber-100/70">
                  {item.reason}
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <MiniStat label="Workload" value={`${item.workloadPercent}%`} />
                  <MiniStat label="Delayed" value={item.delayedTasks} />
                  <MiniStat label="Blocked" value={item.blockedTasks} />
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
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

          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 xl:w-[420px]">
            <Search size={17} className="text-white/30" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employee, role, department..."
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
        <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em]">
                Team Members
              </h2>
              <p className="mt-1 text-sm text-white/40">
                People, roles, departments, capacity and activity.
              </p>
            </div>

            <p className="text-sm text-white/35">
              {filteredMembers.length} member
              {filteredMembers.length === 1 ? "" : "s"}
            </p>
          </div>

          {filteredMembers.length === 0 ? (
            <EmptyState
              icon={<UsersRound size={34} />}
              title="No team members found"
              description="Invite members to start managing your team."
            />
          ) : (
            <div className="space-y-3">
              {filteredMembers.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  active={selectedId === member.id}
                  onClick={() => selectMember(member)}
                />
              ))}
            </div>
          )}
        </section>

        <MemberDetailPanel
          member={selectedMember}
          saving={saving}
          editName={editName}
          setEditName={setEditName}
          editRole={editRole}
          setEditRole={setEditRole}
          editDepartment={editDepartment}
          setEditDepartment={setEditDepartment}
          editJobTitle={editJobTitle}
          setEditJobTitle={setEditJobTitle}
          editCapacity={editCapacity}
          setEditCapacity={setEditCapacity}
          onSave={saveMember}
          onDeactivate={() => setShowDeactivate(true)}
          onReactivate={reactivateMember}
          onViewTasks={() => {
            if (selectedMember?.type === "USER") {
              navigate(`/tasks?assignee=${selectedMember.id}`);
            } else {
              navigate("/tasks?assignee=UNASSIGNED");
            }
          }}
        />
      </div>

      {showDeactivate && selectedMember ? (
        <DeactivateBox
          member={selectedMember}
          strategy={deactivateStrategy}
          reassignToUserId={reassignToUserId}
          members={activeReassignOptions}
          saving={saving === "deactivate"}
          setStrategy={setDeactivateStrategy}
          setReassignToUserId={setReassignToUserId}
          onSubmit={deactivateMember}
          onCancel={() => setShowDeactivate(false)}
        />
      ) : null}
    </section>
  );
}

function InviteMemberForm(props: {
  name: string;
  email: string;
  password: string;
  role: Role;
  department: string;
  jobTitle: string;
  capacity: number;
  setName: (value: string) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setRole: (value: Role) => void;
  setDepartment: (value: string) => void;
  setJobTitle: (value: string) => void;
  setCapacity: (value: number) => void;
  saving: boolean;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={props.onSubmit}
      className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
        <UserPlus size={18} />
        Invite Member
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-4">
        <Field label="Name">
          <Input value={props.name} onChange={props.setName} />
        </Field>

        <Field label="Email">
          <Input value={props.email} onChange={props.setEmail} />
        </Field>

        <Field label="Temporary password">
          <Input
            type="password"
            value={props.password}
            onChange={props.setPassword}
          />
        </Field>

        <Field label="Role">
          <select
            value={props.role}
            onChange={(event) => props.setRole(event.target.value as Role)}
            className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          >
            <option value="STAFF" className="bg-[#05070d]">
              Staff
            </option>
            <option value="ADMIN" className="bg-[#05070d]">
              Admin
            </option>
            <option value="OWNER" className="bg-[#05070d]">
              Owner
            </option>
          </select>
        </Field>

        <Field label="Department">
          <Input
            value={props.department}
            onChange={props.setDepartment}
            placeholder="Sales, Reception, Support..."
          />
        </Field>

        <Field label="Job title">
          <Input
            value={props.jobTitle}
            onChange={props.setJobTitle}
            placeholder="Receptionist, Manager..."
          />
        </Field>

        <Field label="Workload capacity">
          <input
            type="number"
            min={1}
            max={50}
            value={props.capacity}
            onChange={(event) => props.setCapacity(Number(event.target.value))}
            className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          />
        </Field>
      </div>

      <button
        disabled={props.saving}
        className="mt-5 flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
      >
        {props.saving ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <UserPlus size={16} />
        )}
        Invite Member
      </button>
    </form>
  );
}

function MemberCard({
  member,
  active,
  onClick,
}: {
  member: TeamMember;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative w-full overflow-hidden rounded-[28px] border p-5 text-left transition ${
        active
          ? "border-cyan-200/70 bg-cyan-400/[0.08] shadow-[0_24px_90px_rgba(34,211,238,0.10)]"
          : !member.isActive
            ? "border-white/10 bg-white/[0.025] opacity-70 hover:bg-white/[0.04]"
            : member.needsAttention
              ? "border-amber-500/20 bg-amber-500/[0.05] hover:bg-amber-500/[0.08]"
              : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
      }`}
    >
      {active ? (
        <div className="absolute bottom-0 left-0 top-0 w-1 bg-cyan-200" />
      ) : null}

      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold tracking-[-0.04em]">
              {member.name}
            </h3>

            <Badge tone={member.statusTone}>{member.status}</Badge>
            <Badge>{member.workloadLabel}</Badge>
          </div>

          <p className="mt-2 text-sm text-white/40">
            {member.email || "System bucket"} · {formatEnum(member.role)}
          </p>

          <p className="mt-1 text-sm text-white/35">
            {member.department || "No department"} ·{" "}
            {member.jobTitle || "No job title"} · Capacity{" "}
            {member.workloadCapacity}
          </p>

          <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/55">
            {member.reasons[0] || "No major issue detected."}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 xl:w-[360px]">
          <MetricMini label="Active" value={member.activeTasks} />
          <MetricMini label="Delayed" value={member.delayedTasks} />
          <MetricMini label="Blocked" value={member.blockedTasks} />
          <MetricMini label="Done" value={member.completedTasks} />
          <MetricMini label="Load" value={`${member.workloadPercent}%`} />
          <MetricMini
            label="Score"
            value={member.score === null ? "N/A" : `${member.score}%`}
          />
        </div>
      </div>
    </button>
  );
}

function MemberDetailPanel(props: {
  member: TeamMember | null;
  saving: string;
  editName: string;
  setEditName: (value: string) => void;
  editRole: Role;
  setEditRole: (value: Role) => void;
  editDepartment: string;
  setEditDepartment: (value: string) => void;
  editJobTitle: string;
  setEditJobTitle: (value: string) => void;
  editCapacity: number;
  setEditCapacity: (value: number) => void;
  onSave: (event: FormEvent) => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onViewTasks: () => void;
}) {
  if (!props.member) {
    return (
      <aside className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <EmptyState
          icon={<UserRound size={34} />}
          title="Select a member"
          description="Profile, role, department, capacity and people insights will appear here."
        />
      </aside>
    );
  }

  const member = props.member;

  return (
    <aside className="h-fit space-y-5 rounded-[34px] border border-white/10 bg-white/[0.04] p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-[-0.05em]">
            {member.name}
          </h2>
          <Badge tone={member.statusTone}>{member.status}</Badge>
        </div>

        <p className="mt-2 text-sm text-white/40">
          {member.email || "No email"} · {formatEnum(member.role)}
        </p>

        <p className="mt-3 text-sm leading-6 text-white/55">
          {member.score === null
            ? member.scoreReason
            : `${member.scoreLabel} · ${member.scoreReason}`}
        </p>
      </div>

      <PanelBlock title="AI People Insight" icon={<Sparkles size={16} />}>
        <div className="space-y-2">
          {member.reasons.map((reason) => (
            <div key={reason} className="flex gap-2 text-sm leading-6 text-white/58">
              <CheckCircle2 size={15} className="mt-1 shrink-0 text-emerald-100" />
              {reason}
            </div>
          ))}
        </div>
      </PanelBlock>

      <div className="grid grid-cols-3 gap-3">
        <MetricBox label="Active" value={member.activeTasks} />
        <MetricBox label="Delayed" value={member.delayedTasks} />
        <MetricBox label="Blocked" value={member.blockedTasks} />
        <MetricBox label="Completed" value={member.completedTasks} />
        <MetricBox label="Capacity" value={member.workloadCapacity} />
        <MetricBox label="Load" value={`${member.workloadPercent}%`} />
      </div>

      {member.type === "USER" ? (
        <form onSubmit={props.onSave} className="space-y-4">
          <PanelBlock title="Profile & Role" icon={<UserRound size={16} />}>
            <div className="space-y-3">
              <Field label="Name">
                <Input value={props.editName} onChange={props.setEditName} />
              </Field>

              <Field label="Role">
                <select
                  value={props.editRole}
                  onChange={(event) =>
                    props.setEditRole(event.target.value as Role)
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

              <Field label="Department">
                <Input
                  value={props.editDepartment}
                  onChange={props.setEditDepartment}
                  placeholder="Sales, Support, Reception..."
                />
              </Field>

              <Field label="Job title">
                <Input
                  value={props.editJobTitle}
                  onChange={props.setEditJobTitle}
                  placeholder="Manager, Receptionist..."
                />
              </Field>

              <Field label="Workload capacity">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={props.editCapacity}
                  onChange={(event) =>
                    props.setEditCapacity(Number(event.target.value))
                  }
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                />
              </Field>

              <button
                disabled={props.saving === "profile"}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
              >
                {props.saving === "profile" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                Save Profile
              </button>
            </div>
          </PanelBlock>
        </form>
      ) : null}

      <PanelBlock title="People Actions" icon={<ShieldAlert size={16} />}>
        <div className="grid gap-2">
          <button
            onClick={props.onViewTasks}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] text-sm text-white/65 hover:bg-white/[0.09] hover:text-white"
          >
            <Clock3 size={16} />
            View Tasks
          </button>

          {member.email ? (
            <a
              href={`mailto:${member.email}`}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] text-sm text-white/65 hover:bg-white/[0.09] hover:text-white"
            >
              <Mail size={16} />
              Message Employee
            </a>
          ) : null}

          {member.type === "USER" && member.isActive ? (
            <button
              onClick={props.onDeactivate}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 text-sm text-red-100 hover:bg-red-500/15"
            >
              <UserMinus size={16} />
              Deactivate Member
            </button>
          ) : null}

          {member.type === "USER" && !member.isActive ? (
            <button
              onClick={props.onReactivate}
              disabled={props.saving === "reactivate"}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-sm text-emerald-100 hover:bg-emerald-500/15 disabled:opacity-50"
            >
              {props.saving === "reactivate" ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <UserPlus size={16} />
              )}
              Reactivate Member
            </button>
          ) : null}
        </div>
      </PanelBlock>

      <TaskListPanel
        title="Active Work"
        icon={<Clock3 size={16} />}
        tasks={member.activeTaskList}
        empty="No active work."
      />

      <TaskListPanel
        title="Delayed Work"
        icon={<AlertTriangle size={16} />}
        tasks={member.delayedTaskList}
        empty="No delayed work."
      />

      <TaskListPanel
        title="Blocked Work"
        icon={<ShieldAlert size={16} />}
        tasks={member.blockedTaskList}
        empty="No blocked work."
      />

      <TaskListPanel
        title="Recent Completed Work"
        icon={<CheckCircle2 size={16} />}
        tasks={member.completedTaskList}
        empty="No completed work yet."
      />
    </aside>
  );
}

function DeactivateBox(props: {
  member: TeamMember;
  strategy: "MOVE_TO_UNASSIGNED" | "REASSIGN" | "KEEP_ASSIGNED";
  reassignToUserId: string;
  members: BasicMember[];
  saving: boolean;
  setStrategy: (
    value: "MOVE_TO_UNASSIGNED" | "REASSIGN" | "KEEP_ASSIGNED"
  ) => void;
  setReassignToUserId: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={props.onSubmit}
      className="rounded-[34px] border border-red-500/20 bg-red-500/10 p-6"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-red-100">
        <UserMinus size={18} />
        Deactivate {props.member.name}
      </div>

      <p className="mt-2 max-w-3xl text-sm leading-6 text-red-100/70">
        This will stop the member from being active in the team. Their history
        will stay saved. Choose what should happen to their open tasks.
      </p>

      <div className="mt-5 grid gap-3 xl:grid-cols-3">
        <DeactivateOption
          active={props.strategy === "MOVE_TO_UNASSIGNED"}
          title="Move tasks to Unassigned"
          description="Best default. Manager can reassign work later."
          onClick={() => props.setStrategy("MOVE_TO_UNASSIGNED")}
        />

        <DeactivateOption
          active={props.strategy === "REASSIGN"}
          title="Reassign open tasks"
          description="Move all open work to another active member."
          onClick={() => props.setStrategy("REASSIGN")}
        />

        <DeactivateOption
          active={props.strategy === "KEEP_ASSIGNED"}
          title="Keep assigned"
          description="Keep task history and active ownership as-is."
          onClick={() => props.setStrategy("KEEP_ASSIGNED")}
        />
      </div>

      {props.strategy === "REASSIGN" ? (
        <div className="mt-4 max-w-md">
          <Field label="Reassign to">
            <select
              value={props.reassignToUserId}
              onChange={(event) => props.setReassignToUserId(event.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              <option value="" className="bg-[#05070d]">
                Select active member
              </option>
              {props.members.map((member) => (
                <option key={member.id} value={member.id} className="bg-[#05070d]">
                  {member.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          disabled={props.saving}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-red-100 px-5 text-sm font-semibold text-black disabled:opacity-50"
        >
          {props.saving ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <UserMinus size={16} />
          )}
          Deactivate Member
        </button>

        <button
          type="button"
          onClick={props.onCancel}
          className="h-12 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeactivateOption({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[26px] border p-4 text-left ${
        active
          ? "border-red-100 bg-red-100 text-black"
          : "border-red-500/20 bg-black/20 text-red-100"
      }`}
    >
      <p className="font-semibold">{title}</p>
      <p className={`mt-2 text-sm leading-6 ${active ? "text-black/60" : "text-red-100/65"}`}>
        {description}
      </p>
    </button>
  );
}

function TaskListPanel({
  title,
  icon,
  tasks,
  empty,
}: {
  title: string;
  icon: ReactNode;
  tasks: TaskPreview[];
  empty: string;
}) {
  return (
    <PanelBlock title={title} icon={icon}>
      {tasks.length === 0 ? (
        <p className="text-sm text-white/40">{empty}</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskMiniCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </PanelBlock>
  );
}

function TaskMiniCard({ task }: { task: TaskPreview }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        task.delayed
          ? "border-red-500/20 bg-red-500/10"
          : task.status === "BLOCKED"
            ? "border-amber-500/20 bg-amber-500/10"
            : "border-white/10 bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-6">{task.title}</p>
        <Badge tone={priorityTone(task.priority)}>
          {formatEnum(task.priority)}
        </Badge>
      </div>

      <p className="mt-2 text-xs leading-5 text-white/40">
        {task.customerName} · {task.taskType} · {task.source}
      </p>

      <p className="mt-2 text-xs text-white/35">
        {task.dueAt ? formatDate(task.dueAt) : "No deadline"} ·{" "}
        {task.delayLabel}
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: ReactNode;
  tone?: string;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/20 bg-red-500/10"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10"
        : tone === "success"
          ? "border-emerald-500/20 bg-emerald-500/10"
          : tone === "muted"
            ? "border-white/10 bg-white/[0.035]"
            : "border-white/10 bg-black/20";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
        {value}
      </p>
    </div>
  );
}

function Badge({
  children,
  tone = "normal",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs ${getToneClass(
        tone
      )}`}
    >
      {children}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
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
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none placeholder:text-white/25 disabled:opacity-45"
    />
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
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white/[0.06] text-white/40">
        {icon}
      </div>

      <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em]">
        {title}
      </h3>

      <p className="mt-2 max-w-sm text-sm leading-6 text-white/38">
        {description}
      </p>
    </div>
  );
}