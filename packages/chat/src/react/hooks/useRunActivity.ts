/**
 * @module useRunActivity
 *
 * The live activity line for a running turn: `deriveRunActivity` over the message's events, a
 * one-second clock, and the one label table (`RUN_ACTIVITY_LABELS`). Returns `null` when inactive,
 * so the caller renders nothing and no timer runs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent } from '../../core/index.js';
import { deriveRunActivity, describeRunActivity } from '../../core/index.js';
import { useT } from './context.js';

/** Wall-clock source, swappable in tests. */
export type NowFn = () => number;

/**
 * @param events - The running message's events.
 * @param active - True while the turn is in progress; the clock only ticks while true.
 * @param now - Clock source (default `Date.now`).
 * @returns The activity line's text, or `null` when `active` is false.
 * @complexity O(n) in events per render (memoized on the events array).
 */
export function useRunActivity({ events, active }: { events: readonly AgentEvent[] | undefined; active: boolean }, { now = Date.now }: { now?: (NowFn) | undefined } = {}): string | null {
  const t = useT();
  const state = useMemo(() => deriveRunActivity({ events: events }), [events]);
  const [, setTick] = useState(0);
  const signal = useRef<{ key: string; at: number } | null>(null);
  const visible = useRef<{ count: number; at: number } | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) {
    signal.current = null;
    visible.current = null;
    return null;
  }
  const at = now();
  if (signal.current?.key !== state.key) signal.current = { key: state.key, at };
  if (visible.current?.count !== state.visibleCount) visible.current = { count: state.visibleCount, at };
  const localSeconds = (at - signal.current.at) / 1000;
  const reported = state.activity.kind === 'running-tool' ? (state.activity.reportedSeconds ?? 0) : 0;
  return describeRunActivity({ activity: state.activity, clock: { seconds: Math.max(localSeconds, reported), idleMs: at - visible.current.at }, t: t }
  );
}
