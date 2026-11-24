import { orFallbackSync } from "@jini-ai/core/errors/idioms";

import type { SubmissionIpRetentionPort, sweepExpiredSubmissionIps } from "../submission-ip-retention.js";

/** The sweep one pass runs; the host passes Jini's `sweepExpiredSubmissionIps` (or its own resolution of it). */
export type SubmissionIpSweep = typeof sweepExpiredSubmissionIps;

/** Daily after the boot pass; the 90-day policy constant belongs solely to Jini. */
export const SUBMISSION_IP_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Refuses a non-positive or non-integer interval. Exported so a host that resolves its sweep before
 * starting can refuse a bad interval first, in the same order this runner does.
 * @throws RangeError when `intervalMs` is not a positive safe integer.
 */
export function assertSubmissionIpSweepInterval(required: { intervalMs: number }, _optional: Record<string, never> = {}): void {
  if (!Number.isSafeInteger(required.intervalMs) || required.intervalMs <= 0) throw new RangeError("submission IP sweep interval must be positive");
}

/**
 * Same lifecycle shape as chat-expiry-sweep: boot, unref'd interval, skip overlapping ticks,
 * and stop/wait before closing the store.
 * @param required.repo - The host's submission IP retention store.
 * @param required.sweep - The pass to run each tick.
 * @param required.onError - Where a failed pass is reported; a throwing reporter is contained.
 * @returns Stop: clears the timer and waits for a running pass.
 */
export function startSubmissionIpExpirySweep(
  required: { repo: SubmissionIpRetentionPort; sweep: SubmissionIpSweep; onError: (required: { error: unknown }) => void },
  optional: { intervalMs?: number; now?: () => number } = {},
): () => Promise<void> {
  const { repo, sweep, onError } = required;
  const { intervalMs = SUBMISSION_IP_SWEEP_INTERVAL_MS, now = Date.now } = optional;
  assertSubmissionIpSweepInterval({ intervalMs });
  const report = ({ error }: { error: unknown }, _optional = {}): void => {
    // A logging failure cannot reject timer work.
    orFallbackSync({ work: () => { onError({ error }); }, fallback: undefined, step: "submission ip sweep error report" });
  };
  let active: Promise<void> | undefined;
  let stopped = false;
  const run = async (): Promise<void> => {
    try { await sweep({ now: now(), repo }); } catch (error) { report({ error }); }
  };
  const pass = (): void => {
    if (stopped || active !== undefined) return;
    active = run().finally(() => { active = undefined; });
  };
  pass();
  const timer = setInterval(pass, intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await active;
  };
}
