import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Database,
  FileText,
  Filter,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type KnowledgeItem = {
  id: string;
  companyId: string;
  title: string;
  category: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeResponse = {
  items: KnowledgeItem[];
  categories: {
    category: string;
    _count: {
      category: number;
    };
  }[];
  summary: {
    total: number;
    active: number;
    inactive: number;
    categories: number;
  };
};

type SingleKnowledgeResponse = {
  message: string;
  item: KnowledgeItem;
};

const categorySuggestions = [
  "GENERAL",
  "SERVICES",
  "PRICING",
  "FAQ",
  "BOOKING_RULES",
  "POLICY",
  "EMERGENCY",
  "HANDOVER",
];

export default function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [summary, setSummary] = useState<KnowledgeResponse["summary"]>({
    total: 0,
    active: 0,
    inactive: 0,
    categories: 0,
  });

  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [active, setActive] = useState("ALL");

  const [newTitle, setNewTitle] = useState("Appointment booking rules");
  const [newCategory, setNewCategory] = useState("BOOKING_RULES");
  const [newContent, setNewContent] = useState(
    "Customers can request appointments through WhatsApp or call. The AI should collect preferred date, preferred time, customer name, phone number, and reason for enquiry. The AI must not confirm availability without staff approval."
  );

  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("GENERAL");
  const [editContent, setEditContent] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  const [showCreate, setShowCreate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedItemRef = useRef(selectedItem);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  const loadKnowledge = useCallback(async (nextSelectedId?: string) => {
    try {
      setError("");
      setLoading(true);

      const params = new URLSearchParams();

      if (search.trim()) params.set("search", search.trim());
      if (category !== "ALL") params.set("category", category);
      if (active !== "ALL") params.set("active", active);

      const query = params.toString();

      const data = await apiFetch<KnowledgeResponse>(
        `/api/knowledge${query ? `?${query}` : ""}`
      );

      setItems(data.items);
      setSummary(data.summary);

      const nextItem =
        data.items.find((item) => item.id === nextSelectedId) ||
        data.items.find((item) => item.id === selectedItemRef.current?.id) ||
        data.items[0] ||
        null;

      selectItem(nextItem);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load knowledge base"
      );
    } finally {
      setLoading(false);
    }
  }, [search, category, active]);

  function selectItem(item: KnowledgeItem | null) {
    setSelectedItem(item);

    if (!item) {
      setEditTitle("");
      setEditCategory("GENERAL");
      setEditContent("");
      setEditIsActive(true);
      return;
    }

    setEditTitle(item.title);
    setEditCategory(item.category);
    setEditContent(item.content);
    setEditIsActive(item.isActive);
  }

  async function createKnowledge(event: FormEvent) {
    event.preventDefault();

    if (!newTitle.trim() || !newContent.trim()) return;

    try {
      setCreating(true);
      setError("");
      setNotice("");

      const data = await apiFetch<SingleKnowledgeResponse>("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({
          title: newTitle.trim(),
          category: newCategory.trim() || "GENERAL",
          content: newContent.trim(),
          isActive: true,
        }),
      });

      setNotice("Knowledge item created.");
      await loadKnowledge(data.item.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create knowledge item"
      );
    } finally {
      setCreating(false);
    }
  }

  async function saveKnowledge(event?: FormEvent) {
    event?.preventDefault();

    if (!selectedItem || !editTitle.trim() || !editContent.trim()) return;

    try {
      setSaving(true);
      setError("");
      setNotice("");

      const data = await apiFetch<SingleKnowledgeResponse>(
        `/api/knowledge/${selectedItem.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: editTitle.trim(),
            category: editCategory.trim() || "GENERAL",
            content: editContent.trim(),
            isActive: editIsActive,
          }),
        }
      );

      setNotice("Knowledge item updated.");
      await loadKnowledge(data.item.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update knowledge item"
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteKnowledge() {
    if (!selectedItem) return;

    const confirmDelete = window.confirm(
      `Delete "${selectedItem.title}" from knowledge base?`
    );

    if (!confirmDelete) return;

    try {
      setDeleting(true);
      setError("");
      setNotice("");

      await apiFetch(`/api/knowledge/${selectedItem.id}`, {
        method: "DELETE",
      });

      setNotice("Knowledge item deleted.");
      await loadKnowledge();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete knowledge item"
      );
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadKnowledge();
    }, 250);

    return () => clearTimeout(timer);
  }, [loadKnowledge]);

  const categories = useMemo(() => {
    const unique = new Set<string>();

    categorySuggestions.forEach((item) => unique.add(item));
    items.forEach((item) => unique.add(item.category));

    return ["ALL", ...Array.from(unique)];
  }, [items]);

  return (
    <section className="grid h-[calc(100vh-112px)] min-h-[680px] gap-4 xl:grid-cols-[430px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        <div className="shrink-0 border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.04em]">
                Knowledge Base
              </h1>
              <p className="mt-1 text-sm text-white/40">
                Train the AI with company-specific rules
              </p>
            </div>

            <button
              onClick={() => loadKnowledge()}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/60 hover:text-white"
            >
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            <MiniCount label="Total" value={summary.total} />
            <MiniCount label="Active" value={summary.active} />
            <MiniCount label="Off" value={summary.inactive} />
            <MiniCount label="Cats" value={summary.categories} />
          </div>

          <button
            onClick={() => setShowCreate((current) => !current)}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black"
          >
            <Plus size={16} />
            {showCreate ? "Hide creator" : "Add knowledge"}
          </button>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4">
            <Search size={18} className="text-white/35" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search services, pricing, FAQs..."
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-white/25"
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
              <Filter size={16} className="text-white/35" />
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-11 w-full bg-transparent text-sm outline-none"
              >
                {categories.map((item) => (
                  <option
                    key={item}
                    value={item}
                    className="bg-[#05070d]"
                  >
                    {formatEnum(item)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3">
              <ShieldCheck size={16} className="text-white/35" />
              <select
                value={active}
                onChange={(event) => setActive(event.target.value)}
                className="h-11 w-full bg-transparent text-sm outline-none"
              >
                <option value="ALL" className="bg-[#05070d]">
                  All
                </option>
                <option value="true" className="bg-[#05070d]">
                  Active
                </option>
                <option value="false" className="bg-[#05070d]">
                  Inactive
                </option>
              </select>
            </label>
          </div>

          {notice ? (
            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-white/40">
              Loading knowledge...
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <BookOpen size={30} className="text-white/35" />
              <h2 className="mt-4 text-lg font-semibold">
                No knowledge yet
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/40">
                Add company services, pricing, policies and FAQs so the AI can
                answer better.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => selectItem(item)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${
                    selectedItem?.id === item.id
                      ? "border-white/20 bg-white/[0.08]"
                      : "border-white/10 bg-black/15 hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-semibold">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs text-white/35">
                        {formatEnum(item.category)}
                      </p>
                    </div>

                    {item.isActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-100/70">
                        <CheckCircle2 size={12} />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-100/70">
                        <XCircle size={12} />
                        Off
                      </span>
                    )}
                  </div>

                  <p className="mt-4 line-clamp-3 text-sm leading-6 text-white/45">
                    {item.content}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-white/10 p-5">
            <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-white/55">
                  <Database size={14} />
                  Company AI Training
                </div>

                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                  Train the AI like a real employee.
                </h2>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">
                  This knowledge is passed into the LLM decision engine for
                  WhatsApp and call replies. Active items become the business
                  truth source.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <SmallStat
                  icon={<Bot size={15} />}
                  label="Used by AI"
                  value="Active only"
                />
                <SmallStat
                  icon={<BookOpen size={15} />}
                  label="Max loaded"
                  value="25 items"
                />
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <section className="space-y-5">
                {showCreate ? (
                  <Panel title="Create knowledge" icon={<Plus size={20} />}>
                    <form onSubmit={createKnowledge} className="space-y-4">
                      <input
                        value={newTitle}
                        onChange={(event) => setNewTitle(event.target.value)}
                        className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                        placeholder="Title"
                      />

                      <select
                        value={newCategory}
                        onChange={(event) =>
                          setNewCategory(event.target.value)
                        }
                        className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                      >
                        {categorySuggestions.map((item) => (
                          <option
                            key={item}
                            value={item}
                            className="bg-[#05070d]"
                          >
                            {formatEnum(item)}
                          </option>
                        ))}
                      </select>

                      <textarea
                        value={newContent}
                        onChange={(event) => setNewContent(event.target.value)}
                        className="min-h-44 w-full resize-none rounded-3xl border border-white/10 bg-black/25 px-5 py-4 text-sm leading-7 outline-none placeholder:text-white/25"
                        placeholder="Write company-specific knowledge here..."
                      />

                      <button
                        type="submit"
                        disabled={creating || !newTitle.trim() || !newContent.trim()}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus size={16} />
                        {creating ? "Creating..." : "Create knowledge"}
                      </button>
                    </form>
                  </Panel>
                ) : null}

                <Panel title="Edit selected knowledge" icon={<Save size={20} />}>
                  {!selectedItem ? (
                    <p className="text-sm text-white/40">
                      Select a knowledge item from the left.
                    </p>
                  ) : (
                    <form onSubmit={saveKnowledge} className="space-y-4">
                      <input
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                        placeholder="Title"
                      />

                      <select
                        value={editCategory}
                        onChange={(event) =>
                          setEditCategory(event.target.value)
                        }
                        className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                      >
                        {categorySuggestions.map((item) => (
                          <option
                            key={item}
                            value={item}
                            className="bg-[#05070d]"
                          >
                            {formatEnum(item)}
                          </option>
                        ))}
                      </select>

                      <textarea
                        value={editContent}
                        onChange={(event) =>
                          setEditContent(event.target.value)
                        }
                        className="min-h-64 w-full resize-none rounded-3xl border border-white/10 bg-black/25 px-5 py-4 text-sm leading-7 outline-none placeholder:text-white/25"
                      />

                      <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                        <span className="text-sm text-white/60">
                          Active for AI replies
                        </span>

                        <input
                          type="checkbox"
                          checked={editIsActive}
                          onChange={(event) =>
                            setEditIsActive(event.target.checked)
                          }
                          className="h-5 w-5"
                        />
                      </label>

                      <div className="grid gap-3 md:grid-cols-2">
                        <button
                          type="submit"
                          disabled={
                            saving || !editTitle.trim() || !editContent.trim()
                          }
                          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Save size={16} />
                          {saving ? "Saving..." : "Save changes"}
                        </button>

                        <button
                          type="button"
                          onClick={deleteKnowledge}
                          disabled={deleting}
                          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-red-500/15 text-sm font-semibold text-red-100 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          <Trash2 size={16} />
                          {deleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </form>
                  )}
                </Panel>
              </section>

              <aside className="space-y-5">
                <Panel title="How to use it" icon={<FileText size={20} />}>
                  <div className="space-y-4 text-sm leading-7 text-white/50">
                    <p>
                      Add facts the AI must know. Keep each item focused. Do not
                      put everything in one giant block.
                    </p>

                    <p>
                      Good examples: pricing rules, booking rules, service list,
                      refund policy, emergency escalation and FAQs.
                    </p>

                    <p>
                      Bad examples: vague marketing copy, old offers, or
                      promises the company cannot guarantee.
                    </p>
                  </div>
                </Panel>

                <Panel title="Example knowledge" icon={<BookOpen size={20} />}>
                  <div className="space-y-3">
                    {[
                      "Consultation fee is ₹500. AI must confirm current pricing with staff if unsure.",
                      "For emergency symptoms, AI must advise emergency care and mark human handover.",
                      "AI can collect booking details but cannot confirm appointment availability.",
                      "Business hours are 10 AM to 7 PM, Monday to Saturday.",
                    ].map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-white/50"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </Panel>
              </aside>
            </div>
          </div>
        </div>
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

function SmallStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center gap-2 text-white/35">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
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
    <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
      <div className="mb-4 flex items-center gap-2 text-white/70">
        {icon}
        <h3 className="text-lg font-semibold tracking-[-0.03em]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function formatEnum(value?: string | null) {
  if (!value) return "-";

  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => {
    return char.toUpperCase();
  });
}