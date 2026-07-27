/**
 * Lightweight process / event-loop sampler for voice call profiling.
 * Measurement only — never blocks the realtime path beyond a short timer tick.
 */

import type { ResourceSample } from "./types";

export type ResourceMonitorOptions = {
  intervalMs?: number;
  eventLoopBlockThresholdMs?: number;
};

export class ResourceMonitor {
  private timer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private lastCpu = process.cpuUsage();
  private lastWallMs = 0;
  private samples: ResourceSample[] = [];
  private peakRssMb = 0;
  private peakHeapUsedMb = 0;
  private peakCpuPercent = 0;
  private peakEventLoopLagMs = 0;
  private blockedSampleCount = 0;
  private readonly intervalMs: number;
  private readonly blockThresholdMs: number;

  constructor(options: ResourceMonitorOptions = {}) {
    this.intervalMs = options.intervalMs ?? 2000;
    this.blockThresholdMs = options.eventLoopBlockThresholdMs ?? 50;
  }

  start() {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.lastCpu = process.cpuUsage();
    this.lastWallMs = Date.now();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Do not keep the process alive solely for profiling.
    this.timer.unref?.();
    this.tick();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.tick();
  }

  getSamples() {
    return this.samples.slice();
  }

  getSummary() {
    const cpuValues = this.samples.map((s) => s.cpuPercent);
    const lagValues = this.samples.map((s) => s.eventLoopLagMs);
    const rssValues = this.samples.map((s) => s.rssMb);
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];

    const avg = (values: number[]) =>
      values.length
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : 0;

    return {
      cpu: {
        avgPercent: round2(avg(cpuValues)),
        peakPercent: round2(this.peakCpuPercent),
        samples: this.samples.length,
      },
      memory: {
        startRssMb: round2(first?.rssMb ?? 0),
        endRssMb: round2(last?.rssMb ?? 0),
        peakRssMb: round2(this.peakRssMb),
        peakHeapUsedMb: round2(this.peakHeapUsedMb),
        deltaRssMb: round2((last?.rssMb ?? 0) - (first?.rssMb ?? 0)),
        samples: this.samples.length,
      },
      eventLoop: {
        avgLagMs: round2(avg(lagValues)),
        peakLagMs: round2(this.peakEventLoopLagMs),
        blockedSampleCount: this.blockedSampleCount,
        blockThresholdMs: this.blockThresholdMs,
        samples: this.samples.length,
      },
    };
  }

  private tick() {
    const now = Date.now();
    const wallDeltaMs = Math.max(1, now - this.lastWallMs);
    const cpuDelta = process.cpuUsage(this.lastCpu);
    const cpuMicros = cpuDelta.user + cpuDelta.system;
    const cpuPercent = (cpuMicros / 1000 / wallDeltaMs) * 100;

    // Event-loop lag: how late this interval fired vs the configured period.
    const expectedGap = this.lastWallMs
      ? this.intervalMs
      : this.intervalMs;
    const eventLoopLagMs = Math.max(0, wallDeltaMs - expectedGap);

    const mem = process.memoryUsage();
    const rssMb = mem.rss / (1024 * 1024);
    const heapUsedMb = mem.heapUsed / (1024 * 1024);
    const externalMb = mem.external / (1024 * 1024);

    this.peakRssMb = Math.max(this.peakRssMb, rssMb);
    this.peakHeapUsedMb = Math.max(this.peakHeapUsedMb, heapUsedMb);
    this.peakCpuPercent = Math.max(this.peakCpuPercent, cpuPercent);
    this.peakEventLoopLagMs = Math.max(this.peakEventLoopLagMs, eventLoopLagMs);
    if (eventLoopLagMs >= this.blockThresholdMs) {
      this.blockedSampleCount += 1;
    }

    this.samples.push({
      at: new Date(now).toISOString(),
      elapsedMs: now - this.startedAt,
      cpuPercent: round2(cpuPercent),
      rssMb: round2(rssMb),
      heapUsedMb: round2(heapUsedMb),
      externalMb: round2(externalMb),
      eventLoopLagMs: round2(eventLoopLagMs),
    });

    // Cap memory for very long calls (keep newest ~30 minutes at 2s interval).
    if (this.samples.length > 900) {
      this.samples.splice(0, this.samples.length - 900);
    }

    this.lastCpu = process.cpuUsage();
    this.lastWallMs = now;
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
