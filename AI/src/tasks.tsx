import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  PhoneCall,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  UserRound,
  Zap,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type TaskStatus = "OPEN" | "DOING" | "BLOCKED" | "DONE";
type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type AiCallLanguage = "AUTO" | "ENGLISH" | "HINDI" | "GUJARATI";

type Filter =
  | "ALL"
  | "MY_TASKS"
  | "UNASSIGNED"
  | "DUE_TODAY"
  | "OVERDUE"
  | "CRITICAL"
  | "BLOCKED"
  | "OPEN"
  | "DOING"
  | "COMPLETED";

type TaskRow = {
  id: string;
  title: string;
  displayTitle?: string;
  description: string;
  workToDo?: string;
  status: TaskStatus;
  priority: Priority;

  taskType: string;
  taskTypeLabel: string;
  source: string;

  assignedUserId?: string | null;
  manualOwner: string;
  ownerLabel: string;
  ownerType: string;

  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;

  conversationId?: string | null;
  conversationChannel?: string | null;

  dueAt?: string | null;
  dueLabel: string;
  delayLabel: string;
  slaLabel: string;

  nextAction: string;
  warnings: string[];

  aiNotes: string;
  scheduledCall?: {
    status?: string | null;
    scheduledAt?: string | null;
    scheduledLabel?: string | null;
    phone?: string | null;
    fullName?: string | null;
    purpose?: string | null;
    notes?: string | null;
    preferredLanguage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    callSid?: string | null;
    error?: string | null;
    meetingTime?: string | null;
  } | null;
  leadRequirements?: {
    summary: string;
    raw?: string[];
    meetingTime?: string | null;
    meetingScheduledAt?: string | null;
    meetingStatus?: string | null;
    bookingTitle?: string | null;
    captured?: boolean;
    source?: string | null;
  } | null;
  blockedReason: string;

  isEmergency: boolean;
  isOverdue: boolean;
  isDueToday: boolean;
  isUnassigned: boolean;

  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;

  timeline: {
    title: string;
    description: string;
    createdAt: string;
    recordingMediaUrl?: string | null;
  }[];
};

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

type TaskResponse = {
  summary: {
    total: number;
    open: number;
    doing: number;
    dueToday: number;
    overdue: number;
    unassigned: number;
    blocked: number;
    critical: number;
    completedToday: number;
    completionRate: number;
  };
  tasks: TaskRow[];
  teamMembers: TeamMember[];
};

const filters: {
  label: string;
  value: Filter;
}[] = [
  { label: "All", value: "ALL" },
  { label: "My Tasks", value: "MY_TASKS" },
  { label: "Unassigned", value: "UNASSIGNED" },
  { label: "Due Today", value: "DUE_TODAY" },
  { label: "Overdue", value: "OVERDUE" },
  { label: "Completed", value: "COMPLETED" },
];

const priorities: {
  label: string;
  value: "ALL" | Priority;
}[] = [
  { label: "All priority", value: "ALL" },
  { label: "Critical", value: "CRITICAL" },
  { label: "High", value: "HIGH" },
  { label: "Medium", value: "MEDIUM" },
  { label: "Low", value: "LOW" },
];

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  const diff = Date.now() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function toDateInput(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);

  return local.toISOString().slice(0, 16);
}

function fromDateInput(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function getPriorityTone(priority: string) {
  if (priority === "CRITICAL") return "danger";
  if (priority === "HIGH") return "warning";
  if (priority === "MEDIUM") return "info";
  return "normal";
}

function getStatusTone(status: string) {
  if (status === "DONE") return "success";
  if (status === "BLOCKED") return "danger";
  if (status === "DOING") return "info";
  return "normal";
}

function cleanLeadRequirement(value?: string | null) {
  const candidate = String(value || "").replace(/\s+/g, " ").trim();
  if (!candidate) return "";

  const instructionPatterns = [
    /^(?:you are|you'?re|act as|behave as|respond as|speak as|your role is|your task is|your goal is|system prompt|instructions?\s*:)/i,
    /^(?:call this lead|contact this lead|collect .*requirements?|ask .*budget|schedule .*meeting)/i,
    /speak naturally.*(?:sales|representative|agent)/i,
    /\bconsultative\s+sales\s+representative\b/i,
    /\b(?:opening behavior|opening behaviour|qualification flow|sales script|conversation objective)\b/i,
    /\b(?:always|never|must|should|do not|don't)\b.*\b(?:ask|speak|sell|qualify|wait)\b/i,
  ];

  const operationalNoise = [
    /^ai scheduled call/i,
    /^customer completed (?:an )?ai (?:voice )?call/i,
    /^incoming call started/i,
    /^(?:phone|status|language|scheduled|started|completed|call sid|twilio call|provider|task id)\s*[:\-]/i,
  ];

  return [...instructionPatterns, ...operationalNoise].some((pattern) =>
    pattern.test(candidate),
  )
    ? ""
    : candidate;
}

function safeClientName(task: TaskRow) {
  const value = String(task.customerName || "").trim();
  return value && value !== "-" ? value : "No client name";
}

export default function TasksPage() {
  const [searchParams] = useSearchParams();

  const [filter, setFilter] = useState<Filter>("ALL");
  const [priority, setPriority] = useState<"ALL" | Priority>("ALL");
  const [assignee, setAssignee] = useState(
    () => searchParams.get("assignee") || "ALL"
  );
  const [search, setSearch] = useState("");

  const [summary, setSummary] = useState<TaskResponse["summary"]>({
    total: 0,
    open: 0,
    doing: 0,
    dueToday: 0,
    overdue: 0,
    unassigned: 0,
    blocked: 0,
    critical: 0,
    completedToday: 0,
    completionRate: 0,
  });

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const [selectedId, setSelectedId] = useState("");
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showAiCall, setShowAiCall] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAssignedUserId, setNewAssignedUserId] = useState("");
  const [newManualOwner, setNewManualOwner] = useState("");
  const [newDueAt, setNewDueAt] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("MEDIUM");
  const [newAiNotes, setNewAiNotes] = useState("");

  const [aiCallName, setAiCallName] = useState("");
  const [aiCallPhone, setAiCallPhone] = useState("");
  const [aiCallAt, setAiCallAt] = useState("");
  const [aiCallPurpose, setAiCallPurpose] = useState(
    "Call this lead, collect website/software requirements, ask budget and timeline, then create a meeting request.",
  );
  const [aiCallNotes, setAiCallNotes] = useState("");
  const [aiCallLanguage, setAiCallLanguage] = useState<AiCallLanguage>("AUTO");
  const [aiCallPriority, setAiCallPriority] = useState<Priority>("HIGH");

  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAssignedUserId, setDraftAssignedUserId] = useState("");
  const [draftManualOwner, setDraftManualOwner] = useState("");
  const [draftDueAt, setDraftDueAt] = useState("");
  const [draftPriority, setDraftPriority] = useState<Priority>("MEDIUM");
  const [draftStatus, setDraftStatus] = useState<TaskStatus>("OPEN");
  const [draftAiNotes, setDraftAiNotes] = useState("");
  const [draftBlockedReason, setDraftBlockedReason] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function syncDraftFromTask(task: TaskRow) {
    setDraftTitle(task.title);
    setDraftDescription(task.workToDo || task.description || "");
    setDraftAssignedUserId(task.assignedUserId || "");
    setDraftManualOwner(task.manualOwner || "");
    setDraftDueAt(toDateInput(task.dueAt));
    setDraftPriority(task.priority);
    setDraftStatus(task.status);
    setDraftAiNotes(task.aiNotes || "");
    setDraftBlockedReason(task.blockedReason || "");
  }

  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadTasks = useCallback(async (nextSelectedId?: string) => {
    try {
      setError("");
      setLoading(true);

      const params = new URLSearchParams({
        filter,
        priority,
        assignee,
      });

      if (search.trim()) {
        params.set("search", search.trim());
      }

      const data = await apiFetch<TaskResponse>(
        `/api/tasks/operations?${params.toString()}`,
      );

      setSummary(data.summary);
      setTasks(data.tasks);
      setTeamMembers(data.teamMembers);

      const nextId =
        nextSelectedId || selectedIdRef.current || data.tasks[0]?.id || "";
      const found = data.tasks.find((task) => task.id === nextId) || null;

      if (found) {
        setSelectedId(found.id);
        setSelectedTask(found);
        syncDraftFromTask(found);
      } else if (data.tasks[0]) {
        setSelectedId(data.tasks[0].id);
        setSelectedTask(data.tasks[0]);
        syncDraftFromTask(data.tasks[0]);
      } else {
        setSelectedId("");
        setSelectedTask(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [filter, priority, assignee, search]);

  function selectTask(task: TaskRow) {
    setSelectedTask(task);
    setSelectedId(task.id);
    syncDraftFromTask(task);
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();

    if (!newTitle.trim()) return;

    try {
      setSaving("create");
      setError("");
      setNotice("");

      const data = await apiFetch<{ task: { id: string } }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim() || null,
          priority: newPriority,
          status: "OPEN",
          dueAt: fromDateInput(newDueAt),
          assignedUserId: newAssignedUserId || null,
          owner: newAssignedUserId ? null : newManualOwner || null,
          aiNotes: newAiNotes.trim() || null,
        }),
      });

      setNewTitle("");
      setNewDescription("");
      setNewAssignedUserId("");
      setNewManualOwner("");
      setNewDueAt("");
      setNewPriority("MEDIUM");
      setNewAiNotes("");
      setShowCreate(false);
      setNotice("Task created");

      await loadTasks(data.task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSaving("");
    }
  }

  async function scheduleAiCallTask(event: FormEvent) {
    event.preventDefault();

    if (!aiCallPhone.trim() || !aiCallAt || !aiCallPurpose.trim()) return;

    try {
      setSaving("ai-call");
      setError("");
      setNotice("");

      const data = await apiFetch<{ task: { id: string } }>(
        "/api/tasks/ai-call",
        {
          method: "POST",
          body: JSON.stringify({
            fullName: aiCallName.trim() || null,
            phone: aiCallPhone.trim(),
            scheduledAt: fromDateInput(aiCallAt),
            purpose: aiCallPurpose.trim(),
            notes: aiCallNotes.trim() || null,
            preferredLanguage: aiCallLanguage,
            priority: aiCallPriority,
          }),
        },
      );

      setAiCallName("");
      setAiCallPhone("");
      setAiCallAt("");
      setAiCallPurpose(
        "Call this lead, collect website/software requirements, ask budget and timeline, then create a meeting request.",
      );
      setAiCallNotes("");
      setAiCallLanguage("AUTO");
      setAiCallPriority("HIGH");
      setShowAiCall(false);
      setNotice(
        "AI call scheduled. The backend worker will call at that time.",
      );

      await loadTasks(data.task.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to schedule AI call",
      );
    } finally {
      setSaving("");
    }
  }

  async function saveTask(event?: FormEvent) {
    event?.preventDefault();

    if (!selectedTask) return;

    try {
      setSaving("save");
      setError("");
      setNotice("");

      const payload: Record<string, unknown> = {
        title: draftTitle,
        description: draftDescription || null,
        assignedUserId: draftAssignedUserId || null,
        owner: draftAssignedUserId ? null : draftManualOwner || null,
        dueAt: fromDateInput(draftDueAt),
        priority: draftPriority,
        status: draftStatus,
        blockedReason: draftBlockedReason || null,
      };

      if (selectedTask.taskType !== "AI_CALL") {
        payload.aiNotes = draftAiNotes || null;
      }

      await apiFetch(`/api/tasks/${selectedTask.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      setNotice("Task saved");
      await loadTasks(selectedTask.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setSaving("");
    }
  }

  async function removeTask() {
    if (!selectedTask) return;

    const confirmed = window.confirm(
      `Delete task "${selectedTask.title}"? This cannot be undone.`,
    );

    if (!confirmed) return;

    try {
      setSaving("delete");
      setError("");
      setNotice("");

      await apiFetch(`/api/tasks/${selectedTask.id}`, {
        method: "DELETE",
      });

      const nextTask =
        tasks.find((task) => task.id !== selectedTask.id) || null;

      setNotice("Task removed");
      setSelectedId(nextTask?.id || "");
      setSelectedTask(nextTask);

      await loadTasks(nextTask?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove task");
    } finally {
      setSaving("");
    }
  }

  async function runAction(
    action:
      "START" | "BLOCK" | "DONE" | "ESCALATE" | "REOPEN" | "CREATE_FOLLOW_UP",
  ) {
    if (!selectedTask) return;

    let blockedReason: string | null = null;
    let note: string | null = null;
    let dueAt: string | null = null;

    if (action === "BLOCK") {
      blockedReason = window.prompt(
        "Why is this task blocked?",
        selectedTask.blockedReason || "Waiting for customer",
      );

      if (!blockedReason?.trim()) return;
    }

    if (action === "ESCALATE") {
      note = window.prompt(
        "Escalation note",
        "This task needs manager attention immediately",
      );
    }

    if (action === "CREATE_FOLLOW_UP") {
      note = window.prompt(
        "Follow-up task title",
        `Follow up: ${selectedTask.title}`,
      );

      if (!note?.trim()) return;

      const rawDueAt = window.prompt(
        "Follow-up due date/time in ISO format, or leave empty",
        "",
      );

      dueAt = rawDueAt?.trim() || null;
    }

    try {
      setSaving("action");
      setError("");
      setNotice("");

      await apiFetch(`/api/tasks/${selectedTask.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action,
          blockedReason,
          note,
          dueAt,
        }),
      });

      setNotice("Task updated");
      await loadTasks(selectedTask.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task action failed");
    } finally {
      setSaving("");
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadTasks();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [loadTasks]);

  const assigneeOptions = useMemo(() => {
    return [
      { label: "All assignees", value: "ALL" },
      { label: "Unassigned", value: "UNASSIGNED" },
      ...teamMembers.map((member) => ({
        label: member.name,
        value: member.id,
      })),
    ];
  }, [teamMembers]);

  return (
    <section className="space-y-5 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5 md:p-6">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-cyan-200">
              <CheckCircle2 size={14} />
              Task Board
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
              Tasks
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/45">
              Select a client on the left. Review the work, owner, deadline and
              status on the right.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowAiCall((value) => !value)}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/[0.10] px-5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/[0.16]"
            >
              <PhoneCall size={16} />
              Schedule AI Call
            </button>

            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black"
            >
              <Plus size={16} />
              New Task
            </button>

            <button
              type="button"
              onClick={() => loadTasks()}
              aria-label="Refresh tasks"
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-white/65 transition hover:bg-white/[0.07] hover:text-white"
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Open" value={summary.open} />
          <SummaryCard label="In progress" value={summary.doing} tone="info" />
          <SummaryCard
            label="Due today"
            value={summary.dueToday}
            tone={summary.dueToday > 0 ? "warning" : "normal"}
          />
          <SummaryCard
            label="Overdue"
            value={summary.overdue}
            tone={summary.overdue > 0 ? "danger" : "normal"}
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

      {showAiCall ? (
        <ScheduleAiCallForm
          fullName={aiCallName}
          phone={aiCallPhone}
          scheduledAt={aiCallAt}
          purpose={aiCallPurpose}
          notes={aiCallNotes}
          preferredLanguage={aiCallLanguage}
          priority={aiCallPriority}
          saving={saving === "ai-call"}
          setFullName={setAiCallName}
          setPhone={setAiCallPhone}
          setScheduledAt={setAiCallAt}
          setPurpose={setAiCallPurpose}
          setNotes={setAiCallNotes}
          setPreferredLanguage={setAiCallLanguage}
          setPriority={setAiCallPriority}
          onSubmit={scheduleAiCallTask}
        />
      ) : null}

      {showCreate ? (
        <CreateTaskForm
          title={newTitle}
          description={newDescription}
          assignedUserId={newAssignedUserId}
          manualOwner={newManualOwner}
          dueAt={newDueAt}
          priority={newPriority}
          aiNotes={newAiNotes}
          teamMembers={teamMembers}
          saving={saving === "create"}
          setTitle={setNewTitle}
          setDescription={setNewDescription}
          setAssignedUserId={setNewAssignedUserId}
          setManualOwner={setNewManualOwner}
          setDueAt={setNewDueAt}
          setPriority={setNewPriority}
          setAiNotes={setNewAiNotes}
          onSubmit={createTask}
        />
      ) : null}

      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-4">
        <div className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              type="button"
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

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_240px_200px]">
          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={17} className="shrink-0 text-white/30" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search client or task..."
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>

          <select
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          >
            {assigneeOptions.map((item) => (
              <option
                key={item.value}
                value={item.value}
                className="bg-[#05070d]"
              >
                {item.label}
              </option>
            ))}
          </select>

          <select
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as "ALL" | Priority)
            }
            className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          >
            {priorities.map((item) => (
              <option
                key={item.value}
                value={item.value}
                className="bg-[#05070d]"
              >
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(240px,1fr)_minmax(0,4fr)] xl:items-start">
        <aside className="overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.04] xl:sticky xl:top-5">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 p-5">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.04em]">
                Work Queue
              </h2>
              <p className="mt-1 text-xs text-white/35">
                Select a client
              </p>
            </div>

            <Badge tone="normal">{tasks.length}</Badge>
          </div>

          <div className="max-h-[calc(100vh-250px)] min-h-[520px] space-y-2 overflow-y-auto p-3">
            {loading ? (
              <LoadingState text="Loading tasks..." compact />
            ) : tasks.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 size={30} />}
                title="No tasks found"
                description="Create a task or change the filters."
                compact
              />
            ) : (
              tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  active={selectedId === task.id}
                  onClick={() => selectTask(task)}
                />
              ))
            )}
          </div>
        </aside>

        <TaskDetailPanel
          task={selectedTask}
          saving={saving}
          teamMembers={teamMembers}
          draftTitle={draftTitle}
          setDraftTitle={setDraftTitle}
          draftDescription={draftDescription}
          setDraftDescription={setDraftDescription}
          draftAssignedUserId={draftAssignedUserId}
          setDraftAssignedUserId={setDraftAssignedUserId}
          draftManualOwner={draftManualOwner}
          setDraftManualOwner={setDraftManualOwner}
          draftDueAt={draftDueAt}
          setDraftDueAt={setDraftDueAt}
          draftPriority={draftPriority}
          setDraftPriority={setDraftPriority}
          draftStatus={draftStatus}
          setDraftStatus={setDraftStatus}
          draftAiNotes={draftAiNotes}
          setDraftAiNotes={setDraftAiNotes}
          draftBlockedReason={draftBlockedReason}
          setDraftBlockedReason={setDraftBlockedReason}
          onSave={saveTask}
          onStart={() => runAction("START")}
          onBlock={() => runAction("BLOCK")}
          onDone={() => runAction("DONE")}
          onEscalate={() => runAction("ESCALATE")}
          onReopen={() => runAction("REOPEN")}
          onFollowUp={() => runAction("CREATE_FOLLOW_UP")}
          onRemove={removeTask}
        />
      </section>
    </section>
  );
}

function ScheduleAiCallForm(props: {
  fullName: string;
  phone: string;
  scheduledAt: string;
  purpose: string;
  notes: string;
  preferredLanguage: AiCallLanguage;
  priority: Priority;
  saving: boolean;
  setFullName: (value: string) => void;
  setPhone: (value: string) => void;
  setScheduledAt: (value: string) => void;
  setPurpose: (value: string) => void;
  setNotes: (value: string) => void;
  setPreferredLanguage: (value: AiCallLanguage) => void;
  setPriority: (value: Priority) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={props.onSubmit}
      className="rounded-[34px] border border-cyan-300/20 bg-cyan-400/[0.06] p-6"
    >
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
            <PhoneCall size={18} />
            Schedule AI Requirement Call
          </div>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-100/60">
            Choose who the AI should call, when it should call, and what it
            should collect.
          </p>
        </div>

        <Badge tone="info">AI Caller</Badge>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-4">
        <Field label="Customer name">
          <Input
            value={props.fullName}
            onChange={props.setFullName}
            placeholder="Rahul Sharma"
          />
        </Field>

        <Field label="Phone number">
          <Input
            value={props.phone}
            onChange={props.setPhone}
            placeholder="+919586410399"
          />
        </Field>

        <Field label="Call time">
          <input
            type="datetime-local"
            value={props.scheduledAt}
            onChange={(event) => props.setScheduledAt(event.target.value)}
            className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          />
        </Field>

        <Field label="AI speaking language">
          <select
            value={props.preferredLanguage}
            onChange={(event) =>
              props.setPreferredLanguage(event.target.value as AiCallLanguage)
            }
            className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          >
            <option value="AUTO" className="bg-[#05070d]">
              Auto-detect
            </option>
            <option value="ENGLISH" className="bg-[#05070d]">
              English
            </option>
            <option value="HINDI" className="bg-[#05070d]">
              Hindi
            </option>
            <option value="GUJARATI" className="bg-[#05070d]">
              Gujarati
            </option>
          </select>
        </Field>

        <Field label="Priority">
          <select
            value={props.priority}
            onChange={(event) =>
              props.setPriority(event.target.value as Priority)
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

        <div className="xl:col-span-2">
          <Field label="What should AI collect?">
            <textarea
              value={props.purpose}
              onChange={(event) => props.setPurpose(event.target.value)}
              placeholder="Collect requirement, budget, timeline, preferred meeting time..."
              className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
            />
          </Field>
        </div>

        <div className="xl:col-span-2">
          <Field label="Extra notes for AI">
            <textarea
              value={props.notes}
              onChange={(event) => props.setNotes(event.target.value)}
              placeholder="Mention context, product, lead source, budget hint, meeting constraints..."
              className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
            />
          </Field>
        </div>
      </div>

      <button
        disabled={
          props.saving ||
          !props.phone.trim() ||
          !props.scheduledAt ||
          !props.purpose.trim()
        }
        className="mt-5 flex h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-100 px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
      >
        {props.saving ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <PhoneCall size={16} />
        )}
        Schedule AI Call
      </button>
    </form>
  );
}

function CreateTaskForm(props: {
  title: string;
  description: string;
  assignedUserId: string;
  manualOwner: string;
  dueAt: string;
  priority: Priority;
  aiNotes: string;
  teamMembers: TeamMember[];
  saving: boolean;
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  setAssignedUserId: (value: string) => void;
  setManualOwner: (value: string) => void;
  setDueAt: (value: string) => void;
  setPriority: (value: Priority) => void;
  setAiNotes: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={props.onSubmit}
      className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
        <Plus size={18} />
        Create Work Task
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-4">
        <Field label="Task title">
          <Input value={props.title} onChange={props.setTitle} />
        </Field>

        <Field label="Assigned member">
          <select
            value={props.assignedUserId}
            onChange={(event) => props.setAssignedUserId(event.target.value)}
            className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          >
            <option value="" className="bg-[#05070d]">
              No team member
            </option>
            {props.teamMembers.map((member) => (
              <option
                key={member.id}
                value={member.id}
                className="bg-[#05070d]"
              >
                {member.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Manual owner">
          <Input
            value={props.manualOwner}
            onChange={props.setManualOwner}
            disabled={Boolean(props.assignedUserId)}
            placeholder="Reception team"
          />
        </Field>

        <Field label="Deadline">
          <input
            type="datetime-local"
            value={props.dueAt}
            onChange={(event) => props.setDueAt(event.target.value)}
            className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          />
        </Field>

        <Field label="Priority">
          <select
            value={props.priority}
            onChange={(event) =>
              props.setPriority(event.target.value as Priority)
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

        <div className="xl:col-span-3">
          <Field label="Task details">
            <Input value={props.description} onChange={props.setDescription} />
          </Field>
        </div>

        <div className="xl:col-span-4">
          <Field label="Internal note">
            <textarea
              value={props.aiNotes}
              onChange={(event) => props.setAiNotes(event.target.value)}
              placeholder="Optional context for the team..."
              className="min-h-[90px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
            />
          </Field>
        </div>
      </div>

      <button
        disabled={props.saving}
        className="mt-5 flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
      >
        {props.saving ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <Plus size={16} />
        )}
        Create Task
      </button>
    </form>
  );
}

function TaskCard({
  task,
  active,
  onClick,
}: {
  task: TaskRow;
  active: boolean;
  onClick: () => void;
}) {
  const urgent = task.isEmergency || task.isOverdue || task.priority === "CRITICAL";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        active
          ? "border-white bg-white text-black shadow-[0_16px_45px_rgba(255,255,255,0.08)]"
          : urgent
            ? "border-red-500/20 bg-red-500/[0.05] text-white hover:bg-red-500/[0.08]"
            : "border-white/10 bg-black/20 text-white hover:bg-white/[0.07]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`truncate text-sm font-semibold ${
              active ? "text-black" : "text-white"
            }`}
          >
            {safeClientName(task)}
          </p>
          <p
            className={`mt-1 line-clamp-2 text-xs leading-5 ${
              active ? "text-black/55" : "text-white/42"
            }`}
          >
            {task.displayTitle || task.title}
          </p>
        </div>

        <Badge tone={getStatusTone(task.status)}>
          {formatEnum(task.status)}
        </Badge>
      </div>

      <div
        className={`mt-3 space-y-1.5 border-t pt-3 text-xs ${
          active ? "border-black/10 text-black/55" : "border-white/8 text-white/38"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <UserRound size={13} className="shrink-0" />
          <span className="truncate">{task.ownerLabel || "Unassigned"}</span>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <CalendarClock size={13} className="shrink-0" />
          <span className="truncate">
            {task.dueAt ? task.dueLabel : "No deadline"}
          </span>
        </div>
      </div>
    </button>
  );
}

function TaskDetailPanel(props: {
  task: TaskRow | null;
  saving: string;
  teamMembers: TeamMember[];

  draftTitle: string;
  setDraftTitle: (value: string) => void;
  draftDescription: string;
  setDraftDescription: (value: string) => void;
  draftAssignedUserId: string;
  setDraftAssignedUserId: (value: string) => void;
  draftManualOwner: string;
  setDraftManualOwner: (value: string) => void;
  draftDueAt: string;
  setDraftDueAt: (value: string) => void;
  draftPriority: Priority;
  setDraftPriority: (value: Priority) => void;
  draftStatus: TaskStatus;
  setDraftStatus: (value: TaskStatus) => void;
  draftAiNotes: string;
  setDraftAiNotes: (value: string) => void;
  draftBlockedReason: string;
  setDraftBlockedReason: (value: string) => void;

  onSave: (event: FormEvent) => void;
  onStart: () => void;
  onBlock: () => void;
  onDone: () => void;
  onEscalate: () => void;
  onReopen: () => void;
  onFollowUp: () => void;
  onRemove: () => void;
}) {
  if (!props.task) {
    return (
      <main className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <EmptyState
          icon={<CheckCircle2 size={34} />}
          title="Select a client"
          description="The task, owner, deadline and status will appear here."
        />
      </main>
    );
  }

  const task = props.task;
  const requirement = cleanLeadRequirement(task.leadRequirements?.summary);
  const meetingTime = task.leadRequirements?.meetingTime || "";
  const workToDo =
    String(task.workToDo || "").trim() ||
    String(task.description || "").trim() ||
    String(task.nextAction || "").trim() ||
    task.title;
  const isAiCallTask =
    task.taskType === "AI_CALL" || task.conversationChannel === "AI_CALL";

  return (
    <main className="min-w-0 space-y-5 rounded-[30px] border border-white/10 bg-white/[0.04] p-5 md:p-6">
      <header className="flex flex-col justify-between gap-5 border-b border-white/10 pb-5 xl:flex-row xl:items-start">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-100/60">
            {safeClientName(task)}
          </p>

          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.05em]">
            {task.displayTitle || task.title}
          </h2>

          <p className="mt-2 text-sm text-white/40">
            Updated {formatTime(task.updatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone={getStatusTone(task.status)}>
            {formatEnum(task.status)}
          </Badge>
          <Badge tone={getPriorityTone(task.priority)}>
            {formatEnum(task.priority)}
          </Badge>
          {task.isOverdue ? <Badge tone="danger">Overdue</Badge> : null}
        </div>
      </header>

      {task.warnings.length > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <ShieldAlert size={17} className="mt-0.5 shrink-0 text-red-100" />
          <p className="text-sm leading-6 text-red-100/75">
            {task.warnings.join(" · ")}
          </p>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoBox label="Client" value={safeClientName(task)} />
        <InfoBox
          label="Handled by"
          value={task.ownerLabel || "Unassigned"}
        />
        <InfoBox
          label="Deadline"
          value={task.dueAt ? task.dueLabel : "No deadline"}
        />
        <InfoBox label="Status" value={formatEnum(task.status)} />
      </section>

      <PanelBlock title="What needs to be done" icon={<FileText size={16} />}>
        <p className="whitespace-pre-wrap text-sm leading-7 text-white/68">
          {workToDo}
        </p>
      </PanelBlock>

      {isAiCallTask ? (
        <PanelBlock title="Customer result" icon={<CheckCircle2 size={16} />}>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/32">
                What the customer needs
              </p>

              {requirement ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/72">
                  {requirement}
                </p>
              ) : (
                <p className="mt-3 text-sm leading-6 text-white/40">
                  No clear customer requirement was stated during the call.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-100/55">
                Meeting requested
              </p>
              <p className="mt-3 text-sm font-semibold leading-6 text-cyan-50">
                {meetingTime || "No meeting time was agreed during the call."}
              </p>
            </div>
          </div>
        </PanelBlock>
      ) : null}

      {task.scheduledCall ? (
        <PanelBlock title="AI call" icon={<PhoneCall size={16} />}>
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoBox
              label="Call time"
              value={task.scheduledCall.scheduledLabel || task.dueLabel}
            />
            <InfoBox
              label="Call status"
              value={formatEnum(task.scheduledCall.status || task.status)}
            />
            <InfoBox
              label="Customer meeting"
              value={meetingTime || "Not requested by the customer"}
            />
          </div>

          {task.scheduledCall.error ? (
            <p className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm leading-6 text-red-100">
              {task.scheduledCall.error}
            </p>
          ) : null}
        </PanelBlock>
      ) : null}

      <PanelBlock title="Quick actions" icon={<Zap size={16} />}>
        <div className="flex flex-wrap gap-2">
          {task.status === "OPEN" ? (
            <ActionButton onClick={props.onStart} disabled={Boolean(props.saving)}>
              Start task
            </ActionButton>
          ) : null}

          {task.status !== "DONE" ? (
            <ActionButton onClick={props.onDone} disabled={Boolean(props.saving)}>
              Mark done
            </ActionButton>
          ) : (
            <ActionButton onClick={props.onReopen} disabled={Boolean(props.saving)}>
              Reopen
            </ActionButton>
          )}

          {task.status !== "BLOCKED" && task.status !== "DONE" ? (
            <ActionButton onClick={props.onBlock} disabled={Boolean(props.saving)}>
              Mark blocked
            </ActionButton>
          ) : null}

          {task.status === "BLOCKED" ? (
            <ActionButton onClick={props.onReopen} disabled={Boolean(props.saving)}>
              Resume task
            </ActionButton>
          ) : null}

          {task.status !== "DONE" ? (
            <ActionButton onClick={props.onFollowUp} disabled={Boolean(props.saving)}>
              Create follow-up
            </ActionButton>
          ) : null}

          <ActionButton onClick={props.onEscalate} disabled={Boolean(props.saving)}>
            Escalate
          </ActionButton>
        </div>
      </PanelBlock>

      <form onSubmit={props.onSave} className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Task details</h3>
            <p className="mt-1 text-sm text-white/38">
              Update only the information the team needs to execute the work.
            </p>
          </div>
        </div>

        <Field label="Task name">
          <Input value={props.draftTitle} onChange={props.setDraftTitle} />
        </Field>

        <Field label="What needs to be done">
          <textarea
            value={props.draftDescription}
            onChange={(event) => props.setDraftDescription(event.target.value)}
            placeholder="Describe the expected work or deliverable."
            className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Handled by">
            <select
              value={props.draftAssignedUserId}
              onChange={(event) =>
                props.setDraftAssignedUserId(event.target.value)
              }
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              <option value="" className="bg-[#05070d]">
                No team member
              </option>
              {props.teamMembers.map((member) => (
                <option
                  key={member.id}
                  value={member.id}
                  className="bg-[#05070d]"
                >
                  {member.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Manual owner">
            <Input
              value={props.draftManualOwner}
              onChange={props.setDraftManualOwner}
              placeholder="Team or person"
              disabled={Boolean(props.draftAssignedUserId)}
            />
          </Field>

          <Field label="Deadline">
            <input
              type="datetime-local"
              value={props.draftDueAt}
              onChange={(event) => props.setDraftDueAt(event.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            />
          </Field>

          <Field label="Status">
            <select
              value={props.draftStatus}
              onChange={(event) =>
                props.setDraftStatus(event.target.value as TaskStatus)
              }
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              <option value="OPEN" className="bg-[#05070d]">Open</option>
              <option value="DOING" className="bg-[#05070d]">In progress</option>
              <option value="BLOCKED" className="bg-[#05070d]">Blocked</option>
              <option value="DONE" className="bg-[#05070d]">Done</option>
            </select>
          </Field>
        </div>

        <Field label="Priority">
          <select
            value={props.draftPriority}
            onChange={(event) =>
              props.setDraftPriority(event.target.value as Priority)
            }
            className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none md:max-w-[260px]"
          >
            <option value="CRITICAL" className="bg-[#05070d]">Critical</option>
            <option value="HIGH" className="bg-[#05070d]">High</option>
            <option value="MEDIUM" className="bg-[#05070d]">Medium</option>
            <option value="LOW" className="bg-[#05070d]">Low</option>
          </select>
        </Field>

        {!isAiCallTask ? (
          <details className="rounded-2xl border border-white/10 bg-black/20">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white/60">
              Additional notes
            </summary>

            <div className="space-y-4 border-t border-white/10 p-4">
              <Field label="Internal note">
                <textarea
                  value={props.draftAiNotes}
                  onChange={(event) => props.setDraftAiNotes(event.target.value)}
                  className="min-h-[90px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none"
                />
              </Field>

              {props.draftStatus === "BLOCKED" || props.draftBlockedReason ? (
                <Field label="Blocked reason">
                  <textarea
                    value={props.draftBlockedReason}
                    onChange={(event) =>
                      props.setDraftBlockedReason(event.target.value)
                    }
                    placeholder="What is preventing completion?"
                    className="min-h-[90px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
                  />
                </Field>
              ) : null}
            </div>
          </details>
        ) : props.draftStatus === "BLOCKED" || props.draftBlockedReason ? (
          <Field label="Blocked reason">
            <textarea
              value={props.draftBlockedReason}
              onChange={(event) =>
                props.setDraftBlockedReason(event.target.value)
              }
              placeholder="What is preventing completion?"
              className="min-h-[90px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
            />
          </Field>
        ) : null}

        <button
          disabled={props.saving === "save"}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-6 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {props.saving === "save" ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <Save size={16} />
          )}
          Save changes
        </button>
      </form>

      <details className="rounded-2xl border border-white/10 bg-black/20">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-white/60">
          <Clock3 size={15} />
          Activity history ({task.timeline.length})
        </summary>

        <div className="space-y-3 border-t border-white/10 p-4">
          {task.timeline.length === 0 ? (
            <p className="text-sm text-white/38">No activity yet.</p>
          ) : (
            task.timeline.map((item, index) => (
              <div
                key={`${item.title}-${index}`}
                className="border-l border-white/10 pl-3"
              >
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/38">
                  {item.description}
                </p>
                <p className="mt-1 text-[11px] text-white/25">
                  {formatTime(item.createdAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </details>

      <button
        type="button"
        onClick={props.onRemove}
        disabled={Boolean(props.saving)}
        className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 text-sm text-red-100/75 transition hover:bg-red-500/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {props.saving === "delete" ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <Trash2 size={16} />
        )}
        Delete task
      </button>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: ReactNode;
  tone?: "normal" | "warning" | "danger" | "success" | "info";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/20 bg-red-500/10"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10"
        : tone === "success"
          ? "border-emerald-500/20 bg-emerald-500/10"
          : tone === "info"
            ? "border-cyan-500/20 bg-cyan-500/10"
            : "border-white/10 bg-black/20";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function Badge({
  children,
  tone = "normal",
}: {
  children: ReactNode;
  tone?: "normal" | "warning" | "danger" | "success" | "info" | "muted";
}) {
  const className =
    tone === "danger"
      ? "bg-red-500/10 text-red-100"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-100"
        : tone === "success"
          ? "bg-emerald-500/10 text-emerald-100"
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

function InfoBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-1 text-sm font-medium leading-5 text-white/75">
        {value || "-"}
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

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-sm text-white/60 transition hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
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

function LoadingState({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-center ${
        compact ? "min-h-[240px]" : "min-h-[420px]"
      }`}
    >
      <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/50">
        <Loader2 className="animate-spin" size={18} />
        {text}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-6 text-center ${
        compact ? "min-h-[240px]" : "min-h-[420px]"
      }`}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white/[0.06] text-white/40">
        {icon}
      </div>

      <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em]">{title}</h3>

      <p className="mt-2 max-w-sm text-sm leading-6 text-white/38">
        {description}
      </p>
    </div>
  );
}