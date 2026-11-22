import { describe, expect, it } from 'vitest';
import { toMsClock, type Clock, type IsoClock } from '../time.js';

describe('toMsClock', () => {
  it('returns a millisecond clock as-is, including when it also exposes an ISO clock', () => {
    const clock: Clock = { nowMs: () => 123 };
    const both = { nowMs: () => 456, nowIso: () => '2026-11-13T00:00:00.000Z' };
    expect(toMsClock({ clock })).toBe(clock);
    expect(toMsClock({ clock: both })).toBe(both);
    expect(toMsClock({ clock: both }).nowMs()).toBe(456);
  });

  it('parses each reading of an ISO clock', () => {
    const clock: IsoClock = { nowIso: () => '2026-11-13T00:00:00.000Z' };
    expect(toMsClock({ clock }).nowMs()).toBe(Date.parse('2026-11-13T00:00:00.000Z'));
  });
});
