import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

/*
 * Wave 6 (W6-TEST-01, scope amendment A-18): context for latency failures.
 *
 * The SEC-002 timing tests assert absolute wall-clock and event-loop numbers.
 * When another process loads the machine they can fail for a reason that has
 * nothing to do with the code. This helper only MEASURES the environment
 * (event-loop lag over one second before the file's tests, and the 1-minute
 * load average where the OS reports one) so that a latency assertion's
 * failure message says how noisy the machine was.
 *
 * It never changes a threshold, never retries, never bypasses a test and is
 * not controlled by any environment variable: a failing assertion still fails.
 */

export interface NoiseBaseline {
  lagP99Ms: number;
  lagMaxMs: number;
  loadAvg1: number | null;
  cpus: number;
}

/** Sample event-loop delay for `ms` (default 1 s) while idle. */
export const measureNoiseBaseline = async (ms = 1000): Promise<NoiseBaseline> => {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  await new Promise((resolve) => setTimeout(resolve, ms));
  histogram.disable();
  const load = os.loadavg()[0];
  return {
    lagP99Ms: histogram.percentile(99) / 1e6,
    lagMaxMs: histogram.max / 1e6,
    // Windows reports 0 for every load average: treat it as unavailable.
    loadAvg1: process.platform === "win32" && load === 0 ? null : load,
    cpus: os.cpus().length,
  };
};

/** Suffix for an assertion message: " [environment: ...]". */
export const noiseNote = (baseline: NoiseBaseline | undefined): string => {
  if (!baseline) return " [environment: baseline not measured]";
  const load = baseline.loadAvg1 === null ? "n/a" : baseline.loadAvg1.toFixed(2);
  return ` [environment before this file: event-loop lag p99 ${baseline.lagP99Ms.toFixed(1)} ms, max ${baseline.lagMaxMs.toFixed(1)} ms; 1-min load average ${load} on ${baseline.cpus} CPUs]`;
};
