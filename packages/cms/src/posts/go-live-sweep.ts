import type { OutboxPort } from "@jini-ai/core/contracts/events";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { Clock as ClockPort } from "@jini-ai/core/primitives";
import { nowIso as clockNowIso } from "@jini-ai/core/primitives";

import { announceDueGoLives, type GoLiveCandidatesPort } from "../entries/go-live.js";

/**
 * @file The go-live sweep's host scheduling (split from `go-live.ts`, 2026-11-18): an interval
 * timer, the mutable cells `afterIso`, `active` and `stopped`, an immediate first pass,
 * single-flight, and a `stop()` that waits for the pass in flight. That lifecycle belongs to the
 * serving process and stays in the host; the pure decisions and announce functions it drives stay in
 * `go-live.ts`, which has no timer or clock of its own.
 */

/** Idle wait between sweeps; bounds how late a go-live is announced. */
export const POST_GO_LIVE_SWEEP_INTERVAL_MS = 60_000;

/** How far behind the previous pass's instant each later pass re-reads. Covers a save whose
 *  transaction committed after a pass had already read past its `publishAt`; the overlap is safe
 *  because a repeated event id is a no-op. */
export const POST_GO_LIVE_LOOKBACK_MS = 10 * 60_000;

type IntervalHandle = { unref?: () => void };

function warn({ error }: { error: unknown }, _optional = {}): void {
  console.error("[post-go-live-sweep] sweep failed; retrying after the idle interval", error);
}

/**
 * Starts the go-live sweep: a full catch-up pass now (posts that went live while the process was
 * down), then a pass every `intervalMs` over the window since the previous successful pass minus
 * {@link POST_GO_LIVE_LOOKBACK_MS}. Same lifecycle shape as the submission-IP sweep: unref'd
 * interval, an overlapping tick is skipped (single-flight), and `stop()` waits for a pass in flight.
 * A failed pass keeps the previous window start, so the next pass retries the same range.
 *
 * Start it only in a site-serving process, after `createApp` has subscribed the bus handlers
 * (`serving-app.ts`), like the outbox drainer it feeds.
 *
 * @param required.deps.repo, required.deps.outbox, required.deps.clock what a pass reads/writes.
 * @param required.workspaceId the served workspace.
 * @param optional.intervalMs idle wait (default {@link POST_GO_LIVE_SWEEP_INTERVAL_MS}).
 * @param optional.onError receives a failed pass's error (default `console.error`); its own throw is swallowed.
 * @param optional.timers injectable `setInterval`/`clearInterval` (tests).
 * @param optional.tracker traces each go-live sweep pass.
 * @returns `{ stop }`.
 * @throws RangeError for a non-positive interval.
 * @complexity O(candidates) per pass.
 */
export function startPostGoLiveSweep(
  required: { deps: { repo: GoLiveCandidatesPort; outbox: OutboxPort; clock: ClockPort }; workspaceId: string },
  optional: {
    intervalMs?: number;
    tracker?: Tracker;
    onError?: (required: { error: unknown }, optional?: Record<string, never>) => void;
    timers?: { setInterval: (required: { fn: () => void; ms: number }, optional?: Record<string, never>) => IntervalHandle; clearInterval: (required: { handle: IntervalHandle }, optional?: Record<string, never>) => void };
  } = {}
): { stop(): Promise<void> } {
  const { intervalMs = POST_GO_LIVE_SWEEP_INTERVAL_MS, onError = warn } = optional;
  const timers: NonNullable<typeof optional.timers> = optional.timers ?? { setInterval: ({ fn, ms }, _optional = {}) => setInterval(fn, ms), clearInterval: ({ handle }, _optional = {}) => clearInterval(handle as ReturnType<typeof setInterval>) };
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new RangeError("post go-live sweep interval must be positive");
  const { deps, workspaceId } = required;
  let afterIso: string | undefined;
  let active: Promise<void> | undefined;
  let stopped = false;
  const run = async (): Promise<void> => {
    const nowIso = clockNowIso({ clock: deps.clock });
    try {
      const announce = () => announceDueGoLives({ deps, input: { workspaceId, nowIso } }, afterIso === undefined ? {} : { afterIso });
      await (optional.tracker ? optional.tracker.trace({ name: "post.go_live.sweep", run: announce }) : announce());
      afterIso = new Date(Date.parse(nowIso) - POST_GO_LIVE_LOOKBACK_MS).toISOString();
    } catch (error) {
      try { onError({ error }); } catch { /* A logging failure cannot reject timer work. */ }
    }
  };
  const pass = (): void => {
    if (stopped || active !== undefined) return;
    active = run().finally(() => { active = undefined; });
  };
  pass();
  const timer = timers.setInterval({ fn: pass, ms: intervalMs });
  timer.unref?.();
  return {
    stop: async () => {
      stopped = true;
      timers.clearInterval({ handle: timer });
      await active;
    },
  };
}
