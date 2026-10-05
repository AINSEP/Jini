import { act } from '@testing-library/react';
import type { SurfaceExpiryClock } from '../useSurfaceExpiry.js';

/** A hand-driven clock: `advance` moves time and fires every live ticker once per elapsed interval. */
export function fakeClock(startMs: number) {
  let nowMs = startMs;
  const tickers = new Set<{ intervalMs: number; dueMs: number; tick: () => void }>();
  const clock: SurfaceExpiryClock = {
    nowMs: () => nowMs,
    every: (intervalMs, tick) => {
      const ticker = { intervalMs, dueMs: nowMs + intervalMs, tick };
      tickers.add(ticker);
      return () => tickers.delete(ticker);
    },
  };
  return {
    clock,
    liveTickers: () => tickers.size,
    advance(ms: number) {
      const target = nowMs + ms;
      for (;;) {
        const due = [...tickers].filter((ticker) => ticker.dueMs <= target).sort((a, b) => a.dueMs - b.dueMs)[0];
        if (due === undefined) break;
        nowMs = due.dueMs;
        due.dueMs += due.intervalMs;
        act(() => due.tick());
      }
      nowMs = target;
    },
  };
}
