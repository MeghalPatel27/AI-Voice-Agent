import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type BookingStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

type MeetingOutcome = "WON" | "LOST" | "FOLLOW_UP" | "";

type TeamUser = {
  id: string;
  name: string;
  email?: string | null;
  role?: string;
  isActive?: boolean;
};

type Customer = {
  id: string;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  companyName?: string | null;
};

type LeadOption = {
  id: string;
  name: string;
  phone: string;
  source?: string;
};

type LeadsResponse = {
  leads?: LeadOption[];
  teamMembers?: TeamUser[];
};

type RequirementDetails = {
  desiredCapabilities?: string[];
  primaryNeed?: string | null;
};

type PostCallAnalysis = {
  analysisStatus?: string | null;
  requirementSummary?: string | null;
  requirementDetails?: RequirementDetails | null;
};

type Call = {
  id: string;
  transcript?: string | null;
  postCallAnalysis?: PostCallAnalysis | null;
  createdAt?: string;
};

type Conversation = {
  id: string;
  channel: string;
  status: string;
  priority: string;
  intent?: string | null;
  aiSummary?: string | null;
  summary?: string | null;
  nextAction?: string | null;
  lastMessage?: string | null;
  customer?: Customer | null;
  latestCall?: Call | null;
  latestCallAnalysis?: PostCallAnalysis | null;
  leadRequirements?: {
    summary?: string | null;
    raw?: string[];
  } | null;
  calls?: Call[];
};

type Booking = {
  id: string;
  companyId: string;
  customerId?: string | null;
  conversationId?: string | null;
  callId?: string | null;
  title: string;
  purpose?: string | null;
  notes?: string | null;
  timezone?: string | null;
  nextAction?: string | null;
  dateTime?: string | null;
  status: BookingStatus | string;
  assignedUserId?: string | null;
  assignedUser?: TeamUser | null;
  owner?: string | null;
  acceptanceStatus?: string | null;
  acceptedAt?: string | null;
  acceptedByUserId?: string | null;
  meetingNotes?: string | null;
  proposalSent?: boolean | null;
  outcome?: MeetingOutcome | string | null;
  createdAt: string;
  updatedAt?: string;
  customer?: Customer | null;
  conversation?: Conversation | null;
};

type BookingsResponse = {
  bookings: Booking[];
  summary?: {
    total?: number;
    requested?: number;
    confirmed?: number;
    cancelled?: number;
    completed?: number;
  };
};

type BookingResponse = {
  message: string;
  booking: Booking;
};

type TeamResponse = {
  teamMembers?: TeamUser[];
  members?: Array<TeamUser & { type?: string }>;
};

type CalendarCell = {
  date: Date;
  key: string;
  inCurrentMonth: boolean;
};

type MeetingMetrics = {
  total: number;
  today: number;
  upcoming: number;
  pending: number;
};

const statusOptions = [
  { label: "All meetings", value: "ALL" },
  { label: "Pending acceptance", value: "REQUESTED" },
  { label: "Upcoming", value: "CONFIRMED" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "No show", value: "NO_SHOW" },
];

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function BookingsPage() {
  const navigate = useNavigate();

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toDateKey(today), [today]);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamUser[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const [showCreate, setShowCreate] = useState(false);
  const [newCustomerId, setNewCustomerId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState(todayKey);
  const [newTime, setNewTime] = useState(getDefaultTimeForDate(todayKey));
  const [newOwnerId, setNewOwnerId] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const [notesDraft, setNotesDraft] = useState("");
  const [proposalDraft, setProposalDraft] = useState(false);
  const [outcomeDraft, setOutcomeDraft] = useState<MeetingOutcome>("");

  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadBookings(nextSelectedId?: string) {
    try {
      setLoading(true);
      setError("");

      const data = await apiFetch<BookingsResponse>("/api/bookings");
      const nextBookings = data.bookings || [];

      setBookings(nextBookings);

      const queryBookingId = new URLSearchParams(window.location.search).get(
        "booking",
      );
      const idToOpen =
        nextSelectedId ||
        queryBookingId ||
        selectedBooking?.id ||
        nextBookings.find(
          (booking) => booking.dateTime && toDateKey(new Date(booking.dateTime)) === todayKey,
        )?.id ||
        nextBookings[0]?.id ||
        "";

      const nextSelected =
        nextBookings.find((booking) => booking.id === idToOpen) || null;

      setSelectedBooking(nextSelected);

      if (nextSelected?.dateTime) {
        const nextDate = new Date(nextSelected.dateTime);
        const nextKey = toDateKey(nextDate);
        setSelectedDateKey(nextKey);
        setVisibleMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load meetings");
    } finally {
      setLoading(false);
    }
  }

  async function loadReferenceData() {
    const [teamResult, leadResult] = await Promise.allSettled([
      apiFetch<TeamResponse>("/api/team/overview"),
      apiFetch<LeadsResponse>(
        "/api/customers/leads?filter=ALL&source=ALL&owner=ALL&view=LIST",
      ),
    ]);

    if (teamResult.status === "fulfilled") {
      const data = teamResult.value;
      const source =
        data.teamMembers ||
        (data.members || []).filter((member) => member.type !== "UNASSIGNED");
      setTeamMembers(source.filter((member) => member.isActive !== false));
    }

    if (leadResult.status === "fulfilled") {
      setLeads(leadResult.value.leads || []);

      if (teamResult.status !== "fulfilled" && leadResult.value.teamMembers) {
        setTeamMembers(
          leadResult.value.teamMembers.filter((member) => member.isActive !== false),
        );
      }
    }
  }

  useEffect(() => {
    void loadBookings();
    void loadReferenceData();
  }, []);

  useEffect(() => {
    setNotesDraft(selectedBooking?.meetingNotes || "");
    setProposalDraft(Boolean(selectedBooking?.proposalSent));
    setOutcomeDraft(normalizeOutcome(selectedBooking?.outcome));
  }, [selectedBooking]);

  const filteredBookings = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return bookings
      .filter((booking) => {
        if (status !== "ALL" && booking.status !== status) return false;

        if (!normalizedSearch) return true;

        const customer = booking.customer || booking.conversation?.customer;
        const owner = booking.assignedUser?.name || booking.owner || "";
        const haystack = [
          booking.title,
          customer?.fullName,
          customer?.phone,
          customer?.companyName,
          owner,
          booking.purpose,
          booking.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedSearch);
      })
      .sort(compareBookingsByDate);
  }, [bookings, search, status]);

  const meetingsByDate = useMemo(() => {
    const map = new Map<string, Booking[]>();

    for (const booking of filteredBookings) {
      if (!booking.dateTime) continue;
      const key = toDateKey(new Date(booking.dateTime));
      const current = map.get(key) || [];
      current.push(booking);
      map.set(key, current);
    }

    for (const values of map.values()) {
      values.sort(compareBookingsByDate);
    }

    return map;
  }, [filteredBookings]);

  const todayMeetings = useMemo(
    () => meetingsByDate.get(todayKey) || [],
    [meetingsByDate, todayKey],
  );

  const selectedDayMeetings = useMemo(
    () => meetingsByDate.get(selectedDateKey) || [],
    [meetingsByDate, selectedDateKey],
  );

  const calendarCells = useMemo(
    () => buildCalendarCells(visibleMonth),
    [visibleMonth],
  );

  const metrics = useMemo<MeetingMetrics>(() => {
    const now = Date.now();

    return {
      total: bookings.length,
      today: bookings.filter(
        (booking) =>
          booking.dateTime && toDateKey(new Date(booking.dateTime)) === todayKey,
      ).length,
      upcoming: bookings.filter(
        (booking) =>
          booking.dateTime &&
          new Date(booking.dateTime).getTime() >= now &&
          !["CANCELLED", "NO_SHOW", "COMPLETED"].includes(booking.status),
      ).length,
      pending: bookings.filter(
        (booking) =>
          booking.status === "REQUESTED" ||
          booking.acceptanceStatus === "PENDING_ACCEPTANCE",
      ).length,
    };
  }, [bookings, todayKey]);

  const selectedCustomer = useMemo(
    () => selectedBooking?.customer || selectedBooking?.conversation?.customer || null,
    [selectedBooking],
  );

  const selectedRequirements = useMemo(
    () => extractRequirementChips(selectedBooking?.conversation || null),
    [selectedBooking],
  );

  const selectedRequirementSummary = useMemo(
    () => getRequirementSummary(selectedBooking?.conversation || null),
    [selectedBooking],
  );

  const currentUserId = useMemo(() => getCurrentUserId(), []);

  const pendingAcceptance = Boolean(
    selectedBooking &&
      selectedBooking.acceptanceStatus !== "ACCEPTED" &&
      (selectedBooking.acceptanceStatus === "PENDING_ACCEPTANCE" ||
        selectedBooking.status === "REQUESTED"),
  );

  const canAccept = Boolean(
    pendingAcceptance &&
      selectedBooking?.assignedUserId &&
      currentUserId &&
      selectedBooking.assignedUserId === currentUserId,
  );

  function chooseDate(dateKey: string) {
    setSelectedDateKey(dateKey);
    setSelectedBooking((meetingsByDate.get(dateKey) || [])[0] || null);
    const date = parseDateKey(dateKey);

    if (
      date.getFullYear() !== visibleMonth.getFullYear() ||
      date.getMonth() !== visibleMonth.getMonth()
    ) {
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  }

  function openCreateMeeting(dateKey = selectedDateKey) {
    setNewCustomerId("");
    setNewOwnerId("");
    setNewDate(dateKey);
    setNewTime(getDefaultTimeForDate(dateKey));
    setNewTitle("");
    setNewPurpose("");
    setNewNotes("");
    setShowCreate(true);
  }

  function chooseCreateCustomer(customerId: string) {
    setNewCustomerId(customerId);
    const lead = leads.find((item) => item.id === customerId);

    if (lead) {
      setNewTitle(`Meeting with ${lead.name}`);
    }
  }

  async function createMeeting(event: FormEvent) {
    event.preventDefault();

    if (!newCustomerId) {
      setError("Select a customer before creating the meeting.");
      return;
    }

    if (!newDate || !newTime) {
      setError("Select the meeting date and time.");
      return;
    }

    if (!newTitle.trim()) {
      setError("Enter a meeting title.");
      return;
    }

    const localDateTime = new Date(`${newDate}T${newTime}:00`);

    if (Number.isNaN(localDateTime.getTime())) {
      setError("The selected meeting date or time is invalid.");
      return;
    }

    try {
      setWorking(true);
      setError("");
      setNotice("");

      const data = await apiFetch<BookingResponse>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          customerId: newCustomerId,
          title: newTitle.trim(),
          dateTime: localDateTime.toISOString(),
          status: "REQUESTED",
          assignedUserId: newOwnerId || null,
          purpose: newPurpose.trim() || null,
          notes: newNotes.trim() || null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      setSelectedDateKey(newDate);
      setVisibleMonth(
        new Date(localDateTime.getFullYear(), localDateTime.getMonth(), 1),
      );
      setShowCreate(false);
      setNewCustomerId("");
      setNewTitle("");
      setNewOwnerId("");
      setNewPurpose("");
      setNewNotes("");
      setNotice("Meeting created and placed on the calendar.");
      await loadBookings(data.booking.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create meeting");
    } finally {
      setWorking(false);
    }
  }

  async function updateBooking(
    fields: Record<string, unknown>,
    successMessage: string,
  ) {
    if (!selectedBooking) return;

    try {
      setWorking(true);
      setError("");
      setNotice("");

      const data = await apiFetch<BookingResponse>(
        `/api/bookings/${selectedBooking.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(fields),
        },
      );

      setNotice(successMessage);
      await loadBookings(data.booking?.id || selectedBooking.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update meeting");
    } finally {
      setWorking(false);
    }
  }

  async function acceptMeeting() {
    if (!selectedBooking) return;

    try {
      setWorking(true);
      setError("");
      setNotice("");

      const data = await apiFetch<BookingResponse>(
        `/api/bookings/${selectedBooking.id}/accept`,
        { method: "POST" },
      );

      setNotice("Meeting accepted.");
      await loadBookings(data.booking?.id || selectedBooking.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept meeting");
    } finally {
      setWorking(false);
    }
  }

  async function saveMeetingDetails(event: FormEvent) {
    event.preventDefault();

    await updateBooking(
      {
        meetingNotes: notesDraft.trim() || null,
        proposalSent: proposalDraft,
        outcome: outcomeDraft || null,
      },
      "Meeting details saved.",
    );
  }

  return (
    <section className="space-y-6 pb-12">
      <MeetingsHeader
        metrics={metrics}
        search={search}
        status={status}
        working={working}
        onSearchChange={setSearch}
        onStatusChange={setStatus}
        onRefresh={() => void loadBookings()}
        onCreate={() => openCreateMeeting(selectedDateKey)}
      />

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(240px,1fr)_minmax(0,4fr)]">
        <MeetingsTodayPanel
          meetings={todayMeetings}
          selectedId={selectedBooking?.id || ""}
          loading={loading}
          onSelect={setSelectedBooking}
          onCreate={() => openCreateMeeting(todayKey)}
        />

        <CalendarWorkspace
          month={visibleMonth}
          cells={calendarCells}
          meetingsByDate={meetingsByDate}
          selectedDateKey={selectedDateKey}
          todayKey={todayKey}
          selectedDayMeetings={selectedDayMeetings}
          selectedBookingId={selectedBooking?.id || ""}
          loading={loading}
          onPreviousMonth={() => setVisibleMonth((value) => addMonths(value, -1))}
          onNextMonth={() => setVisibleMonth((value) => addMonths(value, 1))}
          onToday={() => {
            setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
            setSelectedDateKey(todayKey);
          }}
          onSelectDate={chooseDate}
          onSelectMeeting={setSelectedBooking}
          onCreate={() => openCreateMeeting(selectedDateKey)}
        />
      </section>

      {selectedBooking ? (
        <MeetingRecord
          booking={selectedBooking}
          customer={selectedCustomer}
          requirements={selectedRequirements}
          requirementSummary={selectedRequirementSummary}
          teamMembers={teamMembers}
          notesDraft={notesDraft}
          proposalDraft={proposalDraft}
          outcomeDraft={outcomeDraft}
          working={working}
          canAccept={canAccept}
          onNotesChange={setNotesDraft}
          onProposalChange={setProposalDraft}
          onOutcomeChange={setOutcomeDraft}
          onAccept={() => void acceptMeeting()}
          onComplete={() =>
            void updateBooking({ status: "COMPLETED" }, "Meeting completed.")
          }
          onCancel={() =>
            void updateBooking({ status: "CANCELLED" }, "Meeting cancelled.")
          }
          onOwnerChange={(userId) =>
            void updateBooking(
              { assignedUserId: userId || null },
              "Meeting owner updated.",
            )
          }
          onOpenCall={() => {
            if (selectedBooking.conversationId) {
              navigate(`/calls?conversation=${selectedBooking.conversationId}`);
            }
          }}
          onSave={saveMeetingDetails}
        />
      ) : (
        <Surface className="flex min-h-[420px] items-center justify-center">
          <EmptyState
            icon={<CalendarCheck size={34} />}
            title="Select a meeting"
            description="Choose a meeting from Meetings Today or from a calendar day to open its complete record."
          />
        </Surface>
      )}

      {showCreate ? (
        <CreateMeetingModal
          leads={leads}
          teamMembers={teamMembers}
          customerId={newCustomerId}
          title={newTitle}
          date={newDate}
          time={newTime}
          ownerId={newOwnerId}
          purpose={newPurpose}
          notes={newNotes}
          working={working}
          onCustomerChange={chooseCreateCustomer}
          onTitleChange={setNewTitle}
          onDateChange={setNewDate}
          onTimeChange={setNewTime}
          onOwnerChange={setNewOwnerId}
          onPurposeChange={setNewPurpose}
          onNotesChange={setNewNotes}
          onClose={() => setShowCreate(false)}
          onSubmit={createMeeting}
        />
      ) : null}
    </section>
  );
}

function MeetingsHeader({
  metrics,
  search,
  status,
  working,
  onSearchChange,
  onStatusChange,
  onRefresh,
  onCreate,
}: {
  metrics: MeetingMetrics;
  search: string;
  status: string;
  working: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
}) {
  return (
    <Surface className="p-6 md:p-8">
      <div className="flex flex-col justify-between gap-7 2xl:flex-row 2xl:items-start">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-medium text-sky-100">
            <CalendarDays size={14} />
            Meetings calendar
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] md:text-5xl">
            Meetings
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/48">
            See today first, move across months, open any day, and schedule a
            meeting directly on the calendar.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRefresh}
            disabled={working}
            className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 text-sm text-white/65 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={17} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black"
          >
            <Plus size={17} />
            New meeting
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="All meetings" value={metrics.total} />
        <Metric label="Meetings today" value={metrics.today} tone="blue" />
        <Metric label="Upcoming" value={metrics.upcoming} tone="green" />
        <Metric label="Pending acceptance" value={metrics.pending} tone="amber" />
      </div>

      <div className="mt-6 grid gap-3 xl:grid-cols-[minmax(0,1fr)_270px]">
        <label className="flex h-[52px] items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
          <Search size={18} className="text-white/30" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search customer, owner or meeting..."
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25"
          />
        </label>

        <label className="flex h-[52px] items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
          <Filter size={16} className="text-white/30" />
          <select
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-white/65 outline-none"
          >
            {statusOptions.map((item) => (
              <option key={item.value} value={item.value} className="bg-[#080b12]">
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Surface>
  );
}

function MeetingsTodayPanel({
  meetings,
  selectedId,
  loading,
  onSelect,
  onCreate,
}: {
  meetings: Booking[];
  selectedId: string;
  loading: boolean;
  onSelect: (booking: Booking) => void;
  onCreate: () => void;
}) {
  return (
    <Surface className="overflow-hidden">
      <div className="border-b border-white/10 px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.04em]">
              Meetings Today
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/38">
              Every meeting scheduled for today, in time order.
            </p>
          </div>
          <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-sm font-semibold text-sky-100">
            {meetings.length}
          </span>
        </div>
      </div>

      <div className="min-h-[610px] p-4">
        {loading ? (
          <LoadingState text="Loading today’s meetings..." />
        ) : meetings.length === 0 ? (
          <div className="flex min-h-[575px] flex-col items-center justify-center px-6 text-center">
            <CalendarCheck size={34} className="text-white/25" />
            <h3 className="mt-5 text-xl font-semibold">No meetings today</h3>
            <p className="mt-2 max-w-xs text-sm leading-6 text-white/38">
              Today is clear. Schedule a meeting directly from here or select a
              date on the calendar.
            </p>
            <button
              type="button"
              onClick={onCreate}
              className="mt-6 flex h-11 items-center gap-2 rounded-2xl bg-white px-4 text-sm font-semibold text-black"
            >
              <Plus size={16} />
              Schedule today
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {meetings.map((meeting) => (
              <MeetingSummaryCard
                key={meeting.id}
                booking={meeting}
                active={selectedId === meeting.id}
                onClick={() => onSelect(meeting)}
                layout="today"
              />
            ))}
          </div>
        )}
      </div>
    </Surface>
  );
}

function CalendarWorkspace({
  month,
  cells,
  meetingsByDate,
  selectedDateKey,
  todayKey,
  selectedDayMeetings,
  selectedBookingId,
  loading,
  onPreviousMonth,
  onNextMonth,
  onToday,
  onSelectDate,
  onSelectMeeting,
  onCreate,
}: {
  month: Date;
  cells: CalendarCell[];
  meetingsByDate: Map<string, Booking[]>;
  selectedDateKey: string;
  todayKey: string;
  selectedDayMeetings: Booking[];
  selectedBookingId: string;
  loading: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onSelectDate: (dateKey: string) => void;
  onSelectMeeting: (booking: Booking) => void;
  onCreate: () => void;
}) {
  return (
    <Surface className="overflow-hidden">
      <div className="flex flex-col justify-between gap-5 border-b border-white/10 px-6 py-6 md:flex-row md:items-center md:px-8">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.04em]">
            {formatMonthYear(month)}
          </h2>
          <p className="mt-2 text-sm text-white/38">
            Select a day to see its meetings. Days with meetings are marked.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToday}
            className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-white/58 transition hover:bg-white/[0.07] hover:text-white"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onPreviousMonth}
            aria-label="Previous month"
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/58 transition hover:bg-white/[0.07] hover:text-white"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            aria-label="Next month"
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/58 transition hover:bg-white/[0.07] hover:text-white"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto px-4 py-5 md:px-6 md:py-6">
        <div className="min-w-[880px]">
          <div className="grid grid-cols-7 gap-3 px-1 pb-3">
            {weekdayLabels.map((day) => (
              <div
                key={day}
                className="px-2 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-white/30"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-3">
            {cells.map((cell) => (
              <CalendarDay
                key={cell.key}
                cell={cell}
                meetings={meetingsByDate.get(cell.key) || []}
                selected={cell.key === selectedDateKey}
                today={cell.key === todayKey}
                onClick={() => onSelectDate(cell.key)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 px-6 py-7 md:px-8 md:py-8">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/32">
              Selected day
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
              {formatLongDate(parseDateKey(selectedDateKey))}
            </h3>
            <p className="mt-2 text-sm text-white/38">
              {selectedDayMeetings.length === 0
                ? "No meetings on this date."
                : `${selectedDayMeetings.length} meeting${
                    selectedDayMeetings.length === 1 ? "" : "s"
                  } scheduled.`}
            </p>
          </div>

          <button
            type="button"
            onClick={onCreate}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black"
          >
            <Plus size={17} />
            Schedule on this day
          </button>
        </div>

        <div className="mt-6">
          {loading ? (
            <LoadingState text="Loading meetings..." />
          ) : selectedDayMeetings.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-white/12 bg-black/15 px-7 py-12 text-center">
              <CalendarDays size={30} className="mx-auto text-white/24" />
              <h4 className="mt-4 text-lg font-semibold">This day is open</h4>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-white/36">
                Use “Schedule on this day” to select a customer, time and owner.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {selectedDayMeetings.map((meeting) => (
                <MeetingSummaryCard
                  key={meeting.id}
                  booking={meeting}
                  active={selectedBookingId === meeting.id}
                  onClick={() => onSelectMeeting(meeting)}
                  layout="calendar"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Surface>
  );
}

function CalendarDay({
  cell,
  meetings,
  selected,
  today,
  onClick,
}: {
  cell: CalendarCell;
  meetings: Booking[];
  selected: boolean;
  today: boolean;
  onClick: () => void;
}) {
  const visibleMeetings = meetings.slice(0, 2);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[118px] rounded-[22px] border p-3 text-left transition ${
        selected
          ? "border-white bg-white text-black shadow-[0_18px_55px_rgba(255,255,255,0.10)]"
          : today
            ? "border-sky-400/30 bg-sky-400/[0.08] text-white hover:bg-sky-400/[0.12]"
            : cell.inCurrentMonth
              ? "border-white/10 bg-black/18 text-white hover:bg-white/[0.055]"
              : "border-white/[0.06] bg-black/10 text-white/26 hover:text-white/45"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold">{cell.date.getDate()}</span>
        {today ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
              selected ? "bg-black/8 text-black/55" : "bg-sky-400/15 text-sky-100"
            }`}
          >
            Today
          </span>
        ) : null}
      </div>

      {meetings.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div
            className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              selected ? "bg-black/8 text-black/60" : "bg-white/[0.07] text-white/58"
            }`}
          >
            {meetings.length} meeting{meetings.length === 1 ? "" : "s"}
          </div>

          <div className="space-y-1.5">
            {visibleMeetings.map((meeting) => {
              const customer = meeting.customer || meeting.conversation?.customer;
              return (
                <div
                  key={meeting.id}
                  className={`truncate text-[10px] leading-4 ${
                    selected ? "text-black/58" : "text-white/44"
                  }`}
                >
                  {meeting.dateTime ? formatTimeOnly(meeting.dateTime) : "Time pending"}
                  {" · "}
                  {customer?.fullName || meeting.title}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p
          className={`mt-8 text-[10px] ${
            selected ? "text-black/32" : "text-white/18"
          }`}
        >
          No meetings
        </p>
      )}
    </button>
  );
}

function MeetingSummaryCard({
  booking,
  active,
  onClick,
  layout,
}: {
  booking: Booking;
  active: boolean;
  onClick: () => void;
  layout: "today" | "calendar";
}) {
  const customer = booking.customer || booking.conversation?.customer;
  const owner = booking.assignedUser?.name || booking.owner || "Unassigned";
  const displayStatus = getDisplayMeetingStatus(booking);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[28px] border p-5 text-left transition ${
        active
          ? "border-white bg-white text-black shadow-[0_18px_55px_rgba(255,255,255,0.10)]"
          : "border-white/10 bg-black/18 text-white hover:bg-white/[0.055]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className={`text-xs font-semibold uppercase tracking-[0.15em] ${
              active ? "text-black/40" : "text-white/30"
            }`}
          >
            {booking.dateTime ? formatTimeOnly(booking.dateTime) : "Time pending"}
          </p>
          <h3 className="mt-2 truncate text-lg font-semibold tracking-[-0.03em]">
            {customer?.fullName || booking.title || "Unknown customer"}
          </h3>
          <p
            className={`mt-1 truncate text-sm ${
              active ? "text-black/45" : "text-white/36"
            }`}
          >
            {booking.title}
          </p>
        </div>
        <MeetingStatusPill status={displayStatus} inverse={active} />
      </div>

      <div
        className={`mt-5 grid gap-4 border-t pt-4 text-sm ${
          layout === "calendar" ? "sm:grid-cols-2" : ""
        } ${active ? "border-black/10 text-black/55" : "border-white/10 text-white/42"}`}
      >
        <div className="flex items-center gap-2">
          <UserRound size={15} className="shrink-0 opacity-65" />
          <span className="truncate">{owner}</span>
        </div>
        {layout === "calendar" ? (
          <div className="flex items-center gap-2">
            <Clock3 size={15} className="shrink-0 opacity-65" />
            <span className="truncate">
              {booking.dateTime ? formatDateTime(booking.dateTime) : "Not scheduled"}
            </span>
          </div>
        ) : null}
      </div>
    </button>
  );
}

function MeetingRecord({
  booking,
  customer,
  requirements,
  requirementSummary,
  teamMembers,
  notesDraft,
  proposalDraft,
  outcomeDraft,
  working,
  canAccept,
  onNotesChange,
  onProposalChange,
  onOutcomeChange,
  onAccept,
  onComplete,
  onCancel,
  onOwnerChange,
  onOpenCall,
  onSave,
}: {
  booking: Booking;
  customer: Customer | null;
  requirements: string[];
  requirementSummary: string;
  teamMembers: TeamUser[];
  notesDraft: string;
  proposalDraft: boolean;
  outcomeDraft: MeetingOutcome;
  working: boolean;
  canAccept: boolean;
  onNotesChange: (value: string) => void;
  onProposalChange: (value: boolean) => void;
  onOutcomeChange: (value: MeetingOutcome) => void;
  onAccept: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onOwnerChange: (userId: string) => void;
  onOpenCall: () => void;
  onSave: (event: FormEvent) => void;
}) {
  const owner = booking.assignedUser?.name || booking.owner || "Unassigned";
  const summaryText =
    booking.conversation?.aiSummary ||
    booking.conversation?.summary ||
    booking.conversation?.lastMessage ||
    "No AI summary is available for the related call.";
  const pendingAcceptance =
    booking.acceptanceStatus !== "ACCEPTED" &&
    (booking.acceptanceStatus === "PENDING_ACCEPTANCE" ||
      booking.status === "REQUESTED");
  const displayStatus = getDisplayMeetingStatus(booking);
  const statusConfig = getMeetingStatusConfig(displayStatus);

  return (
    <Surface className="overflow-hidden">
      <div className="border-b border-white/10 px-6 py-7 md:px-8 md:py-8">
        <div className="flex flex-col justify-between gap-7 2xl:flex-row 2xl:items-start">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/30">
              Meeting detail
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] md:text-4xl">
              {customer?.fullName || booking.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/42">{booking.title}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {pendingAcceptance ? (
              <button
                type="button"
                onClick={onAccept}
                disabled={working || !canAccept}
                title={
                  canAccept
                    ? "Accept this meeting"
                    : "Only the assigned employee can accept this meeting"
                }
                className="flex h-11 items-center gap-2 rounded-2xl bg-emerald-400 px-4 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCircle2 size={16} />
                Accept
              </button>
            ) : null}

            <ActionButton onClick={onComplete} disabled={working} tone="green">
              <CalendarCheck size={16} />
              Complete
            </ActionButton>
            <ActionButton onClick={onCancel} disabled={working} tone="red">
              <XCircle size={16} />
              Cancel
            </ActionButton>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <HeaderFact
            label="Meeting time"
            value={booking.dateTime ? formatDateTime(booking.dateTime) : "Not set"}
            icon={<Clock3 size={17} />}
          />
          <HeaderFact label="Assigned to" value={owner} icon={<UserRound size={17} />} />
          <HeaderFact
            label="Status"
            value={statusConfig.label}
            icon={statusConfig.icon}
            tone={getStatusTone(displayStatus)}
          />
        </div>

        {teamMembers.length > 0 ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-xs text-white/32">Change owner</span>
            <select
              value={booking.assignedUserId || ""}
              onChange={(event) => onOwnerChange(event.target.value)}
              disabled={working}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white/60 outline-none disabled:opacity-50"
            >
              <option value="" className="bg-[#080b12]">
                Unassigned
              </option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id} className="bg-[#080b12]">
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <form onSubmit={onSave} className="p-6 md:p-8">
        <div className="overflow-hidden rounded-[30px] border border-white/10 bg-black/18">
          <MeetingRow label="Related Call" icon={<ArrowRight size={18} />}>
            {booking.conversationId ? (
              <button
                type="button"
                onClick={onOpenCall}
                className="flex items-center gap-2 text-sm font-medium text-cyan-100/75 hover:text-cyan-100"
              >
                Open original call record
                <ArrowRight size={14} />
              </button>
            ) : (
              <MutedText>No call record is linked to this meeting.</MutedText>
            )}
          </MeetingRow>

          <MeetingRow label="AI Summary" icon={<FileText size={18} />}>
            <p className="max-w-4xl text-[15px] leading-8 text-white/66">
              {summaryText}
            </p>
          </MeetingRow>

          <MeetingRow label="Customer Requirements" icon={<Check size={18} />}>
            {requirements.length > 0 ? (
              <div className="flex flex-wrap gap-2.5">
                {requirements.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.07] px-3.5 py-2 text-sm text-emerald-50/80"
                  >
                    <Check size={13} className="text-emerald-300" />
                    {item}
                  </span>
                ))}
              </div>
            ) : requirementSummary ? (
              <p className="max-w-4xl text-[15px] leading-8 text-white/58">
                {requirementSummary}
              </p>
            ) : (
              <MutedText>No structured requirements were captured.</MutedText>
            )}
          </MeetingRow>

          <MeetingRow label="Meeting Notes" icon={<FileText size={18} />}>
            <textarea
              value={notesDraft}
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="What happened in the meeting?"
              className="min-h-40 w-full max-w-4xl resize-y rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 text-sm leading-7 text-white/70 outline-none placeholder:text-white/24"
            />
          </MeetingRow>

          <MeetingRow label="Proposal Sent" icon={<CheckCircle2 size={18} />}>
            <div className="flex gap-3">
              <ToggleButton active={proposalDraft} onClick={() => onProposalChange(true)}>
                Yes
              </ToggleButton>
              <ToggleButton active={!proposalDraft} onClick={() => onProposalChange(false)}>
                No
              </ToggleButton>
            </div>
          </MeetingRow>

          <MeetingRow label="Outcome" icon={<CalendarCheck size={18} />} last>
            <select
              value={outcomeDraft}
              onChange={(event) =>
                onOutcomeChange(event.target.value as MeetingOutcome)
              }
              className="h-12 w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white/65 outline-none"
            >
              <option value="" className="bg-[#080b12]">
                Not decided
              </option>
              <option value="WON" className="bg-[#080b12]">
                Won
              </option>
              <option value="LOST" className="bg-[#080b12]">
                Lost
              </option>
              <option value="FOLLOW_UP" className="bg-[#080b12]">
                Follow-up
              </option>
            </select>
          </MeetingRow>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={working}
            className="flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
          >
            {working ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            Save meeting details
          </button>
        </div>
      </form>
    </Surface>
  );
}

function CreateMeetingModal({
  leads,
  teamMembers,
  customerId,
  title,
  date,
  time,
  ownerId,
  purpose,
  notes,
  working,
  onCustomerChange,
  onTitleChange,
  onDateChange,
  onTimeChange,
  onOwnerChange,
  onPurposeChange,
  onNotesChange,
  onClose,
  onSubmit,
}: {
  leads: LeadOption[];
  teamMembers: TeamUser[];
  customerId: string;
  title: string;
  date: string;
  time: string;
  ownerId: string;
  purpose: string;
  notes: string;
  working: boolean;
  onCustomerChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onPurposeChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => firstFieldRef.current?.focus(), 30);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="my-6 w-full max-w-3xl rounded-[34px] border border-white/12 bg-[#0a0d14] p-6 shadow-[0_40px_140px_rgba(0,0,0,0.65)] md:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-sky-100/70">Manual meeting</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
              Schedule meeting
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/38">
              Select the customer, date, time and owner. Press Enter from a form
              field or use the create button to add it to the calendar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 text-white/50 transition hover:bg-white/[0.06] hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <Field label="Customer">
            <select
              ref={firstFieldRef}
              value={customerId}
              onChange={(event) => onCustomerChange(event.target.value)}
              required
              className="h-[52px] w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/68 outline-none"
            >
              <option value="" className="bg-[#080b12]">
                Select customer
              </option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id} className="bg-[#080b12]">
                  {lead.name} · {lead.phone}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assigned owner">
            <select
              value={ownerId}
              onChange={(event) => onOwnerChange(event.target.value)}
              className="h-[52px] w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/68 outline-none"
            >
              <option value="" className="bg-[#080b12]">
                Unassigned
              </option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id} className="bg-[#080b12]">
                  {member.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(event) => onDateChange(event.target.value)}
              required
              className="h-[52px] w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/68 outline-none"
            />
          </Field>

          <Field label="Time">
            <input
              type="time"
              value={time}
              onChange={(event) => onTimeChange(event.target.value)}
              required
              className="h-[52px] w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/68 outline-none"
            />
          </Field>

          <div className="md:col-span-2">
            <Field label="Meeting title">
              <input
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                required
                placeholder="Meeting with customer"
                className="h-[52px] w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/68 outline-none placeholder:text-white/24"
              />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label="Purpose">
              <input
                value={purpose}
                onChange={(event) => onPurposeChange(event.target.value)}
                placeholder="Demo, requirement discussion, proposal review..."
                className="h-[52px] w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/68 outline-none placeholder:text-white/24"
              />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label="Preparation notes">
              <textarea
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Anything the assigned employee should know before the meeting."
                className="min-h-28 w-full resize-y rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm leading-7 text-white/68 outline-none placeholder:text-white/24"
              />
            </Field>
          </div>
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-2xl border border-white/10 px-5 text-sm text-white/55"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={working || !customerId || !title.trim() || !date || !time}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-6 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-45"
          >
            {working ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            Create meeting
          </button>
        </div>
      </form>
    </div>
  );
}

function MeetingRow({
  label,
  icon,
  children,
  last = false,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`grid gap-5 px-5 py-7 md:grid-cols-[205px_minmax(0,1fr)] md:px-7 md:py-8 ${
        last ? "" : "border-b border-white/10"
      }`}
    >
      <div className="flex items-center gap-3 self-start text-white/68">
        <span className="text-white/38">{icon}</span>
        <h3 className="text-sm font-semibold">{label}</h3>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "amber" | "blue" | "green";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-400/15 bg-amber-400/[0.07]"
      : tone === "blue"
        ? "border-sky-400/15 bg-sky-400/[0.07]"
        : tone === "green"
          ? "border-emerald-400/15 bg-emerald-400/[0.07]"
          : "border-white/10 bg-black/20";

  return (
    <div className={`rounded-[22px] border px-5 py-4 ${toneClass}`}>
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function MeetingStatusPill({
  status,
  inverse = false,
}: {
  status: string;
  inverse?: boolean;
}) {
  const config = getMeetingStatusConfig(status);

  if (inverse) {
    return (
      <span className="shrink-0 rounded-full bg-black/8 px-2.5 py-1 text-[11px] font-medium text-black/58">
        {config.label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${config.className}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

function HeaderFact({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: "neutral" | "amber" | "green" | "blue" | "red";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-400/15 bg-amber-400/[0.07]"
      : tone === "green"
        ? "border-emerald-400/15 bg-emerald-400/[0.07]"
        : tone === "blue"
          ? "border-sky-400/15 bg-sky-400/[0.07]"
          : tone === "red"
            ? "border-red-400/15 bg-red-400/[0.07]"
            : "border-white/10 bg-black/20";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-center gap-2 text-white/35">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-2 text-sm font-semibold text-white/72">{value}</p>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  tone: "green" | "red";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 items-center gap-2 rounded-2xl border px-4 text-sm disabled:opacity-50 ${
        tone === "green"
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
          : "border-red-400/20 bg-red-400/10 text-red-100"
      }`}
    >
      {children}
    </button>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 min-w-24 rounded-2xl border px-5 text-sm font-medium transition ${
        active
          ? "border-white bg-white text-black"
          : "border-white/10 bg-white/[0.035] text-white/48 hover:bg-white/[0.07]"
      }`}
    >
      {children}
    </button>
  );
}

function Surface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[34px] border border-white/10 bg-white/[0.04] ${className}`}
    >
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-white/35">
        {label}
      </span>
      {children}
    </label>
  );
}

function MutedText({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-7 text-white/40">{children}</p>;
}

function Notice({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "success" | "danger";
}) {
  return (
    <div
      className={`rounded-2xl border px-5 py-4 text-sm ${
        tone === "success"
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
          : "border-red-400/20 bg-red-400/10 text-red-100"
      }`}
    >
      {children}
    </div>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center gap-3 text-sm text-white/40">
      <Loader2 className="animate-spin" size={18} />
      {text}
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
    <div className="flex min-h-[320px] flex-col items-center justify-center px-8 text-center">
      <div className="text-white/30">{icon}</div>
      <h3 className="mt-5 text-xl font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-white/38">{description}</p>
    </div>
  );
}

function buildCalendarCells(month: Date): CalendarCell[] {
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      date,
      key: toDateKey(date),
      inCurrentMonth:
        date.getFullYear() === month.getFullYear() &&
        date.getMonth() === month.getMonth(),
    };
  });
}

function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function toDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
}

function compareBookingsByDate(left: Booking, right: Booking): number {
  const leftTime = left.dateTime
    ? new Date(left.dateTime).getTime()
    : Number.MAX_SAFE_INTEGER;
  const rightTime = right.dateTime
    ? new Date(right.dateTime).getTime()
    : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function getDefaultTimeForDate(dateKey: string): string {
  const now = new Date();

  if (dateKey !== toDateKey(now)) return "10:00";

  const rounded = new Date(now);
  rounded.setMinutes(now.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (now.getMinutes() >= 30) rounded.setHours(now.getHours() + 1);

  return `${String(rounded.getHours()).padStart(2, "0")}:${String(
    rounded.getMinutes(),
  ).padStart(2, "0")}`;
}

function getDisplayMeetingStatus(booking: Booking): string {
  if (
    booking.acceptanceStatus !== "ACCEPTED" &&
    (booking.acceptanceStatus === "PENDING_ACCEPTANCE" ||
      booking.status === "REQUESTED")
  ) {
    return "PENDING_ACCEPTANCE";
  }

  if (booking.status === "CONFIRMED" && booking.acceptanceStatus === "ACCEPTED") {
    return "ACCEPTED";
  }

  return booking.status;
}

function getMeetingStatusConfig(status?: string | null) {
  const value = status || "REQUESTED";

  if (["CONFIRMED", "UPCOMING", "SCHEDULED"].includes(value)) {
    return {
      label: value === "CONFIRMED" ? "Upcoming" : formatEnum(value),
      className: "border-sky-400/20 bg-sky-400/10 text-sky-100",
      icon: <Clock3 size={12} />,
    };
  }

  if (["COMPLETED", "ACCEPTED", "WON"].includes(value)) {
    return {
      label: formatEnum(value),
      className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
      icon: <CheckCircle2 size={12} />,
    };
  }

  if (["REQUESTED", "PENDING_ACCEPTANCE", "FOLLOW_UP"].includes(value)) {
    return {
      label: value === "REQUESTED" ? "Pending acceptance" : formatEnum(value),
      className: "border-amber-400/20 bg-amber-400/10 text-amber-100",
      icon: <Clock3 size={12} />,
    };
  }

  if (["CANCELLED", "CANCELED", "NO_SHOW", "LOST"].includes(value)) {
    return {
      label: formatEnum(value),
      className: "border-red-400/20 bg-red-400/10 text-red-100",
      icon: <XCircle size={12} />,
    };
  }

  return {
    label: formatEnum(value),
    className: "border-white/10 bg-white/[0.05] text-white/50",
    icon: <CalendarCheck size={12} />,
  };
}

function getStatusTone(
  status: string,
): "neutral" | "amber" | "green" | "blue" | "red" {
  if (["PENDING_ACCEPTANCE", "REQUESTED", "FOLLOW_UP"].includes(status)) {
    return "amber";
  }
  if (["COMPLETED", "ACCEPTED", "WON"].includes(status)) return "green";
  if (["CANCELLED", "CANCELED", "NO_SHOW", "LOST"].includes(status)) {
    return "red";
  }
  if (["CONFIRMED", "UPCOMING", "SCHEDULED"].includes(status)) return "blue";
  return "neutral";
}

function extractRequirementChips(conversation: Conversation | null): string[] {
  if (!conversation) return [];

  const call = conversation.latestCall || conversation.calls?.[0] || null;
  const analysis = call?.postCallAnalysis || conversation.latestCallAnalysis;
  const values = [
    ...(analysis?.requirementDetails?.desiredCapabilities || []),
    ...(conversation.leadRequirements?.raw || []),
  ];

  if (analysis?.requirementDetails?.primaryNeed) {
    values.push(analysis.requirementDetails.primaryNeed);
  }

  return uniqueCleanStrings(values)
    .filter((item) => item.length <= 64)
    .slice(0, 10);
}

function getRequirementSummary(conversation: Conversation | null): string {
  if (!conversation) return "";

  const call = conversation.latestCall || conversation.calls?.[0] || null;
  const analysis = call?.postCallAnalysis || conversation.latestCallAnalysis;

  return analysis?.requirementSummary || conversation.leadRequirements?.summary || "";
}

function uniqueCleanStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = String(value || "")
      .replace(/^[\s✓•\-*]+/, "")
      .trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

function normalizeOutcome(value?: string | null): MeetingOutcome {
  if (value === "WON" || value === "LOST" || value === "FOLLOW_UP") {
    return value;
  }
  return "";
}

function getCurrentUserId(): string {
  try {
    const token = localStorage.getItem("airadesk_token");
    if (!token) return "";

    const payloadPart = token.split(".")[1];
    if (!payloadPart) return "";

    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    return String(payload.userId || payload.sub || "");
  } catch {
    return "";
  }
}

function formatEnum(value?: string | null): string {
  if (!value) return "-";

  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMonthYear(value: Date): string {
  return value.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function formatLongDate(value: Date): string {
  return value.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeOnly(value: string): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}