import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  Brain,
  Building2,
  Clock3,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  Target,
  UsersRound,
} from "lucide-react";
import { apiFetch } from "./lib/api";

type AiCeoMessage = {
  role: "user" | "assistant";
  content: string;
};

type AiCeoResponse = {
  answer: string;
  snapshotMeta?: {
    generatedAt: string;
    companyName: string;
    paymentDataConnected: boolean;
  };
};

const quickQuestions = [
  "What should I focus on today?",
  "Which leads are hot?",
  "Which employee is falling behind?",
  "Which task is delayed?",
  "Which payment is pending?",
  "Why are we losing leads?",
];

export default function AiCeoChat() {
  const [messages, setMessages] = useState<AiCeoMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function askAiCeo(nextQuestion?: string) {
    const finalQuestion = (nextQuestion || question).trim();

    if (!finalQuestion || loading) return;

    const nextMessages: AiCeoMessage[] = [
      ...messages,
      {
        role: "user",
        content: finalQuestion,
      },
    ];

    setMessages(nextMessages);
    setQuestion("");
    setLoading(true);

    try {
      const data = await apiFetch<AiCeoResponse>("/api/ai-ceo/chat", {
        method: "POST",
        body: JSON.stringify({
          question: finalQuestion,
          history: messages.slice(-10),
        }),
      });

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: data.answer,
        },
      ]);

      if (data.snapshotMeta?.generatedAt) {
        setLastUpdated(data.snapshotMeta.generatedAt);
      }
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "AI CEO failed to answer right now.",
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    askAiCeo();
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasMessages = messages.length > 0;

  return (
    <section className="relative flex h-[calc(100vh-142px)] min-h-[680px] overflow-hidden rounded-[34px] border border-white/10 bg-[#05070d]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.13),transparent_35%),radial-gradient(circle_at_80%_15%,rgba(168,85,247,0.12),transparent_32%)]" />

      <main className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-white/10 bg-black/20 px-5 py-4 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-black">
                <Brain size={22} />
              </div>

              <div>
                <h1 className="text-xl font-semibold tracking-[-0.04em]">
                  Ask AI CEO
                </h1>
                <p className="text-xs text-white/40">
                  Company, leads, tasks, team, calls and WhatsApp intelligence
                </p>
              </div>
            </div>

            <div className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100 md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Real company data
            </div>
          </div>
        </header>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6"
        >
          {!hasMessages ? (
            <WelcomeScreen
              lastUpdated={lastUpdated}
              onAsk={(value) => askAiCeo(value)}
              loading={loading}
            />
          ) : (
            <div className="mx-auto max-w-4xl space-y-6 pb-8">
              {messages.map((message, index) => (
                <MessageRow
                  key={`${message.role}-${index}`}
                  message={message}
                />
              ))}

              {loading ? (
                <div className="flex gap-4">
                  <Avatar type="assistant" />

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 text-sm font-medium text-white/70">
                      AI CEO
                    </div>

                    <div className="inline-flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/50">
                      <Loader2 className="animate-spin" size={17} />
                      Checking real company data...
                    </div>
                  </div>
                </div>
              ) : null}

              {lastUpdated ? (
                <p className="text-center text-xs text-white/25">
                  Last checked{" "}
                  {new Date(lastUpdated).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white/10 bg-[#05070d]/90 px-4 py-4 backdrop-blur-2xl md:px-6">
          <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-2 shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
              <div className="flex items-end gap-2">
                <input
                  ref={inputRef}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask anything about your company..."
                  className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-white/30"
                />

                <button
                  disabled={loading || !question.trim()}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-black transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </div>
            </div>

            <p className="mt-3 text-center text-xs text-white/25">
              AI CEO answers from real CRM, task, team, call and WhatsApp data.
              Revenue stays unavailable until payments are connected.
            </p>
          </form>
        </div>
      </main>
    </section>
  );
}

function WelcomeScreen({
  onAsk,
  loading,
  lastUpdated,
}: {
  onAsk: (value: string) => void;
  loading: boolean;
  lastUpdated: string;
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center py-10 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-[2rem] bg-white text-black shadow-[0_24px_90px_rgba(255,255,255,0.12)]">
        <Brain size={38} />
      </div>

      <h2 className="mt-7 text-4xl font-semibold tracking-[-0.06em] md:text-6xl">
        Ask AI CEO
      </h2>

      <p className="mt-4 max-w-2xl text-sm leading-7 text-white/45 md:text-base">
        Ask about your company, leads, employees, delayed tasks, calls,
        WhatsApp conversations, handoffs and what you should focus on today.
      </p>

      {lastUpdated ? (
        <p className="mt-3 text-xs text-white/25">
          Last checked{" "}
          {new Date(lastUpdated).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      ) : null}

      <div className="mt-10 grid w-full gap-3 md:grid-cols-2 xl:grid-cols-3">
        {quickQuestions.map((item) => (
          <button
            key={item}
            disabled={loading}
            onClick={() => onAsk(item)}
            className="group rounded-[26px] border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-white/70 group-hover:bg-white group-hover:text-black">
              {getQuestionIcon(item)}
            </div>

            <p className="text-sm font-medium leading-6 text-white/75">
              {item}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-10 grid w-full gap-3 md:grid-cols-4">
        <InfoCard
          icon={<Target size={18} />}
          title="Leads"
          text="Hot, cold, won and lost leads"
        />
        <InfoCard
          icon={<UsersRound size={18} />}
          title="Team"
          text="Workload and delayed employees"
        />
        <InfoCard
          icon={<Clock3 size={18} />}
          title="Tasks"
          text="Open, blocked and delayed work"
        />
        <InfoCard
          icon={<MessageCircle size={18} />}
          title="Chats"
          text="Calls, WhatsApp and handoffs"
        />
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: AiCeoMessage }) {
  const isUser = message.role === "user";

  return (
    <div className="flex gap-4">
      <Avatar type={isUser ? "user" : "assistant"} />

      <div className="min-w-0 flex-1">
        <div className="mb-2 text-sm font-medium text-white/70">
          {isUser ? "You" : "AI CEO"}
        </div>

        <div
          className={`whitespace-pre-wrap rounded-[26px] border px-5 py-4 text-sm leading-7 ${
            isUser
              ? "border-white/10 bg-white text-black"
              : "border-white/10 bg-white/[0.04] text-white/80"
          }`}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}

function Avatar({ type }: { type: "user" | "assistant" }) {
  return (
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
        type === "user" ? "bg-white text-black" : "bg-cyan-400/15 text-cyan-100"
      }`}
    >
      {type === "user" ? <Building2 size={18} /> : <Bot size={18} />}
    </div>
  );
}

function InfoCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/20 p-4 text-left">
      <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-white/35">{text}</p>
    </div>
  );
}

function getQuestionIcon(question: string) {
  if (question.toLowerCase().includes("lead")) {
    return <Target size={18} />;
  }

  if (
    question.toLowerCase().includes("employee") ||
    question.toLowerCase().includes("behind")
  ) {
    return <UsersRound size={18} />;
  }

  if (
    question.toLowerCase().includes("task") ||
    question.toLowerCase().includes("delayed")
  ) {
    return <Clock3 size={18} />;
  }

  if (
    question.toLowerCase().includes("payment") ||
    question.toLowerCase().includes("pending")
  ) {
    return <Building2 size={18} />;
  }

  return <Sparkles size={18} />;
}