import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Filter,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  XCircle,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type BookingStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

type Customer = {
  id: string;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
};

type Message = {
  id: string;
  senderType: "CUSTOMER" | "AI" | "HUMAN";
  body: string;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
};

type Conversation = {
  id: string;
  channel: string;
  status: string;
  priority: string;
  intent?: string | null;
  aiSummary?: string | null;
  nextAction?: string | null;
  lastMessage?: string | null;
  customer?: Customer | null;
  messages?: Message[];
  tasks?: Task[];
};

type Booking = {
  id: string;
  companyId: string;
  customerId?: string | null;
  conversationId?: string | null;
  title: string;
  dateTime?: string | null;
  status: BookingStatus | string;
  createdAt: string;
  customer?: Customer | null;
  conversation?: Conversation | null;
};

type BookingsResponse = {
  bookings: Booking[];
  summary: {
    total: number;
    requested: number;
    confirmed: number;
    cancelled: number;
    completed: number;
  };
};

type BookingResponse = {
  message: string;
  booking: Booking;
};

const statuses = [
  { label: "All status", value: "ALL" },
  { label: "Requested", value: "REQUESTED" },
  { label: "Confirmed", value: "CONFIRMED" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "Completed", value: "COMPLETED" },
  { label: "No show", value: "NO_SHOW" },
];

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [summary, setSummary] = useState<BookingsResponse["summary"]>({
    total: 0,
    requested: 0,
    confirmed: 0,
    cancelled: 0,
    completed: 0,
  });

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("Manual booking request");
  const [newDateTime, setNewDateTime] = useState("");
  const [creating, setCreating] = useState(false);

  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadBookings(nextSelectedId?: string) {
    try {
      setError("");
      setLoading(true);

      const params = new URLSearchParams();

      if (status !== "ALL") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());

      const query = params.toString();

      const data = await apiFetch<BookingsResponse>(
        `/api/bookings${query ? `?${query}` : ""}`
      );

      setBookings(data.bookings);
      setSummary(data.summary);

      const nextBooking =
        data.bookings.find((booking) => booking.id === nextSelectedId) ||
        data.bookings.find((booking) => booking.id === selectedBooking?.id) ||
        data.bookings[0] ||
        null;

      setSelectedBooking(nextBooking);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }

  async function updateBookingStatus(nextStatus: BookingStatus) {
    if (!selectedBooking) return;

    try {
      setUpdating(true);
      setError("");
      setMessage("");

      const data = await apiFetch<BookingResponse>(
        `/api/bookings/${selectedBooking.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: nextStatus,
          }),
        }
      );

      setMessage(`Booking marked as ${formatEnum(nextStatus)}.`);
      await loadBookings(data.booking.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update booking");
    } finally {
      setUpdating(false);
    }
  }

  async function createBooking(event: FormEvent) {
    event.preventDefault();

    if (!newTitle.trim()) return;

    try {
      setCreating(true);
      setError("");
      setMessage("");

      const data = await apiFetch<BookingResponse>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          title: newTitle.trim(),
          dateTime: newDateTime || undefined,
          status: "REQUESTED",
        }),
      });

      setNewTitle("Manual booking request");
      setNewDateTime("");
      setShowCreate(false);
      setMessage("Manual booking created.");

      await loadBookings(data.booking.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create booking");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadBookings();
    }, 250);

    return () => clearTimeout(timer);
  }, [search, status]);

  const selectedCustomer = useMemo(() => {
    return selectedBooking?.customer || selectedBooking?.conversation?.customer;
  }, [selectedBooking]);

  return (
    <section className="grid h-[calc(100vh-112px)] min-h-[680px] gap-4 xl:grid-cols-[430px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        <div className="shrink-0 border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.04em]">
                Bookings
              </h1>
              <p className="mt-1 text-sm text-white/40">
                AI-created and manual booking requests
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowCreate((current) => !current)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-black"
              >
                <Plus size={18} />
              </button>

              <button
                onClick={() => loadBookings()}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/60 hover:text-white"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            <MiniCount label="Total" value={summary.total} />
            <MiniCount label="Req" value={summary.requested} />
            <MiniCount label="Conf" value={summary.confirmed} />
            <MiniCount label="Done" value={summary.completed} />
          </div>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={18} className="text-white/35" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search bookings..."
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>

          <label className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
            <Filter size={16} className="text-white/35" />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-11 w-full bg-transparent text-sm outline-none"
            >
              {statuses.map((item) => (
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
            <form
              onSubmit={createBooking}
              className="mt-4 rounded-3xl border border-white/10 bg-black/25 p-4"
            >
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Booking title"
                className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm outline-none placeholder:text-white/25"
              />

              <input
                value={newDateTime}
                onChange={(event) => setNewDateTime(event.target.value)}
                type="datetime-local"
                className="mt-3 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm outline-none"
              />

              <button
                type="submit"
                disabled={creating || !newTitle.trim()}
                className="mt-3 h-11 w-full rounded-2xl bg-white text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create booking"}
              </button>
            </form>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-white/40">
              Loading bookings...
            </div>
          ) : bookings.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <CalendarCheck size={30} className="text-white/35" />
              <h2 className="mt-4 text-lg font-semibold">No bookings yet</h2>
              <p className="mt-2 text-sm leading-6 text-white/40">
                AI-created appointment, table, room and site-visit requests will
                appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {bookings.map((booking) => {
                const customer = booking.customer || booking.conversation?.customer;

                return (
                  <button
                    key={booking.id}
                    onClick={() => setSelectedBooking(booking)}
                    className={`w-full rounded-3xl border p-4 text-left transition ${
                      selectedBooking?.id === booking.id
                        ? "border-white/20 bg-white/[0.08]"
                        : "border-white/10 bg-black/15 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-1 text-sm font-semibold">
                          {booking.title}
                        </p>
                        <p className="mt-1 truncate text-xs text-white/35">
                          {customer?.fullName || customer?.phone || "No customer linked"}
                        </p>
                      </div>

                      <StatusBadge status={booking.status} />
                    </div>

                    <p className="mt-4 text-sm text-white/50">
                      {booking.dateTime
                        ? formatDateTime(booking.dateTime)
                        : "No date/time set"}
                    </p>

                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/35">
                      {booking.conversation?.aiSummary ||
                        booking.conversation?.lastMessage ||
                        "Manual booking"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        {!selectedBooking ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <CalendarCheck size={34} className="text-white/35" />
            <h2 className="mt-5 text-2xl font-semibold">Select a booking</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-white/40">
              Choose a booking request to confirm, cancel or complete it.
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-white/10 p-5">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={selectedBooking.status} />
                    {selectedBooking.conversation?.channel ? (
                      <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/40">
                        {formatEnum(selectedBooking.conversation.channel)}
                      </span>
                    ) : null}
                  </div>

                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                    {selectedBooking.title}
                  </h2>

                  <p className="mt-2 text-sm text-white/45">
                    Created {formatDateTime(selectedBooking.createdAt)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={updating}
                    onClick={() => updateBookingStatus("CONFIRMED")}
                    className="flex items-center gap-2 rounded-2xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    <CheckCircle2 size={16} />
                    Confirm
                  </button>

                  <button
                    disabled={updating}
                    onClick={() => updateBookingStatus("COMPLETED")}
                    className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-black disabled:opacity-50"
                  >
                    <CalendarCheck size={16} />
                    Complete
                  </button>

                  <button
                    disabled={updating}
                    onClick={() => updateBookingStatus("CANCELLED")}
                    className="flex items-center gap-2 rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-100 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    <XCircle size={16} />
                    Cancel
                  </button>
                </div>
              </div>

              {error ? (
                <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              ) : null}

              {message ? (
                <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  {message}
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
                <div className="space-y-5">
                  <Panel title="Booking details" icon={<CalendarCheck size={20} />}>
                    <InfoRow
                      label="Date/time"
                      value={
                        selectedBooking.dateTime
                          ? formatDateTime(selectedBooking.dateTime)
                          : "Not set"
                      }
                    />
                    <InfoRow label="Status" value={formatEnum(selectedBooking.status)} />
                    <InfoRow
                      label="Conversation"
                      value={selectedBooking.conversationId ? "Linked" : "Manual"}
                    />
                  </Panel>

                  <Panel title="Customer" icon={<UserRound size={20} />}>
                    <InfoRow
                      label="Name"
                      value={selectedCustomer?.fullName || "Unknown"}
                    />
                    <InfoRow label="Phone" value={selectedCustomer?.phone || "-"} />
                    <InfoRow label="Email" value={selectedCustomer?.email || "-"} />
                  </Panel>

                  <Panel title="AI next action" icon={<AlertTriangle size={20} />}>
                    <p className="text-sm leading-6 text-white/55">
                      {selectedBooking.conversation?.nextAction ||
                        "No AI next action saved."}
                    </p>
                  </Panel>
                </div>

                <div className="space-y-5">
                  <Panel title="AI summary" icon={<Clock3 size={20} />}>
                    <p className="text-sm leading-7 text-white/55">
                      {selectedBooking.conversation?.aiSummary ||
                        selectedBooking.conversation?.lastMessage ||
                        "No conversation summary available."}
                    </p>
                  </Panel>

                  <Panel title="Recent messages" icon={<Search size={20} />}>
                    {selectedBooking.conversation?.messages?.length ? (
                      <div className="space-y-3">
                        {selectedBooking.conversation.messages.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-2xl border border-white/10 bg-black/20 p-4"
                          >
                            <div className="mb-2 text-xs text-white/35">
                              {formatEnum(item.senderType)}
                            </div>
                            <p className="text-sm leading-6 text-white/60">
                              {item.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-white/40">
                        No messages linked to this booking.
                      </p>
                    )}
                  </Panel>

                  <Panel title="Linked tasks" icon={<CheckCircle2 size={20} />}>
                    {selectedBooking.conversation?.tasks?.length ? (
                      <div className="space-y-3">
                        {selectedBooking.conversation.tasks.map((task) => (
                          <div
                            key={task.id}
                            className="rounded-2xl border border-white/10 bg-black/20 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-medium">{task.title}</p>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/40">
                                {formatEnum(task.status)}
                              </span>
                            </div>
                            <p className="mt-2 text-xs text-white/35">
                              {formatEnum(task.priority)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-white/40">
                        No tasks linked to this booking.
                      </p>
                    )}
                  </Panel>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </section>
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

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
      <div className="mb-4 flex items-center gap-2 text-white/70">
        {icon}
        <h3 className="text-lg font-semibold tracking-[-0.03em]">{title}</h3>
      </div>
      {children}
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

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
      {formatEnum(status)}
    </span>
  );
}

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => {
    return char.toUpperCase();
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}