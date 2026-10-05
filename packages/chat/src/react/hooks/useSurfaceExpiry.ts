/**
 * @module useSurfaceExpiry
 *
 * The live countdown for a pending MCP-UI card: `describeSurfaceExpiry` re-read once a second on an
 * injected clock. Ticks only while the card is answerable and has a deadline; an expired card or one
 * without a deadline runs no timer.
 */
import { useEffect, useState } from 'react';
import { describeSurfaceExpiry, SURFACE_EXPIRY_TICK_MS, type SurfaceExpiry } from '../../core/index.js';

/** The clock port: the current time, and a repeating ticker that returns its own stop function. */
export interface SurfaceExpiryClock {
  nowMs(): number;
  every(intervalMs: number, tick: () => void): () => void;
}

/** The wall clock and `setInterval`; the default when a caller injects none. */
export const SYSTEM_SURFACE_EXPIRY_CLOCK: SurfaceExpiryClock = {
  nowMs: () => Date.now(),
  every: (intervalMs, tick) => {
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  },
};

/**
 * @param input.expiresAtMs - The card's deadline (epoch ms), or `undefined` when it has none.
 * @param options.clock - Time source and ticker. Defaults to {@link SYSTEM_SURFACE_EXPIRY_CLOCK}.
 * @returns The deadline's state at the last tick, or `undefined` when there is no deadline.
 * @complexity O(1) per render; one ticker while live.
 */
export function useSurfaceExpiry(
  { expiresAtMs }: { expiresAtMs: number | undefined },
  { clock = SYSTEM_SURFACE_EXPIRY_CLOCK }: { clock?: SurfaceExpiryClock } = {},
): SurfaceExpiry | undefined {
  const [nowMs, setNowMs] = useState(() => clock.nowMs());
  const expiry = expiresAtMs === undefined ? undefined : describeSurfaceExpiry({ expiresAtMs, nowMs });
  const live = expiry?.expired === false;
  useEffect(() => {
    if (!live) return undefined;
    return clock.every(SURFACE_EXPIRY_TICK_MS, () => setNowMs(clock.nowMs()));
  }, [live, clock]);
  return expiry;
}
