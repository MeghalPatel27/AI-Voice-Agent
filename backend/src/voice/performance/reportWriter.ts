import fs from "fs";
import path from "path";
import type { VoiceCallPerformanceReport } from "./types";

export type ReportWriterOptions = {
  /** Directory for per-call JSON reports. Default: backend/voice-perf-reports */
  directory?: string;
  enabled?: boolean;
};

/**
 * Persist structured call performance summaries for production validation.
 */
export class VoicePerfReportWriter {
  private readonly directory: string;
  private readonly enabled: boolean;

  constructor(options: ReportWriterOptions = {}) {
    this.enabled = options.enabled ?? envBool("VOICE_PERF_REPORTS_ENABLED", true);
    this.directory =
      options.directory ||
      process.env.VOICE_PERF_REPORT_DIR ||
      path.join(process.cwd(), "voice-perf-reports");
  }

  write(report: VoiceCallPerformanceReport): string | null {
    if (!this.enabled) return null;

    try {
      fs.mkdirSync(this.directory, { recursive: true });
      const stamp = report.at.replace(/[:.]/g, "-");
      const sid = sanitize(report.callSid || "unknown");
      const filePath = path.join(
        this.directory,
        `voice-perf-${sid}-${stamp}.json`,
      );
      fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
      return filePath;
    } catch (error) {
      console.error("VoicePerfReportWriter failed:", error);
      return null;
    }
  }
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function envBool(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}
