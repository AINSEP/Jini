import { describe, expect, it } from 'vitest';
import { describeSurfaceExpiry, formatRemainingTime, SURFACE_EXPIRY_TICK_MS } from '../surface-expiry.js';

const DEADLINE = 1_700_000_300_000;

describe('describeSurfaceExpiry — the answer deadline of a pending card', () => {
  it('is live just before the deadline, rounding the last partial second up so it never reads 0:00 while answerable', () => {
    expect(describeSurfaceExpiry({ expiresAtMs: DEADLINE, nowMs: DEADLINE - 1 })).toEqual({ expired: false, remainingMs: 1, remaining: '0:01' });
  });

  it('is expired exactly at the deadline', () => {
    expect(describeSurfaceExpiry({ expiresAtMs: DEADLINE, nowMs: DEADLINE })).toEqual({ expired: true });
  });

  it('is expired after the deadline', () => {
    expect(describeSurfaceExpiry({ expiresAtMs: DEADLINE, nowMs: DEADLINE + 60_000 })).toEqual({ expired: true });
  });

  it('counts a fresh five-minute card from 5:00', () => {
    expect(describeSurfaceExpiry({ expiresAtMs: DEADLINE, nowMs: DEADLINE - 300_000 })).toEqual({ expired: false, remainingMs: 300_000, remaining: '5:00' });
  });
});

describe('formatRemainingTime', () => {
  it.each([
    [1, '0:01'],
    [999, '0:01'],
    [1_000, '0:01'],
    [1_001, '0:02'],
    [59_000, '0:59'],
    [60_000, '1:00'],
    [61_000, '1:01'],
    [599_000, '9:59'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_661_000, '1:01:01'],
  ])('%i ms reads %s', (ms, text) => {
    expect(formatRemainingTime(ms)).toBe(text);
  });
});

describe('SURFACE_EXPIRY_TICK_MS', () => {
  it('ticks once a second, the resolution the label shows', () => {
    expect(SURFACE_EXPIRY_TICK_MS).toBe(1_000);
  });
});
