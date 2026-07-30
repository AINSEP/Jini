import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isValidTimezone,
  isValidWallTime,
  nextHourlyRunAt,
  nextRunAtForSchedule,
  nextWallTimeMatching,
  partsInTimezone,
  tzWallToUtcCandidates,
  tzWallToUtcGapFallback,
  validateSchedule,
  validateTarget,
} from '../schedule.js';

function partsIn(timezone: string, at: Date): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const out: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  if (out.hour === '24') out.hour = '00';
  return out;
}

describe('nextRunAtForSchedule DST handling', () => {
  it('does not fire before the requested wall time on a spring-forward gap day', () => {
    // 2026-03-08 in America/New_York: clocks jump 02:00 EST -> 03:00 EDT, so a daily routine
    // scheduled at 02:30 has no valid wall clock that day. The fixed scheduler must instead
    // advance to a valid post-gap instant on the same day.
    const now = new Date('2026-03-08T05:00:00Z');
    const next = nextRunAtForSchedule({ kind: 'daily', time: '02:30', timezone: 'America/New_York' }, now);
    expect(next).not.toBeNull();
    if (!next) return;

    const parts = partsIn('America/New_York', next);
    expect(parts.year).toBe('2026');
    expect(parts.month).toBe('03');
    expect(parts.day).toBe('08');

    const wallMinutes = Number(parts.hour) * 60 + Number(parts.minute);
    expect(wallMinutes).toBeGreaterThanOrEqual(2 * 60 + 30);
  });

  it('still fires the second occurrence when the wall time itself is in the repeated hour', () => {
    // 2026-11-01 in America/New_York: 01:30 happens twice — first at 05:30Z (EDT) and again at
    // 06:30Z (EST) after clocks fall back. Checking at 05:45Z (between the two occurrences), a
    // daily routine at 01:30 must still fire today at 06:30Z, not skip to the next day.
    const now = new Date('2026-11-01T05:45:00Z');
    const next = nextRunAtForSchedule({ kind: 'daily', time: '01:30', timezone: 'America/New_York' }, now);
    expect(next).not.toBeNull();
    if (!next) return;

    expect(next.getTime()).toBe(Date.UTC(2026, 10, 1, 6, 30));
    const parts = partsIn('America/New_York', next);
    expect(parts.year).toBe('2026');
    expect(parts.month).toBe('11');
    expect(parts.day).toBe('01');
    expect(parts.hour).toBe('01');
    expect(parts.minute).toBe('30');
  });

  it('returns the first occurrence in the repeated hour when now is before either instance', () => {
    const now = new Date('2026-11-01T05:00:00Z');
    const next = nextRunAtForSchedule({ kind: 'daily', time: '01:30', timezone: 'America/New_York' }, now);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.getTime()).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it('selects the post-fall-back instance on a fall-back day with ambiguous wall times', () => {
    // For a daily routine at 02:30, the only valid instance on the fall-back day is 02:30 EST
    // (07:30Z) — must pick that one regardless of candidate ordering.
    const now = new Date('2026-11-01T05:00:00Z');
    const next = nextRunAtForSchedule({ kind: 'daily', time: '02:30', timezone: 'America/New_York' }, now);
    expect(next).not.toBeNull();
    if (!next) return;

    const parts = partsIn('America/New_York', next);
    expect(parts.year).toBe('2026');
    expect(parts.month).toBe('11');
    expect(parts.day).toBe('01');
    expect(parts.hour).toBe('02');
    expect(parts.minute).toBe('30');
  });

  it('returns the requested wall time on non-transition days', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    const next = nextRunAtForSchedule({ kind: 'daily', time: '02:30', timezone: 'America/New_York' }, now);
    expect(next).not.toBeNull();
    if (!next) return;

    const parts = partsIn('America/New_York', next);
    expect(parts.hour).toBe('02');
    expect(parts.minute).toBe('30');
  });

  it('returns the next hourly slot strictly after now', () => {
    const now = new Date('2026-05-13T10:45:30Z');
    const next = nextRunAtForSchedule({ kind: 'hourly', minute: 15 }, now);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.toISOString()).toBe('2026-05-13T11:15:00.000Z');
  });

  it('rolls the hourly slot to the next hour when the current minute has already passed (default now)', () => {
    // Exercises nextHourlyRunAt's default `now = new Date()` parameter directly, and the
    // "already passed this hour" branch without depending on wall-clock timing races.
    const now = new Date('2026-05-13T10:30:00Z');
    const next = nextHourlyRunAt(15, now);
    expect(next.toISOString()).toBe('2026-05-13T11:15:00.000Z');
  });

  it('returns the next weekday occurrence for weekday schedules', () => {
    const now = new Date('2026-05-16T00:00:00Z'); // Saturday
    const next = nextRunAtForSchedule({ kind: 'weekdays', time: '09:00', timezone: 'UTC' }, now);
    expect(next).not.toBeNull();
    if (!next) return;

    const parts = partsIn('UTC', next);
    expect(parts.year).toBe('2026');
    expect(parts.month).toBe('05');
    expect(parts.day).toBe('18');
    expect(parts.hour).toBe('09');
    expect(parts.minute).toBe('00');
  });

  it('returns the next requested weekday for weekly schedules', () => {
    const now = new Date('2026-05-13T10:00:00Z'); // Wednesday
    const next = nextRunAtForSchedule({ kind: 'weekly', weekday: 5, time: '08:30', timezone: 'UTC' }, now);
    expect(next).not.toBeNull();
    if (!next) return;

    const parts = partsIn('UTC', next);
    expect(parts.year).toBe('2026');
    expect(parts.month).toBe('05');
    expect(parts.day).toBe('15');
    expect(parts.hour).toBe('08');
    expect(parts.minute).toBe('30');
  });

  it('returns null for a schedule kind not covered by any branch (defensive fallback)', () => {
    const next = nextRunAtForSchedule({ kind: 'never' } as unknown as Parameters<typeof nextRunAtForSchedule>[0]);
    expect(next).toBeNull();
  });

  it('returns null when the wall-time regex does not match', () => {
    const next = nextRunAtForSchedule({ kind: 'daily', time: 'not-a-time', timezone: 'UTC' });
    expect(next).toBeNull();
  });

  it('returns null when the parsed hour or minute is out of range', () => {
    expect(nextRunAtForSchedule({ kind: 'daily', time: '99:00', timezone: 'UTC' })).toBeNull();
    expect(nextRunAtForSchedule({ kind: 'daily', time: '10:99', timezone: 'UTC' })).toBeNull();
  });

  it('continues to the next day when the spring-forward gap fallback itself is not after now', () => {
    // 2026-03-08 in America/New_York is the spring-forward gap day (02:00 EST -> 03:00 EDT).
    // Pick `now` already past the 02:15 post-gap fallback instant on that same day, so the walk
    // must roll to the next day's ordinary 02:15 instead of re-firing the gap-day fallback.
    const now = new Date('2026-03-08T08:00:00Z');
    const next = nextRunAtForSchedule({ kind: 'daily', time: '02:15', timezone: 'America/New_York' }, now);
    expect(next).not.toBeNull();
    if (!next) return;
    const parts = partsIn('America/New_York', next);
    expect(parts.month).toBe('03');
    expect(parts.day).toBe('09');
    expect(parts.hour).toBe('02');
    expect(parts.minute).toBe('15');
  });

  it('nextWallTimeMatching returns null once the 14-day safety walk is exhausted without a predicate match', () => {
    // No public schedule kind can construct a predicate that never matches (weekly/weekdays
    // always match within 7 days) — this proves the walk-exhaustion fallback directly instead of
    // leaving it structurally unreachable dead code.
    const next = nextWallTimeMatching('UTC', '09:00', () => false, new Date('2026-05-01T00:00:00Z'));
    expect(next).toBeNull();
  });

  it('nextWallTimeMatching returns null when the time string fails the HH:MM regex', () => {
    expect(nextWallTimeMatching('UTC', 'garbage', () => true, new Date())).toBeNull();
  });

  it('tzWallToUtcCandidates returns [] for an invalid timezone instead of throwing', () => {
    expect(tzWallToUtcCandidates('Not/AZone', 2026, 5, 1, 9, 0)).toEqual([]);
  });

  it('tzWallToUtcGapFallback returns null for an invalid timezone instead of throwing', () => {
    expect(tzWallToUtcGapFallback('Not/AZone', 2026, 5, 1, 9, 0)).toBeNull();
  });

  it('tzWallToUtcGapFallback picks the later of the two probe candidates on a gap day where candidate1 > candidate2 (America/New_York)', () => {
    const fallback = tzWallToUtcGapFallback('America/New_York', 2026, 3, 8, 2, 30);
    expect(fallback?.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('tzWallToUtcGapFallback picks the later of the two probe candidates on a gap day where candidate2 > candidate1 (Europe/London)', () => {
    // Europe/London's 2026-03-29 spring-forward gap resolves with the two candidates in the
    // opposite order from the America/New_York case above, exercising the ternary's other arm.
    const fallback = tzWallToUtcGapFallback('Europe/London', 2026, 3, 29, 1, 30);
    expect(fallback?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('throws for an invalid timezone reaching the wall-time walk (no internal guard here — callers must validate via validateSchedule/isValidTimezone first, same as the OD original)', () => {
    // `nextWallTimeMatching`'s per-day loop calls `partsInTimezone` unguarded (unlike
    // `isValidTimezone`, which wraps the same `Intl.DateTimeFormat` construction in try/catch) —
    // this is inherited, faithfully-ported behavior, not introduced by this port. In practice a
    // schedule reaches here only after `validateSchedule` has already rejected a bad timezone.
    expect(() => nextRunAtForSchedule({ kind: 'daily', time: '09:00', timezone: 'Not/AZone' })).toThrow(
      /Invalid time zone/,
    );
  });

  it('returns null instead of throwing when the requested wall time is past the maximum representable Date', () => {
    // `now` is the largest instant a `Date` can hold (+275760-09-13T00:00:00Z). Asking for a
    // later wall time *on that same day* makes `Date.UTC(...)` overflow to `NaN`, so
    // `new Date(NaN)` makes Intl's `formatToParts` throw `RangeError: Invalid time value` —
    // swallowed by both `tzWallToUtcCandidates` (yielding an empty candidate list, which looks
    // exactly like a spring-forward gap) and `tzWallToUtcGapFallback` (yielding null). This is
    // the one real input that reaches the gap-fallback null guard even though `timezone` itself
    // is perfectly valid, and it must degrade to `null` rather than throw or spin all 14 days.
    const maxDate = new Date(8_640_000_000_000_000);
    expect(maxDate.getTime()).toBe(8_640_000_000_000_000); // sanity: still a valid Date
    expect(nextWallTimeMatching('UTC', '23:59', () => true, maxDate)).toBeNull();
  });
});

describe('isValidWallTime / isValidTimezone', () => {
  it('accepts well-formed HH:MM within range', () => {
    expect(isValidWallTime('00:00')).toBe(true);
    expect(isValidWallTime('23:59')).toBe(true);
  });

  it('rejects malformed or out-of-range wall times', () => {
    expect(isValidWallTime('9:00')).toBe(false);
    expect(isValidWallTime('24:00')).toBe(false);
    expect(isValidWallTime('10:60')).toBe(false);
    expect(isValidWallTime('not-a-time')).toBe(false);
  });

  it('accepts a real IANA timezone and rejects an invalid one', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });

  it('rejects an empty or non-string timezone', () => {
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(null as unknown as string)).toBe(false);
  });
});

describe('partsInTimezone — defensive Intl-output fallbacks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes an Intl-reported hour of "24" to 0 (documented ICU quirk at local midnight some locale/zone combinations hit)', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([
      { type: 'year', value: '2026' },
      { type: 'month', value: '05' },
      { type: 'day', value: '01' },
      { type: 'hour', value: '24' },
      { type: 'minute', value: '00' },
      { type: 'second', value: '00' },
      { type: 'weekday', value: 'Fri' },
    ] as Intl.DateTimeFormatPart[]);
    expect(partsInTimezone('UTC', new Date()).hour).toBe(0);
  });

  it('defaults an unrecognized weekday abbreviation to 0, and a missing part type to "0"', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([
      { type: 'year', value: '2026' },
      { type: 'month', value: '05' },
      { type: 'day', value: '01' },
      { type: 'hour', value: '09' },
      { type: 'minute', value: '00' },
      // no 'second' part at all — exercises the `get()` helper's own `?? '0'` fallback.
      { type: 'weekday', value: 'Xyz' },
    ] as Intl.DateTimeFormatPart[]);
    const parts = partsInTimezone('UTC', new Date());
    expect(parts.second).toBe(0);
    expect(parts.weekday).toBe(0);
  });
});

describe('validateSchedule / validateTarget', () => {
  it('accepts valid schedule and target shapes', () => {
    expect(() => validateSchedule({ kind: 'weekly', weekday: 1, time: '09:00', timezone: 'UTC' })).not.toThrow();
    expect(() => validateSchedule({ kind: 'hourly', minute: 30 })).not.toThrow();
    expect(() => validateSchedule({ kind: 'daily', time: '09:00', timezone: 'UTC' })).not.toThrow();
    expect(() => validateSchedule({ kind: 'weekdays', time: '09:00', timezone: 'UTC' })).not.toThrow();
    expect(() => validateTarget({ mode: 'create_each_run' })).not.toThrow();
    expect(() => validateTarget({ mode: 'reuse', projectId: 'proj-1' })).not.toThrow();
  });

  it('rejects a missing/non-object schedule', () => {
    expect(() => validateSchedule(null as unknown as Parameters<typeof validateSchedule>[0])).toThrow('schedule is required');
  });

  it('rejects an out-of-range hourly minute', () => {
    expect(() => validateSchedule({ kind: 'hourly', minute: 60 })).toThrow(/hourly\.minute/);
    expect(() => validateSchedule({ kind: 'hourly', minute: 1.5 })).toThrow(/hourly\.minute/);
  });

  it('rejects invalid wall times and timezones', () => {
    expect(() => validateSchedule({ kind: 'daily', time: '25:00', timezone: 'UTC' })).toThrow(/Invalid time/);
    expect(() => validateSchedule({ kind: 'daily', time: '09:00', timezone: 'Mars/Olympus' })).toThrow(/Invalid timezone/);
  });

  it('rejects invalid weekday and unsupported target mode', () => {
    expect(() => validateSchedule({ kind: 'weekly', weekday: 9 as 0, time: '09:00', timezone: 'UTC' })).toThrow(/weekly\.weekday/);
    expect(() =>
      validateTarget({ mode: 'teleport' } as unknown as Parameters<typeof validateTarget>[0]),
    ).toThrow(/Unsupported routine target mode/);
  });

  it('rejects an unsupported schedule kind', () => {
    expect(() =>
      validateSchedule({ kind: 'never' } as unknown as Parameters<typeof validateSchedule>[0]),
    ).toThrow(/Unsupported schedule kind/);
  });

  it('rejects a missing/non-object target', () => {
    expect(() => validateTarget(null as unknown as Parameters<typeof validateTarget>[0])).toThrow('target is required');
  });

  it('rejects reuse targets without a project id', () => {
    expect(() => validateTarget({ mode: 'reuse', projectId: '' })).toThrow(/projectId/);
  });
});
