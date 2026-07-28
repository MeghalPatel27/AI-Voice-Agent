import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  Clock3,
  Loader2,
  PhoneCall,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { apiFetch } from "./lib/api";
import { isLiveCallStatus } from "./lib/postCallAnalysis";
import {
  isActiveScheduledCallNotesStatus,
  isActiveTaskStatus,
  useBoundedLivePoll,
} from "./lib/livePoll";

type TaskStatus = "OPEN" | "DOING" | "BLOCKED" | "DONE";
type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type AiCallLanguage = "AUTO" | "ENGLISH" | "HINDI" | "GUJARATI";
const COLLECTION_GOAL_MAX_LENGTH = 1200;
const EXTRA_NOTES_MAX_LENGTH = 2000;
const CALL_PURPOSE_MAX_LENGTH = 200;

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
  description: string;
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
    relatedCallId?: string | null;
    latestCallStatus?: string | null;
    transcriptSyncStatus?: string | null;
    expressionAnalysisStatus?: string | null;
    recordingReconstructionStatus?: string | null;
    analysisStatus?: string | null;
    error?: string | null;
    meetingTime?: string | null;
  } | null;
  leadRequirements?: {
    summary: string;
    raw?: string[];
    meetingTime?: string | null;
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

type TaskTypeOption = {
  key: string;
  label: string;
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
  todayFocus: TaskRow[];
  teamMembers: TeamMember[];
  taskTypes: TaskTypeOption[];
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
  { label: "Critical", value: "CRITICAL" },
  { label: "Blocked", value: "BLOCKED" },
  { label: "Open", value: "OPEN" },
  { label: "Doing", value: "DOING" },
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

export default function TasksPage() {
  const [searchParams] = useSearchParams();

  const [filter, setFilter] = useState<Filter>("ALL");
  const [priority, setPriority] = useState<"ALL" | Priority>("ALL");
  const [assignee, setAssignee] = useState(
    () => searchParams.get("assignee") || "ALL"
  );
  const [taskType, setTaskType] = useState("ALL");
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
  const [todayFocus, setTodayFocus] = useState<TaskRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskTypeOption[]>([]);

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
  const [aiCallCollectionGoal, setAiCallCollectionGoal] = useState(
    "Call this lead, collect website/software requirements, ask budget and timeline, then create a meeting request.",
  );
  const [aiCallPurpose, setAiCallPurpose] = useState("");
  const [aiCallExtraNotes, setAiCallExtraNotes] = useState("");
  const [aiCallTimezone, setAiCallTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
  );
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
    setDraftDescription(task.description || "");
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

  const loadTasks = useCallback(async (nextSelectedId?: string, options?: { silent?: boolean }) => {
    try {
      setError("");
      if (!options?.silent) {
        setLoading(true);
      }

      const params = new URLSearchParams({
        filter,
        priority,
        assignee,
        taskType,
      });

      if (search.trim()) {
        params.set("search", search.trim());
      }

      const data = await apiFetch<TaskResponse>(
        `/api/tasks/operations?${params.toString()}`,
      );

      setSummary(data.summary);
      setTasks(data.tasks);
      setTodayFocus(data.todayFocus);
      setTeamMembers(data.teamMembers);
      setTaskTypes(data.taskTypes);

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
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [filter, priority, assignee, taskType, search]);

  const hasActiveLifecycle = useMemo(
    () =>
      tasks.some(
        (task) =>
          isActiveTaskStatus(task.status) ||
          isActiveScheduledCallNotesStatus(task.scheduledCall?.status) ||
          isLiveCallStatus(task.scheduledCall?.latestCallStatus),
      ),
    [tasks],
  );

  useBoundedLivePoll(hasActiveLifecycle, () => loadTasks(undefined, { silent: true }), 4000);

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

    if (!aiCallPhone.trim() || !aiCallAt || !aiCallCollectionGoal.trim()) return;

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
            timezone: aiCallTimezone,
            collectionGoal: aiCallCollectionGoal.trim(),
            callPurpose: aiCallPurpose.trim() || null,
            extraNotes: aiCallExtraNotes.trim() || null,
            preferredLanguage: aiCallLanguage,
            priority: aiCallPriority,
          }),
        },
      );

      setAiCallName("");
      setAiCallPhone("");
      setAiCallAt("");
      setAiCallCollectionGoal(
        "Call this lead, collect website/software requirements, ask budget and timeline, then create a meeting request.",
      );
      setAiCallPurpose("");
      setAiCallExtraNotes("");
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

      await apiFetch(`/api/tasks/${selectedTask.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: draftTitle,
          description: draftDescription || null,
          assignedUserId: draftAssignedUserId || null,
          owner: draftAssignedUserId ? null : draftManualOwner || null,
          dueAt: fromDateInput(draftDueAt),
          priority: draftPriority,
          status: draftStatus,
          aiNotes: draftAiNotes || null,
          blockedReason: draftBlockedReason || null,
        }),
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
    <section className="space-y-5">
      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-cyan-200">
              <CheckCircle2 size={14} />
              Work Execution
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
              Tasks
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
              Create work, assign owners, set deadlines, handle blockers,
              complete tasks, and track what must be done today.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowAiCall((value) => !value)}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/[0.10] px-5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/[0.16]"
            >
              <PhoneCall size={16} />
              Schedule AI Call
            </button>

            <button
              onClick={() => setShowCreate((value) => !value)}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black"
            >
              <Plus size={16} />
              Create Task
            </button>

            <button
              onClick={() => loadTasks()}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/70 hover:text-white"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4 xl:grid-cols-10">
          <SummaryCard label="Total" value={summary.total} />
          <SummaryCard label="Open" value={summary.open} />
          <SummaryCard label="Doing" value={summary.doing} tone="info" />
          <SummaryCard
            label="Due Today"
            value={summary.dueToday}
            tone={summary.dueToday > 0 ? "warning" : "normal"}
          />
          <SummaryCard
            label="Overdue"
            value={summary.overdue}
            tone={summary.overdue > 0 ? "danger" : "normal"}
          />
          <SummaryCard
            label="Unassigned"
            value={summary.unassigned}
            tone={summary.unassigned > 0 ? "warning" : "normal"}
          />
          <SummaryCard
            label="Blocked"
            value={summary.blocked}
            tone={summary.blocked > 0 ? "danger" : "normal"}
          />
          <SummaryCard
            label="Critical"
            value={summary.critical}
            tone={summary.critical > 0 ? "danger" : "normal"}
          />
          <SummaryCard
            label="Done Today"
            value={summary.completedToday}
            tone="success"
          />
          <SummaryCard
            label="Completion"
            value={`${summary.completionRate}%`}
            tone="info"
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
          collectionGoal={aiCallCollectionGoal}
          callPurpose={aiCallPurpose}
          extraNotes={aiCallExtraNotes}
          timezone={aiCallTimezone}
          preferredLanguage={aiCallLanguage}
          priority={aiCallPriority}
          saving={saving === "ai-call"}
          setFullName={setAiCallName}
          setPhone={setAiCallPhone}
          setScheduledAt={setAiCallAt}
          setCollectionGoal={setAiCallCollectionGoal}
          setCallPurpose={setAiCallPurpose}
          setExtraNotes={setAiCallExtraNotes}
          setTimezone={setAiCallTimezone}
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

      {todayFocus.length > 0 ? (
        <section className="rounded-[34px] border border-amber-500/20 bg-amber-500/10 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <AlertTriangle size={18} />
            Today’s Execution Focus
          </div>

          <p className="mt-2 text-sm text-amber-100/65">
            These tasks are urgent because they are overdue, unassigned,
            blocked, critical, emergency, or due today.
          </p>

          <div className="mt-5 grid gap-3 xl:grid-cols-4">
            {todayFocus.map((task) => (
              <button
                key={task.id}
                onClick={() => selectTask(task)}
                className="rounded-[26px] border border-amber-500/20 bg-black/20 p-4 text-left transition hover:bg-black/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 font-semibold text-amber-50">
                    {task.title}
                  </p>
                  {task.isEmergency ? (
                    <Zap size={18} className="shrink-0 text-red-100" />
                  ) : null}
                </div>

                <p className="mt-3 line-clamp-2 text-sm leading-6 text-amber-100/70">
                  {task.nextAction}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone={getPriorityTone(task.priority)}>
                    {formatEnum(task.priority)}
                  </Badge>
                  <Badge tone={task.isUnassigned ? "warning" : "normal"}>
                    {task.ownerLabel}
                  </Badge>
                  <Badge tone={task.isOverdue ? "danger" : "normal"}>
                    {task.dueLabel}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
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

        <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_220px_240px_240px]">
          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={17} className="text-white/30" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search task, customer, owner, AI reason..."
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>

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
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
            className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
          >
            <option value="ALL" className="bg-[#05070d]">
              All task types
            </option>
            {taskTypes.map((item) => (
              <option key={item.key} value={item.key} className="bg-[#05070d]">
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
        <section className="rounded-[34px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em]">
                Work Queue
              </h2>
              <p className="mt-1 text-sm text-white/40">
                Execute tasks. People management belongs in Team.
              </p>
            </div>

            <p className="text-sm text-white/35">
              {tasks.length} task{tasks.length === 1 ? "" : "s"}
            </p>
          </div>

          {loading ? (
            <LoadingState text="Loading tasks..." />
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={34} />}
              title="No tasks found"
              description="Tasks will appear here when AI, staff or managers create work."
            />
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  active={selectedId === task.id}
                  onClick={() => selectTask(task)}
                />
              ))}
            </div>
          )}
        </section>

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
      </div>
    </section>
  );
}

function ScheduleAiCallForm(props: {
  fullName: string;
  phone: string;
  scheduledAt: string;
  collectionGoal: string;
  callPurpose: string;
  extraNotes: string;
  timezone: string;
  preferredLanguage: AiCallLanguage;
  priority: Priority;
  saving: boolean;
  setFullName: (value: string) => void;
  setPhone: (value: string) => void;
  setScheduledAt: (value: string) => void;
  setCollectionGoal: (value: string) => void;
  setCallPurpose: (value: string) => void;
  setExtraNotes: (value: string) => void;
  setTimezone: (value: string) => void;
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
            Create a task for AI to call this person at the selected time, speak
            in the selected language, collect requirements, and create a meeting
            request from the call.
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

        <Field label="WhatsApp / call number">
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

        <Field label="Timezone">
          <Input
            value={props.timezone}
            onChange={props.setTimezone}
            placeholder="Asia/Kolkata"
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

        <div className="xl:col-span-4">
          <Field label="What should AI collect? *">
            <p className="mb-2 text-xs text-white/40">
              This becomes the objective for this specific call. Describe the information the calling assistant should gather.
            </p>
            <textarea
              value={props.collectionGoal}
              onChange={(event) => props.setCollectionGoal(event.target.value)}
              maxLength={COLLECTION_GOAL_MAX_LENGTH}
              placeholder="Collect requirement, budget, timeline, preferred meeting time..."
              className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
            />
            <p className="mt-2 text-xs text-white/35">
              {props.collectionGoal.length}/{COLLECTION_GOAL_MAX_LENGTH}
            </p>
          </Field>
        </div>

        <div className="xl:col-span-2">
          <Field label="Short call purpose (optional)">
            <textarea
              value={props.callPurpose}
              onChange={(event) => props.setCallPurpose(event.target.value)}
              maxLength={CALL_PURPOSE_MAX_LENGTH}
              placeholder="Follow up on earlier website inquiry"
              className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
            />
            <p className="mt-2 text-xs text-white/35">
              {props.callPurpose.length}/{CALL_PURPOSE_MAX_LENGTH}
            </p>
          </Field>
        </div>

        <div className="xl:col-span-2">
          <Field label="Extra notes for AI">
            <p className="mb-2 text-xs text-white/40">
              Private background context for the calling assistant. These notes are not intended to be read aloud to the customer.
            </p>
            <textarea
              value={props.extraNotes}
              onChange={(event) => props.setExtraNotes(event.target.value)}
              maxLength={EXTRA_NOTES_MAX_LENGTH}
              placeholder="Mention context, product, lead source, budget hint, meeting constraints..."
              className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
            />
            <p className="mt-2 text-xs text-white/35">
              {props.extraNotes.length}/{EXTRA_NOTES_MAX_LENGTH}
            </p>
          </Field>
        </div>
      </div>

      <button
        disabled={
          props.saving ||
          !props.phone.trim() ||
          !props.scheduledAt ||
          !props.collectionGoal.trim()
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
          <Field label="AI reason / manager note">
            <textarea
              value={props.aiNotes}
              onChange={(event) => props.setAiNotes(event.target.value)}
              placeholder="Why this task exists..."
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
  const serious =
    task.isEmergency || task.isOverdue || task.priority === "CRITICAL";

  return (
    <button
      onClick={onClick}
      className={`relative w-full overflow-hidden rounded-[28px] border p-5 text-left transition ${
        active
          ? "border-cyan-200/70 bg-cyan-400/[0.08] shadow-[0_24px_90px_rgba(34,211,238,0.10)]"
          : serious
            ? "border-red-500/20 bg-red-500/[0.05] hover:bg-red-500/[0.08]"
            : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
      }`}
    >
      {active ? (
        <div className="absolute bottom-0 left-0 top-0 w-1 bg-cyan-200" />
      ) : null}

      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-[-0.03em]">
              {task.title}
            </h3>

            <Badge tone={getStatusTone(task.status)}>
              {formatEnum(task.status)}
            </Badge>

            <Badge tone={getPriorityTone(task.priority)}>
              {formatEnum(task.priority)}
            </Badge>

            {task.isEmergency ? <Badge tone="danger">Emergency</Badge> : null}
          </div>

          <p className="mt-2 text-sm text-white/42">
            {task.taskTypeLabel} · {task.source} · Updated{" "}
            {formatTime(task.updatedAt)}
          </p>

          <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/58">
            {task.description || task.aiNotes}
          </p>

          <div className="mt-5 grid gap-2 md:grid-cols-2">
            <SmallLine label="Customer" value={task.customerName} />
            <SmallLine label="Owner" value={task.ownerLabel} />
            <SmallLine label="Due" value={task.dueLabel} />
            <SmallLine label="SLA" value={task.slaLabel} />
          </div>

          {task.warnings.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {task.warnings.map((warning) => (
                <Badge key={warning} tone="danger">
                  {warning}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-[24px] border border-white/10 bg-black/25 p-4 xl:w-[310px]">
          <p className="text-xs text-white/35">Next action</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/78">
            {task.nextAction}
          </p>

          <div className="mt-4 flex items-center gap-2 text-xs text-white/35">
            <CalendarClock size={14} />
            {task.delayLabel}
          </div>
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
      <aside className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6">
        <EmptyState
          icon={<CheckCircle2 size={34} />}
          title="Select a task"
          description="Task execution details, assignment, deadline and actions will appear here."
        />
      </aside>
    );
  }

  return (
    <aside className="h-fit space-y-5 rounded-[34px] border border-white/10 bg-white/[0.04] p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-[-0.05em]">
            Execute Task
          </h2>

          {props.task.isEmergency ? (
            <Badge tone="danger">Emergency</Badge>
          ) : null}
        </div>

        <p className="mt-2 text-sm leading-6 text-white/42">
          Change owner, deadline, priority, status, blockers and completion.
        </p>
      </div>

      {props.task.warnings.length > 0 ? (
        <div className="rounded-[26px] border border-red-500/20 bg-red-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-100">
            <ShieldAlert size={16} />
            Execution risk
          </div>

          <div className="mt-3 space-y-2">
            {props.task.warnings.map((warning) => (
              <p key={warning} className="text-sm text-red-100/75">
                {warning}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <PanelBlock title="Task Context" icon={<Sparkles size={16} />}>
        <div className="grid grid-cols-2 gap-3">
          <InfoBox label="Type" value={props.task.taskTypeLabel} />
          <InfoBox label="Source" value={props.task.source} />
          <InfoBox label="Customer" value={props.task.customerName} />
          <InfoBox label="SLA" value={props.task.slaLabel} />
          <InfoBox label="Due" value={props.task.dueLabel} />
          <InfoBox label="Delay" value={props.task.delayLabel} />
        </div>
      </PanelBlock>

      {props.task.scheduledCall ? (
        <PanelBlock title="AI Scheduled Call" icon={<PhoneCall size={16} />}>
          <div className="rounded-[24px] border border-cyan-500/20 bg-cyan-500/10 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-100/55">
              Call time
            </p>
            <p className="mt-2 text-lg font-semibold leading-7 text-cyan-50">
              {props.task.scheduledCall.scheduledLabel || props.task.dueLabel}
            </p>
            <p className="mt-2 text-sm leading-6 text-cyan-100/60">
              AI will call {props.task.scheduledCall.phone || props.task.customerPhone || "the customer"} and collect requirements.
            </p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <InfoBox
              label="Call status"
              value={formatEnum(
                props.task.scheduledCall.latestCallStatus ||
                  props.task.scheduledCall.status ||
                  "SCHEDULED",
              )}
            />
            <InfoBox label="Language" value={formatEnum(props.task.scheduledCall.preferredLanguage || "AUTO")} />
            <InfoBox label="Phone" value={props.task.scheduledCall.phone || props.task.customerPhone || "No phone"} />
            <InfoBox
              label="Related call"
              value={
                props.task.scheduledCall.relatedCallId ||
                props.task.scheduledCall.callSid ||
                "Not started yet"
              }
            />
            <InfoBox label="Purpose" value={props.task.scheduledCall.purpose || props.task.description || "Collect requirements"} />
            <InfoBox label="Meeting time" value={props.task.scheduledCall.meetingTime || props.task.leadRequirements?.meetingTime || "Not captured yet"} />
          </div>
          {(props.task.scheduledCall.analysisStatus ||
            props.task.scheduledCall.transcriptSyncStatus ||
            props.task.scheduledCall.recordingReconstructionStatus) && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <InfoBox
                label="Transcript"
                value={formatEnum(props.task.scheduledCall.transcriptSyncStatus || "PENDING")}
              />
              <InfoBox
                label="Analysis"
                value={formatEnum(props.task.scheduledCall.analysisStatus || "NONE")}
              />
              <InfoBox
                label="Recording"
                value={formatEnum(
                  props.task.scheduledCall.recordingReconstructionStatus || "NOT_REQUESTED",
                )}
              />
            </div>
          )}

          {props.task.scheduledCall.error ? (
            <p className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100">
              {props.task.scheduledCall.error}
            </p>
          ) : null}
        </PanelBlock>
      ) : null}

      {props.task.leadRequirements ? (
        <PanelBlock title="Lead Requirements" icon={<FileText size={16} />}>
          <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-white/30">
              Collected by {props.task.leadRequirements.source || props.task.source}
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/68">
              {props.task.leadRequirements.summary}
            </p>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <InfoBox label="Meeting requested" value={props.task.leadRequirements.meetingTime || "Not captured yet"} />
            <InfoBox label="Requirement status" value={props.task.leadRequirements.captured ? "Captured" : "Waiting for AI call"} />
          </div>
        </PanelBlock>
      ) : null}

      <PanelBlock title="Execution Actions" icon={<Zap size={16} />}>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton
            onClick={props.onStart}
            disabled={Boolean(props.saving)}
          >
            Start
          </ActionButton>
          <ActionButton
            onClick={props.onBlock}
            disabled={Boolean(props.saving)}
          >
            Block
          </ActionButton>
          <ActionButton onClick={props.onDone} disabled={Boolean(props.saving)}>
            Done
          </ActionButton>
          <ActionButton
            onClick={props.onEscalate}
            disabled={Boolean(props.saving)}
          >
            Escalate
          </ActionButton>
          <ActionButton
            onClick={props.onReopen}
            disabled={Boolean(props.saving)}
          >
            Reopen
          </ActionButton>
          <ActionButton
            onClick={props.onFollowUp}
            disabled={Boolean(props.saving)}
          >
            Follow-up
          </ActionButton>
        </div>

        <button
          type="button"
          onClick={props.onRemove}
          disabled={Boolean(props.saving)}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {props.saving === "delete" ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <Trash2 size={16} />
          )}
          Remove Task
        </button>
      </PanelBlock>

      <form onSubmit={props.onSave} className="space-y-4">
        <Field label="Task name">
          <Input value={props.draftTitle} onChange={props.setDraftTitle} />
        </Field>

        <Field label="Owner">
          <div className="grid gap-3 md:grid-cols-2">
            <select
              value={props.draftAssignedUserId}
              onChange={(event) =>
                props.setDraftAssignedUserId(event.target.value)
              }
              className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
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

            <Input
              value={props.draftManualOwner}
              onChange={props.setDraftManualOwner}
              placeholder="Manual owner"
              disabled={Boolean(props.draftAssignedUserId)}
            />
          </div>
        </Field>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Deadline">
            <input
              type="datetime-local"
              value={props.draftDueAt}
              onChange={(event) => props.setDraftDueAt(event.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            />
          </Field>

          <Field label="Priority">
            <select
              value={props.draftPriority}
              onChange={(event) =>
                props.setDraftPriority(event.target.value as Priority)
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

          <Field label="Status">
            <select
              value={props.draftStatus}
              onChange={(event) =>
                props.setDraftStatus(event.target.value as TaskStatus)
              }
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
            >
              <option value="OPEN" className="bg-[#05070d]">
                Open
              </option>
              <option value="DOING" className="bg-[#05070d]">
                Doing
              </option>
              <option value="BLOCKED" className="bg-[#05070d]">
                Blocked
              </option>
              <option value="DONE" className="bg-[#05070d]">
                Done
              </option>
            </select>
          </Field>
        </div>

        <Field label="Task details">
          <textarea
            value={props.draftDescription}
            onChange={(event) => props.setDraftDescription(event.target.value)}
            className="min-h-[110px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none"
          />
        </Field>

        <Field label="AI reason / note">
          <textarea
            value={props.draftAiNotes}
            onChange={(event) => props.setDraftAiNotes(event.target.value)}
            className="min-h-[110px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none"
          />
        </Field>

        <Field label="Blocked reason">
          <textarea
            value={props.draftBlockedReason}
            onChange={(event) =>
              props.setDraftBlockedReason(event.target.value)
            }
            placeholder="Required when task is blocked..."
            className="min-h-[90px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25"
          />
        </Field>

        <button
          disabled={props.saving === "save"}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {props.saving === "save" ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <Save size={16} />
          )}
          Save Task
        </button>
      </form>

      <PanelBlock title="Activity Timeline" icon={<Clock3 size={16} />}>
        {props.task.timeline.length === 0 ? (
          <p className="text-sm text-white/40">No timeline yet.</p>
        ) : (
          <div className="space-y-3">
            {props.task.timeline.map((item, index) => (
              <div
                key={`${item.title}-${index}`}
                className="border-l border-white/10 pl-3"
              >
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/38">
                  {item.description}
                </p>
                {item.recordingMediaUrl ? (
                  <p className="mt-1 text-[11px] text-cyan-100/60">
                    Recording available in Calls.
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] text-white/25">
                  {formatTime(item.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </PanelBlock>
    </aside>
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

function SmallLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-white/75">
        {value || "-"}
      </p>
    </div>
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

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center">
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
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
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