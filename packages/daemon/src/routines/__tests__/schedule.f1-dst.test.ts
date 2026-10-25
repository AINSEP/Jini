import { describe, expect, it } from 'vitest';
import { isValidWallTime, nextRunAtForSchedule, nextWallTimeMatching, tzWallToUtcCandidates, tzWallToUtcGapFallback } from '../schedule.js';

// F1 fix wave (Stryker L8 §4 routines/schedule.ts:90-143 — offset sign, probe ±12h, sort,
// `>` tie-break, dedupe). DST overlap/gap in a west-of-UTC and an east-of-UTC zone.
const iso = (dates: readonly Date[]) => dates.map((d) => d.toISOString());
const wall = (timezone: string, y: number, mo: number, d: number, h: number, mi: number) => ({ timezone, year: y, month: mo, day: d, hour: h, minute: mi });

describe('tzWallToUtcCandidates', () => {
  it('ordinary wall time east of UTC → exactly one instant (Asia/Shanghai, +08:00)', () => {
    expect(iso(tzWallToUtcCandidates(wall('Asia/Shanghai', 2026, 1, 1, 9, 0)))).toEqual(['2026-01-01T01:00:00.000Z']);
  });
  it('ordinary wall time west of UTC → exactly one instant (America/New_York, -05:00)', () => {
    expect(iso(tzWallToUtcCandidates(wall('America/New_York', 2026, 1, 15, 9, 30)))).toEqual(['2026-01-15T14:30:00.000Z']);
  });
  it('fall-back overlap (New York 01:30 on 2026-11-01) → BOTH instants, ascending, de-duplicated', () => {
    expect(iso(tzWallToUtcCandidates(wall('America/New_York', 2026, 11, 1, 1, 30)))).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
  });
  it('fall-back overlap east of UTC (Berlin 02:30 on 2026-10-25) → both, ascending', () => {
    expect(iso(tzWallToUtcCandidates(wall('Europe/Berlin', 2026, 10, 25, 2, 30)))).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
  });
  it('spring-forward gap (New York 02:30 on 2026-03-08) → no instant', () => {
    expect(tzWallToUtcCandidates(wall('America/New_York', 2026, 3, 8, 2, 30))).toEqual([]);
  });
  it('an invalid timezone → []', () => {
    expect(tzWallToUtcCandidates(wall('Not/AZone', 2026, 1, 1, 0, 0))).toEqual([]);
  });
});

describe('tzWallToUtcGapFallback', () => {
  it('New York gap 02:30 → the LATER probe (07:30Z = 03:30 EDT), never the hour-early one', () => {
    expect(tzWallToUtcGapFallback(wall('America/New_York', 2026, 3, 8, 2, 30))?.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });
  it('Berlin gap 02:30 on 2026-03-29 → 01:30Z (03:30 CEST)', () => {
    expect(tzWallToUtcGapFallback(wall('Europe/Berlin', 2026, 3, 29, 2, 30))?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
  it('an invalid timezone → null', () => {
    expect(tzWallToUtcGapFallback(wall('Not/AZone', 2026, 1, 1, 0, 0))).toBeNull();
  });
});

describe('nextWallTimeMatching across DST', () => {
  const daily = (time: string, now: string, timezone = 'America/New_York') => nextWallTimeMatching({ timezone, time, predicate: () => true, now: new Date(now) })?.toISOString() ?? null;
  it('overlap day: before the first occurrence fires at the first', () => {
    expect(daily('01:30', '2026-11-01T05:00:00.000Z')).toBe('2026-11-01T05:30:00.000Z');
  });
  it('overlap day: after the first, before the second → fires at the SECOND (not next day)', () => {
    expect(daily('01:30', '2026-11-01T05:30:00.000Z')).toBe('2026-11-01T06:30:00.000Z');
  });
  it('overlap day: exactly at the second → next day (strictly after now)', () => {
    expect(daily('01:30', '2026-11-01T06:30:00.000Z')).toBe('2026-11-02T06:30:00.000Z');
  });
  it('gap day: fires today at the post-gap fallback; once past it, tomorrow', () => {
    expect(daily('02:30', '2026-03-08T05:00:00.000Z')).toBe('2026-03-08T07:30:00.000Z');
    expect(daily('02:30', '2026-03-08T07:30:00.000Z')).toBe('2026-03-09T06:30:00.000Z');
  });
  it.each(['2:30', '24:00', '12:60', '12:3', ' 12:30', '12:30\n', ''])('malformed time %j → null', (time) => {
    expect(daily(time, '2026-01-01T00:00:00.000Z')).toBeNull();
    expect(isValidWallTime({ time })).toBe(false);
  });
  it.each(['00:00', '23:59'])('boundary time %s is valid', (time) => {
    expect(isValidWallTime({ time })).toBe(true);
  });
});

describe('nextRunAtForSchedule — weekday predicates', () => {
  // 2026-01-02 is a Friday, 2026-01-03 Saturday, 2026-01-05 Monday (UTC).
  it('weekdays skips Saturday and Sunday', () => {
    expect(nextRunAtForSchedule({ schedule: { kind: 'weekdays', timezone: 'UTC', time: '09:00' } as never }, { now: new Date('2026-01-02T10:00:00Z') })?.toISOString()).toBe('2026-01-05T09:00:00.000Z');
  });
  it('weekdays fires on Friday itself when still ahead', () => {
    expect(nextRunAtForSchedule({ schedule: { kind: 'weekdays', timezone: 'UTC', time: '09:00' } as never }, { now: new Date('2026-01-02T08:00:00Z') })?.toISOString()).toBe('2026-01-02T09:00:00.000Z');
  });
  it('weekly picks the named weekday only', () => {
    expect(nextRunAtForSchedule({ schedule: { kind: 'weekly', timezone: 'UTC', time: '09:00', weekday: 6 } as never }, { now: new Date('2026-01-02T10:00:00Z') })?.toISOString()).toBe('2026-01-03T09:00:00.000Z');
  });
  it('an unknown kind → null', () => {
    expect(nextRunAtForSchedule({ schedule: { kind: 'monthly' } as never }, { now: new Date('2026-01-02T10:00:00Z') })).toBeNull();
  });
});
