import { Sparkles, Target } from "lucide-react";
import {
  analysisStatusLabel,
  intentLevelLabel,
  intentTone,
  type PostCallAnalysisView,
} from "../lib/postCallAnalysis";
import type { HumeExpressionAnalysis } from "../types/crm";
import { formatEnum } from "../types/crm";
import { Panel } from "./TranscriptPanel";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function requirementChips(analysis?: PostCallAnalysisView | null): string[] {
  const details = analysis?.requirementDetails;
  const chips: string[] = [];

  if (analysis?.requirementSummary) chips.push(analysis.requirementSummary);
  if (details?.primaryNeed) chips.push(details.primaryNeed);
  if (details?.businessProblem) chips.push(details.businessProblem);
  if (details?.timelineSignal) chips.push(`Timeline: ${details.timelineSignal}`);
  if (details?.budgetSignal) chips.push(`Budget: ${details.budgetSignal}`);
  if (details?.decisionStage) chips.push(`Stage: ${details.decisionStage}`);
  if (details?.requestedNextStep) {
    chips.push(`Next: ${details.requestedNextStep}`);
  }

  chips.push(...(details?.desiredCapabilities || []));
  chips.push(...(details?.integrationNeeds || []));
  chips.push(
    ...(details?.objections || []).map((item) => `Objection: ${item}`),
  );

  return [...new Set(chips.map((item) => item.trim()).filter(Boolean))];
}

export function RequirementsPanel({
  analysis,
  processingState,
  capturedSummary,
}: {
  analysis?: PostCallAnalysisView | null;
  processingState?: string | null;
  capturedSummary?: string | null;
}) {
  const chips = requirementChips(analysis);
  const display = chips.length ? chips : capturedSummary ? [capturedSummary] : [];

  return (
    <Panel title="Customer requirements" icon={<Target size={20} aria-hidden />}>
      {processingState === "PROCESSING" && display.length === 0 ? (
        <p className="text-sm text-white/40">Requirements processing</p>
      ) : display.length === 0 ? (
        <p className="text-sm text-white/40">No requirements captured</p>
      ) : (
        <div className="flex flex-wrap gap-2" aria-label="Customer requirements">
          {display.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-white/70"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function BusinessIntentPanel({
  analysis,
}: {
  analysis?: PostCallAnalysisView | null;
}) {
  const status = analysis?.analysisStatus || "NONE";
  const tone = intentTone(analysis?.intentLevel);
  const toneClass =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
        : tone === "danger"
          ? "border-red-400/20 bg-red-500/10 text-red-100"
          : "border-white/10 bg-white/[0.04] text-white/55";

  const evidence = asStringArray(analysis?.evidenceSignals);

  return (
    <Panel title="Business intent" icon={<Target size={20} aria-hidden />}>
      <div className="flex flex-wrap gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-[11px] ${toneClass}`}>
          {intentLevelLabel(analysis?.intentLevel)}
        </span>
        <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
          {analysisStatusLabel(status)}
        </span>
        {typeof analysis?.intentScore === "number" ? (
          <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
            Score {analysis.intentScore}
          </span>
        ) : null}
      </div>

      {status === "FAILED" || status === "INSUFFICIENT_DATA" ? (
        <p className="mt-4 text-sm text-white/45">
          {analysis?.failureCode
            ? `Analysis unavailable (${analysis.failureCode}).`
            : analysisStatusLabel(status)}
        </p>
      ) : null}

      {evidence.length > 0 ? (
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-white/55">
          {evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-white/40">
          Business intent is scored from conversation content, separate from vocal expression analytics.
        </p>
      )}
    </Panel>
  );
}

export function HumeInsightsPanel({
  analysis,
}: {
  analysis?: HumeExpressionAnalysis | null;
}) {
  const top = (analysis?.topExpressions || []).slice(0, 3);
  const averages = analysis?.averageScores
    ? Object.entries(analysis.averageScores)
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, 3)
    : [];

  return (
    <Panel title="Hume voice insights" icon={<Sparkles size={20} aria-hidden />}>
      {!analysis ? (
        <p className="text-sm text-white/40">
          Expression insights will appear after Hume chat sync completes.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
              Sync: {formatEnum(analysis.status || "PENDING")}
            </span>
            <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/45">
              User turns: {analysis.userTurnCount || 0}
            </span>
          </div>

          {analysis.status === "FAILED" ? (
            <p className="text-sm text-red-100/80">
              {analysis.failureReason || "Expression analysis failed."}
            </p>
          ) : null}

          {analysis.status === "PENDING" || analysis.status === "PROCESSING" ? (
            <p className="text-sm text-white/45">Expression analysis is still processing.</p>
          ) : null}

          {top.length > 0 ? (
            <div>
              <p className="text-xs text-white/35">Top expressions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {top.map((item) => (
                  <span
                    key={item.name}
                    className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100/80"
                  >
                    {item.name}: {Math.round((item.score || 0) * 100)}%
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {averages.length > 0 ? (
            <div>
              <p className="text-xs text-white/35">Average confidence</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {averages.map(([name, score]) => (
                  <span
                    key={name}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/55"
                  >
                    {name}: {Math.round((score || 0) * 100)}%
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {analysis.insightSummary ? (
            <p className="text-sm leading-6 text-white/55">{analysis.insightSummary}</p>
          ) : null}

          <p className="text-xs leading-5 text-white/35">
            These values are vocal-expression analytics only. They are not buying intent, hot-lead,
            honesty, or affordability scores.
          </p>
        </div>
      )}
    </Panel>
  );
}
