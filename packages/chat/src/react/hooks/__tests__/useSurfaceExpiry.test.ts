import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SYSTEM_SURFACE_EXPIRY_CLOCK, useSurfaceExpiry } from '../useSurfaceExpiry.js';
import { fakeClock } from './fake-surface-expiry-clock.js';

const DEADLINE = 1_700_000_300_000;

describe('useSurfaceExpiry', () => {
  it('returns undefined and runs no ticker for a card with no deadline', () => {
    const fake = fakeClock(DEADLINE - 10_000);
    const { result } = renderHook(() => useSurfaceExpiry({ expiresAtMs: undefined }, { clock: fake.clock }));
    expect(result.current).toBeUndefined();
    expect(fake.liveTickers()).toBe(0);
  });

  it('counts down once a second on the injected clock', () => {
    const fake = fakeClock(DEADLINE - 3_000);
    const { result } = renderHook(() => useSurfaceExpiry({ expiresAtMs: DEADLINE }, { clock: fake.clock }));
    expect(result.current).toEqual({ expired: false, remainingMs: 3_000, remaining: '0:03' });
    fake.advance(1_000);
    expect(result.current).toEqual({ expired: false, remainingMs: 2_000, remaining: '0:02' });
    fake.advance(1_000);
    expect(result.current).toEqual({ expired: false, remainingMs: 1_000, remaining: '0:01' });
  });

  it('turns expired on the tick that reaches the deadline, then stops ticking', () => {
    const fake = fakeClock(DEADLINE - 2_000);
    const { result } = renderHook(() => useSurfaceExpiry({ expiresAtMs: DEADLINE }, { clock: fake.clock }));
    fake.advance(2_000);
    expect(result.current).toEqual({ expired: true });
    expect(fake.liveTickers()).toBe(0);
  });

  it('is expired from the first render when the deadline already passed, with no ticker', () => {
    const fake = fakeClock(DEADLINE + 1);
    const { result } = renderHook(() => useSurfaceExpiry({ expiresAtMs: DEADLINE }, { clock: fake.clock }));
    expect(result.current).toEqual({ expired: true });
    expect(fake.liveTickers()).toBe(0);
  });

  it('stops its ticker on unmount', () => {
    const fake = fakeClock(DEADLINE - 5_000);
    const { unmount } = renderHook(() => useSurfaceExpiry({ expiresAtMs: DEADLINE }, { clock: fake.clock }));
    expect(fake.liveTickers()).toBe(1);
    unmount();
    expect(fake.liveTickers()).toBe(0);
  });
});

describe('SYSTEM_SURFACE_EXPIRY_CLOCK', () => {
  it('reads the wall clock and its ticker can be stopped', () => {
    const before = Date.now();
    const read = SYSTEM_SURFACE_EXPIRY_CLOCK.nowMs();
    expect(read).toBeGreaterThanOrEqual(before);
    expect(read).toBeLessThanOrEqual(Date.now());
    let ticks = 0;
    const stop = SYSTEM_SURFACE_EXPIRY_CLOCK.every(60_000, () => { ticks += 1; });
    stop();
    expect(ticks).toBe(0);
  });
});
