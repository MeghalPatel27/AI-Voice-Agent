import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  PhoneCall,
  Plus,
  RefreshCw,
  Save,
  Search,
  UserRound,
  XCircle,
} from "lucide-react";
import { useAuth } from "./auth/AuthContext";
import { Panel, TranscriptPanel } from "./components/TranscriptPanel";
import { apiFetch } from "./lib/api";
import {
  bookingLifecycleLabel,
  formatDateTime,
  formatEnum,
  isUpcomingBooking,
  type BookingOutcome,
  type BookingRecord,
  type BookingStatus,
  type CustomerRef,
  type TeamUserRef,
} from "./types/crm";

type BookingsSummary = {
  total: number;
  requested: number;
  confirmed: number;
  cancelled: number;
  completed: number;
  noShow?: number;
  withRecording?: number;
  aiCallRequests?: number;
};

type BookingsResponse = {
  bookings: BookingRecord[];
  summary: BookingsSummary;
};

type BookingMutationResponse = {
  message: string;
  booking: BookingRecord;
};

type TeamOverviewMember = {
  id: string;
  type: "USER" | "UNASSIGNED" | "MANUAL" | string;
  name: string;
  email: string | null;
  isActive: boolean;
};

type TeamOverviewResponse = {
  members: TeamOverviewMember[];
};

const STATUS_FILTERS: Array<{ label: string; value: "ALL" | BookingStatus }> = [
  { label: "All status", value: "ALL" },
  { label: "Requested", value: "REQUESTED" },
  { label: "Confirmed", value: "CONFIRMED" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "Completed", value: "COMPLETED" },
  { label: "No show", value: "NO_SHOW" },
];

const OUTCOME_OPTIONS: BookingOutcome[] = [
  "PENDING",
  "WON",
  "LOST",
  "FOLLOW_UP",
];

export default function BookingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [summary, setSummary] = useState<BookingsSummary>({
    total: 0,
    requested: 0,
    confirmed: 0,
    cancelled: 0,
    completed: 0,
    noShow: 0,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamUserRef[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | BookingStatus>("ALL");

  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [bannerMessage, setBannerMessage] = useState("");

  const selectedBooking = useMemo(
    () => bookings.find((booking) => booking.id === selectedId) ?? null,
    [bookings, selectedId],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await apiFetch<TeamOverviewResponse>("/api/team/overview");
        if (cancelled) return;

        const assignees = data.members
          .filter((member) => member.type === "USER" && member.isActive)
          .map((member) => ({
            id: member.id,
            name: member.name,
            email: member.email || "",
          }));

        setTeamMembers(assignees);
      } catch {
        if (!cancelled) setTeamMembers([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setListError("");
          setLoading(true);

          const params = new URLSearchParams();
          if (statusFilter !== "ALL") params.set("status", statusFilter);
          if (search.trim()) params.set("search", search.trim());

          const query = params.toString();
          const data = await apiFetch<BookingsResponse>(
            `/api/bookings${query ? `?${query}` : ""}`,
          );

          if (cancelled) return;

          setBookings(data.bookings);
          setSummary(data.summary);

          setSelectedId((current) => {
            if (current && data.bookings.some((booking) => booking.id === current)) {
              return current;
            }
            return data.bookings[0]?.id ?? null;
          });
        } catch (err) {
          if (!cancelled) {
            setListError(
              err instanceof Error ? err.message : "Failed to load meetings",
            );
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, statusFilter]);

  async function refreshBookings(nextSelectedId?: string) {
    try {
      setListError("");

      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());

      const query = params.toString();
      const data = await apiFetch<BookingsResponse>(
        `/api/bookings${query ? `?${query}` : ""}`,
      );

      setBookings(data.bookings);
      setSummary(data.summary);

      const targetId =
        nextSelectedId ||
        selectedId ||
        data.bookings[0]?.id ||
        null;

      if (targetId && data.bookings.some((booking) => booking.id === targetId)) {
        setSelectedId(targetId);
      } else {
        setSelectedId(data.bookings[0]?.id ?? null);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to refresh meetings");
      throw err;
    }
  }

  async function handleCreated(bookingId: string) {
    setBannerMessage("Meeting created.");
    setShowCreate(false);
    await refreshBookings(bookingId);
  }

  async function handleUpdated(bookingId: string, message?: string) {
    if (message) setBannerMessage(message);
    await refreshBookings(bookingId);
  }

  return (
    <section className="grid h-[calc(100vh-112px)] min-h-[680px] gap-4 xl:grid-cols-[430px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        <div className="shrink-0 border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.04em]">Meetings</h1>
              <p className="mt-1 text-sm text-white/40">
                AI-scheduled and manual meeting requests
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Create meeting"
                onClick={() => setShowCreate((current) => !current)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
              >
                <Plus size={18} aria-hidden />
              </button>

              <button
                type="button"
                aria-label="Refresh meetings"
                onClick={() => void refreshBookings()}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
              >
                <RefreshCw size={18} aria-hidden />
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            <MiniCount label="Total" value={summary.total} />
            <MiniCount label="Req" value={summary.requested} />
            <MiniCount label="Conf" value={summary.confirmed} />
            <MiniCount label="Done" value={summary.completed} />
          </div>

          <label className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={18} className="text-white/35" aria-hidden />
            <span className="sr-only">Search meetings</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search meetings..."
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-white/25 focus-visible:outline-none"
            />
          </label>

          <label className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
            <Filter size={16} className="text-white/35" aria-hidden />
            <span className="sr-only">Filter by status</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "ALL" | BookingStatus)
              }
              className="h-11 w-full bg-transparent text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              {STATUS_FILTERS.map((item) => (
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

          {showCreate ? (
            <CreateMeetingForm
              teamMembers={teamMembers}
              onCreated={handleCreated}
              onCancel={() => setShowCreate(false)}
            />
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div
              className="flex h-full items-center justify-center gap-2 text-sm text-white/40"
              role="status"
              aria-live="polite"
            >
              <Loader2 size={16} className="animate-spin" aria-hidden />
              Loading meetings...
            </div>
          ) : listError ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <AlertTriangle size={28} className="text-red-300/70" aria-hidden />
              <p className="mt-4 text-sm leading-6 text-red-100">{listError}</p>
              <button
                type="button"
                onClick={() => void refreshBookings()}
                className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-2 text-sm text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
              >
                Try again
              </button>
            </div>
          ) : bookings.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <CalendarCheck size={30} className="text-white/35" aria-hidden />
              <h2 className="mt-4 text-lg font-semibold">No meetings yet</h2>
              <p className="mt-2 text-sm leading-6 text-white/40">
                AI-created appointment and site-visit requests will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2" role="list" aria-label="Meetings">
              {bookings.map((booking) => (
                <MeetingListCard
                  key={booking.id}
                  booking={booking}
                  selected={selectedId === booking.id}
                  onSelect={() => setSelectedId(booking.id)}
                  onOpenCall={(conversationId) =>
                    navigate(`/calls?c=${encodeURIComponent(conversationId)}`)
                  }
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        {!selectedBooking ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <CalendarCheck size={34} className="text-white/35" aria-hidden />
            <h2 className="mt-5 text-2xl font-semibold">Select a meeting</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-white/40">
              Choose a meeting to review ownership, acceptance, notes, and outcome.
            </p>
          </div>
        ) : (
          <MeetingEditor
            key={selectedBooking.id}
            booking={selectedBooking}
            teamMembers={teamMembers}
            currentUserId={user?.id ?? null}
            bannerMessage={bannerMessage}
            onClearBanner={() => setBannerMessage("")}
            onUpdated={handleUpdated}
            onOpenCall={(conversationId) =>
              navigate(`/calls?c=${encodeURIComponent(conversationId)}`)
            }
          />
        )}
      </main>
    </section>
  );
}

function MeetingListCard({
  booking,
  selected,
  onSelect,
  onOpenCall,
}: {
  booking: BookingRecord;
  selected: boolean;
  onSelect: () => void;
  onOpenCall: (conversationId: string) => void;
}) {
  const customer = resolveCustomer(booking);
  const lifecycle = bookingLifecycleLabel(
    booking.status,
    booking.acceptanceStatus,
    booking.outcome,
  );
  const upcoming = isUpcomingBooking(booking);
  const callLinkId = booking.conversationId || booking.callId || null;

  return (
    <button
      type="button"
      role="listitem"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={`w-full rounded-3xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
        selected
          ? "border-white/20 bg-white/[0.08]"
          : "border-white/10 bg-black/15 hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-1 text-sm font-semibold">{booking.title}</p>
          <p className="mt-1 truncate text-xs text-white/35">
            {customer?.fullName || customer?.phone || "No customer linked"}
          </p>
          {customer?.businessType ? (
            <p className="mt-1 truncate text-xs text-white/30">
              {customer.businessType}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <TextBadge label={`Status: ${formatEnum(booking.status)}`} />
          {booking.acceptanceStatus ? (
            <TextBadge
              label={`Acceptance: ${formatEnum(booking.acceptanceStatus)}`}
            />
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-sm text-white/50">
        {booking.dateTime
          ? `${formatDateTime(booking.dateTime, booking.timezone)}${
              booking.timezone ? ` (${booking.timezone})` : ""
            }`
          : "No date/time set"}
      </p>

      <p className="mt-2 text-xs text-white/40">
        Assigned: {booking.assignedUser?.name || "Unassigned"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TextBadge
          label={
            upcoming
              ? "Upcoming"
              : booking.status === "CANCELLED"
                ? "Cancelled"
                : booking.status === "COMPLETED" || booking.status === "NO_SHOW"
                  ? "Completed"
                  : lifecycle
          }
        />
        {callLinkId ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (booking.conversationId) onOpenCall(booking.conversationId);
            }}
            className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            {booking.conversationId
              ? `Call ${booking.conversationId.slice(0, 8)}…`
              : "Related call"}
          </button>
        ) : null}
      </div>
    </button>
  );
}

function MeetingEditor({
  booking,
  teamMembers,
  currentUserId,
  bannerMessage,
  onClearBanner,
  onUpdated,
  onOpenCall,
}: {
  booking: BookingRecord;
  teamMembers: TeamUserRef[];
  currentUserId: string | null;
  bannerMessage: string;
  onClearBanner: () => void;
  onUpdated: (bookingId: string, message?: string) => Promise<void>;
  onOpenCall: (conversationId: string) => void;
}) {
  const customer = resolveCustomer(booking);

  const [notes, setNotes] = useState(booking.notes || "");
  const [nextAction, setNextAction] = useState(booking.nextAction || "");
  const [outcome, setOutcome] = useState<BookingOutcome>(
    (booking.outcome as BookingOutcome) || "PENDING",
  );
  const [assignedUserId, setAssignedUserId] = useState(
    booking.assignedUserId || "",
  );
  const [proposalSent, setProposalSent] = useState(Boolean(booking.proposalSent));
  const [dateTimeLocal, setDateTimeLocal] = useState(
    toDateTimeLocalValue(booking.dateTime),
  );
  const [timezone, setTimezone] = useState(booking.timezone || "");

  const [savingField, setSavingField] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canAccept =
    currentUserId === booking.assignedUserId &&
    booking.acceptanceStatus === "PENDING_ACCEPTANCE";

  const aiSummary =
    booking.conversation?.aiSummary ||
    booking.latestCall?.summary ||
    booking.conversation?.lastMessage ||
    null;

  const requirements =
    customer?.requirementSummary ||
    booking.conversation?.aiSummary ||
    booking.latestCall?.summary ||
    booking.computedTranscript?.slice(0, 400) ||
    null;

  const lifecycle = bookingLifecycleLabel(
    booking.status,
    booking.acceptanceStatus,
    booking.outcome,
  );

  const terminalStatus =
    booking.status === "CANCELLED" ||
    booking.status === "COMPLETED" ||
    booking.status === "NO_SHOW";

  async function patchBooking(
    payload: Record<string, unknown>,
    fieldKey: string,
    successMessage?: string,
  ) {
    try {
      setSavingField(fieldKey);
      setError("");
      setSuccess("");
      onClearBanner();

      await apiFetch<BookingMutationResponse>(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (successMessage) setSuccess(successMessage);
      await onUpdated(booking.id, successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update meeting");
    } finally {
      setSavingField(null);
    }
  }

  async function updateStatus(nextStatus: BookingStatus) {
    try {
      setStatusUpdating(true);
      setError("");
      setSuccess("");
      onClearBanner();

      await apiFetch<BookingMutationResponse>(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });

      const label = `Meeting marked as ${formatEnum(nextStatus)}.`;
      setSuccess(label);
      await onUpdated(booking.id, label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setStatusUpdating(false);
    }
  }

  async function acceptMeeting() {
    if (!canAccept || accepting) return;

    try {
      setAccepting(true);
      setError("");
      setSuccess("");
      onClearBanner();

      await apiFetch<BookingMutationResponse>(
        `/api/bookings/${booking.id}/accept`,
        { method: "POST" },
      );

      const label = "Meeting accepted.";
      setSuccess(label);
      await onUpdated(booking.id, label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept meeting");
    } finally {
      setAccepting(false);
    }
  }

  async function saveNotes(event: FormEvent) {
    event.preventDefault();
    await patchBooking({ notes }, "notes", "Notes saved.");
  }

  async function saveNextAction(event: FormEvent) {
    event.preventDefault();
    await patchBooking({ nextAction }, "nextAction", "Next action saved.");
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault();
    await patchBooking(
      {
        dateTime: dateTimeLocal || null,
        timezone: timezone.trim() || null,
      },
      "schedule",
      "Meeting time saved.",
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-white/10 p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <TextBadge label={`Status: ${formatEnum(booking.status)}`} />
              {booking.acceptanceStatus ? (
                <TextBadge
                  label={`Acceptance: ${formatEnum(booking.acceptanceStatus)}`}
                />
              ) : null}
              <TextBadge label={lifecycle} />
              {isUpcomingBooking(booking) ? (
                <TextBadge label="Upcoming" />
              ) : null}
            </div>

            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
              {booking.title}
            </h2>

            <p className="mt-2 text-sm text-white/45">
              Created {formatDateTime(booking.createdAt)}
            </p>
          </div>

          {!terminalStatus ? (
            <div className="flex flex-wrap gap-2">
              {booking.status !== "CONFIRMED" ? (
                <StatusActionButton
                  label="Confirm meeting"
                  disabled={statusUpdating}
                  onClick={() => void updateStatus("CONFIRMED")}
                  tone="success"
                >
                  <CheckCircle2 size={16} aria-hidden />
                  Confirm
                </StatusActionButton>
              ) : null}

              <StatusActionButton
                label="Complete meeting"
                disabled={statusUpdating}
                onClick={() => void updateStatus("COMPLETED")}
                tone="primary"
              >
                <CalendarCheck size={16} aria-hidden />
                Complete
              </StatusActionButton>

              <StatusActionButton
                label="Mark no show"
                disabled={statusUpdating}
                onClick={() => void updateStatus("NO_SHOW")}
                tone="neutral"
              >
                <Clock3 size={16} aria-hidden />
                No show
              </StatusActionButton>

              <StatusActionButton
                label="Cancel meeting"
                disabled={statusUpdating}
                onClick={() => void updateStatus("CANCELLED")}
                tone="danger"
              >
                <XCircle size={16} aria-hidden />
                Cancel
              </StatusActionButton>
            </div>
          ) : null}
        </div>

        {(error || success || bannerMessage) && (
          <div className="mt-4 space-y-2" aria-live="polite">
            {error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            ) : null}
            {success || bannerMessage ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {success || bannerMessage}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <div className="space-y-5">
            <Panel title="Ownership & timing" icon={<CalendarCheck size={20} aria-hidden />}>
              <InfoRow
                label="Assigned employee"
                value={booking.assignedUser?.name || "Unassigned"}
              />
              <InfoRow
                label="Due / meeting time"
                value={
                  booking.dateTime
                    ? `${formatDateTime(booking.dateTime, booking.timezone)}${
                        booking.timezone ? ` (${booking.timezone})` : ""
                      }`
                    : "Not scheduled"
                }
              />
              <InfoRow label="Next action" value={booking.nextAction || "None set"} />
              <InfoRow label="Lifecycle" value={lifecycle} />

              <label className="mt-4 block">
                <span className="text-xs text-white/35">Reassign employee</span>
                <select
                  value={assignedUserId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setAssignedUserId(next);
                    void patchBooking(
                      { assignedUserId: next || null },
                      "assignedUserId",
                      "Assignee updated.",
                    );
                  }}
                  disabled={savingField === "assignedUserId"}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                >
                  <option value="" className="bg-[#05070d]">
                    Unassigned
                  </option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.id} className="bg-[#05070d]">
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>

              <form onSubmit={saveSchedule} className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-xs text-white/35">Meeting date/time</span>
                  <input
                    type="datetime-local"
                    value={dateTimeLocal}
                    onChange={(event) => setDateTimeLocal(event.target.value)}
                    className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-white/35">Timezone</span>
                  <input
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    placeholder="Asia/Kolkata"
                    className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingField === "schedule"}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 text-sm text-white/70 hover:text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                >
                  {savingField === "schedule" ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                  ) : (
                    <Save size={16} aria-hidden />
                  )}
                  Save schedule
                </button>
              </form>
            </Panel>

            <Panel title="Acceptance" icon={<UserRound size={20} aria-hidden />}>
              <InfoRow
                label="Acceptance status"
                value={formatEnum(booking.acceptanceStatus || "PENDING_ACCEPTANCE")}
              />
              {booking.acceptedAt ? (
                <InfoRow
                  label="Accepted at"
                  value={formatDateTime(booking.acceptedAt)}
                />
              ) : null}
              {booking.acceptedBy?.name ? (
                <InfoRow label="Accepted by" value={booking.acceptedBy.name} />
              ) : null}

              {canAccept ? (
                <button
                  type="button"
                  onClick={() => void acceptMeeting()}
                  disabled={accepting}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                >
                  {accepting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" aria-hidden />
                      Accepting...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} aria-hidden />
                      Accept meeting
                    </>
                  )}
                </button>
              ) : null}
            </Panel>

            <Panel title="Customer" icon={<UserRound size={20} aria-hidden />}>
              <InfoRow label="Name" value={customer?.fullName || "Unknown"} />
              <InfoRow label="Phone" value={customer?.phone || "-"} />
              <InfoRow label="Email" value={customer?.email || "-"} />
              {customer?.businessType ? (
                <InfoRow label="Business" value={customer.businessType} />
              ) : null}

              {booking.conversationId ? (
                <button
                  type="button"
                  onClick={() => onOpenCall(booking.conversationId!)}
                  className="mt-4 flex w-full items-center gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100 hover:bg-cyan-500/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                >
                  <PhoneCall size={16} aria-hidden />
                  Open related call ({booking.conversationId.slice(0, 10)}…)
                </button>
              ) : booking.callId ? (
                <p className="mt-4 text-sm text-white/45">
                  Linked call ID: {booking.callId}
                </p>
              ) : null}
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="AI call summary" icon={<Clock3 size={20} aria-hidden />}>
              <p className="text-sm leading-7 text-white/55">
                {aiSummary || "No AI summary available for this meeting."}
              </p>
            </Panel>

            <Panel
              title="Customer requirements"
              icon={<AlertTriangle size={20} aria-hidden />}
            >
              <p className="text-sm leading-7 text-white/55">
                {requirements || "No customer requirements captured yet."}
              </p>
            </Panel>

            <Panel title="Outcome & follow-up" icon={<CheckCircle2 size={20} aria-hidden />}>
              <label className="block">
                <span className="text-xs text-white/35">Outcome</span>
                <select
                  value={outcome}
                  aria-label="Outcome"
                  onChange={(event) => {
                    const next = event.target.value as BookingOutcome;
                    setOutcome(next);
                    void patchBooking({ outcome: next }, "outcome");
                  }}
                  disabled={savingField === "outcome"}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                >
                  {OUTCOME_OPTIONS.map((option) => (
                    <option key={option} value={option} className="bg-[#05070d]">
                      {formatEnum(option)}
                    </option>
                  ))}
                </select>
              </label>

              <form onSubmit={saveNextAction} className="mt-4">
                <label className="block">
                  <span className="text-xs text-white/35">Next action</span>
                  <textarea
                    value={nextAction}
                    onChange={(event) => setNextAction(event.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                    placeholder="What should happen next?"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingField === "nextAction"}
                  className="mt-3 flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/70 hover:text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                >
                  {savingField === "nextAction" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Save size={14} aria-hidden />
                  )}
                  Save next action
                </button>
              </form>

              <label className="mt-5 flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <input
                  type="checkbox"
                  checked={proposalSent}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setProposalSent(next);
                    void patchBooking(
                      { proposalSent: next },
                      "proposalSent",
                      next ? "Proposal marked as sent." : "Proposal marked as not sent.",
                    );
                  }}
                  disabled={savingField === "proposalSent"}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-black/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                />
                <span>
                  <span className="block text-sm font-medium text-white/75">
                    Proposal sent
                  </span>
                  <span className="mt-1 block text-xs text-white/40">
                    {booking.proposalSentAt
                      ? `Sent ${formatDateTime(booking.proposalSentAt)}`
                      : "Not marked as sent yet"}
                  </span>
                </span>
              </label>
            </Panel>

            <Panel title="Notes" icon={<Search size={20} aria-hidden />}>
              <form onSubmit={saveNotes}>
                <label className="block">
                  <span className="sr-only">Meeting notes</span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={5}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                    placeholder="Internal notes about this meeting..."
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingField === "notes"}
                  className="mt-3 flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/70 hover:text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                >
                  {savingField === "notes" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Save size={14} aria-hidden />
                  )}
                  Save notes
                </button>
              </form>
            </Panel>

            <TranscriptPanel
              title="Call transcript"
              raw={
                booking.computedTranscript ||
                booking.latestCall?.transcript ||
                booking.call?.transcript
              }
              messages={booking.conversation?.messages}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateMeetingForm({
  teamMembers,
  onCreated,
  onCancel,
}: {
  teamMembers: TeamUserRef[];
  onCreated: (bookingId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("Manual meeting request");
  const [dateTime, setDateTime] = useState("");
  const [timezone, setTimezone] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;

    try {
      setCreating(true);
      setError("");

      const data = await apiFetch<BookingMutationResponse>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          dateTime: dateTime || undefined,
          timezone: timezone.trim() || undefined,
          assignedUserId: assignedUserId || undefined,
          status: "REQUESTED",
        }),
      });

      await onCreated(data.booking.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create meeting");
    } finally {
      setCreating(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 rounded-3xl border border-white/10 bg-black/25 p-4"
    >
      <label className="block">
        <span className="text-xs text-white/35">Title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Meeting title"
          className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm outline-none placeholder:text-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-xs text-white/35">Date/time</span>
        <input
          value={dateTime}
          onChange={(event) => setDateTime(event.target.value)}
          type="datetime-local"
          className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-xs text-white/35">Timezone</span>
        <input
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          placeholder="Asia/Kolkata"
          className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm outline-none placeholder:text-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-xs text-white/35">Assign to</span>
        <select
          value={assignedUserId}
          onChange={(event) => setAssignedUserId(event.target.value)}
          className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          <option value="" className="bg-[#05070d]">
            Unassigned
          </option>
          {teamMembers.map((member) => (
            <option key={member.id} value={member.id} className="bg-[#05070d]">
              {member.name}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p className="mt-3 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={creating || !title.trim()}
          className="h-11 flex-1 rounded-2xl bg-white text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          {creating ? "Creating..." : "Create meeting"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-2xl border border-white/10 px-4 text-sm text-white/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function StatusActionButton({
  label,
  disabled,
  onClick,
  tone,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  tone: "success" | "primary" | "danger" | "neutral";
  children: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/20"
      : tone === "primary"
        ? "bg-white text-black"
        : tone === "danger"
          ? "bg-red-500/15 text-red-100 hover:bg-red-500/20"
          : "border border-white/10 bg-black/25 text-white/70 hover:text-white";

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${toneClass}`}
    >
      {children}
    </button>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-3 last:border-b-0">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-1 text-sm text-white/70">{value}</p>
    </div>
  );
}

function TextBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/55">
      {label}
    </span>
  );
}

function resolveCustomer(booking: BookingRecord): CustomerRef | null {
  return booking.customer || booking.conversation?.customer || null;
}

function toDateTimeLocalValue(iso?: string | null) {
  if (!iso) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
