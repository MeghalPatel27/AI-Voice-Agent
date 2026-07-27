import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { formatDateTime, formatEnum } from "../types/crm";

export type TranscriptLine = {
  id: string;
  speaker: "CUSTOMER" | "AI" | "HUMAN" | "UNKNOWN";
  text: string;
  at?: string | null;
};

function looksLikeToolOrSystemPayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^(system|tool|function_call|tool_call)\b/i.test(trimmed)) return true;
  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    /"(name|arguments|tool_calls|role|content)"/.test(trimmed)
  ) {
    return true;
  }
  return false;
}

function parseTranscriptText(raw?: string | null): TranscriptLine[] {
  if (!raw?.trim()) return [];

  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !looksLikeToolOrSystemPayload(line))
    .map((line, index) => {
      const match = line.match(
        /^(Customer|User|AI|Assistant|Human|Agent)\s*[:-]\s*(.+)$/i,
      );
      if (match) {
        const label = match[1].toLowerCase();
        const speaker: TranscriptLine["speaker"] =
          label === "customer" || label === "user"
            ? "CUSTOMER"
            : label === "human" || label === "agent"
              ? "HUMAN"
              : "AI";
        return {
          id: `line-${index}`,
          speaker,
          text: match[2],
        };
      }

      return {
        id: `line-${index}`,
        speaker: "UNKNOWN" as const,
        text: line,
      };
    });
}

export function TranscriptPanel({
  title = "Transcript",
  raw,
  messages,
  defaultExpanded = false,
}: {
  title?: string;
  raw?: string | null;
  messages?: Array<{
    id: string;
    senderType: string;
    body: string;
    createdAt: string;
  }>;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const lines = useMemo(() => {
    if (messages?.length) {
      return messages
        .filter((message) => !looksLikeToolOrSystemPayload(message.body))
        .map((message) => ({
          id: message.id,
          speaker:
            message.senderType === "CUSTOMER"
              ? ("CUSTOMER" as const)
              : message.senderType === "AI"
                ? ("AI" as const)
                : message.senderType === "HUMAN"
                  ? ("HUMAN" as const)
                  : ("UNKNOWN" as const),
          text: message.body,
          at: message.createdAt,
        }));
    }
    return parseTranscriptText(raw);
  }, [messages, raw]);

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/20 p-5">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex items-center gap-2 text-white/70">
          <FileText size={20} aria-hidden />
          <span className="text-lg font-semibold tracking-[-0.03em]">{title}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/45">
            {lines.length ? `${lines.length} lines` : "Empty"}
          </span>
        </span>
        {expanded ? (
          <ChevronDown size={18} aria-hidden />
        ) : (
          <ChevronRight size={18} aria-hidden />
        )}
      </button>

      {expanded ? (
        <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {lines.length === 0 ? (
            <p className="text-sm text-white/40">
              No customer/AI dialogue is available yet.
            </p>
          ) : (
            lines.map((line) => <TranscriptBubble key={line.id} line={line} />)
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-white/35">
          Transcript is collapsed. Expand to read the full conversation.
        </p>
      )}
    </section>
  );
}

function TranscriptBubble({ line }: { line: TranscriptLine }) {
  const tone =
    line.speaker === "CUSTOMER"
      ? "border-white/10 bg-black/25"
      : line.speaker === "AI"
        ? "border-cyan-500/20 bg-cyan-500/10"
        : "border-white/20 bg-white/[0.08]";

  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="mb-2 text-xs text-white/35">
        {formatEnum(line.speaker)}
        {line.at ? ` · ${formatDateTime(line.at)}` : ""}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-white/60">
        {line.text}
      </p>
    </div>
  );
}

export function Panel({
  title,
  icon,
  children,
  actions,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-black/20 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-white/70">
          {icon}
          <h3 className="text-lg font-semibold tracking-[-0.03em]">{title}</h3>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
