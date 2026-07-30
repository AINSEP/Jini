/**
 * DST-safe wall-clock schedule math + input validation for {@link ./scheduler.js}'s
 * `RoutineService`. Ported verbatim (logic unchanged) from OD's `apps/daemon/src/routines.ts` —
 * see that module's own header comment, quoted in the porting proposal
 * (`ADS-memory/reports/proposals/PROP-http-route-packs-automation-routines-2026-07-21.md`), for
 * why this is "real, non-trivial, DST-safe timezone math... genuinely hard to get right and not
 * something to casually reinvent." Its only dependency is `Intl.DateTimeFormat`, which Node ships
 * with full-icu by default — no OD coupling.
 */
import type { RoutineProjectTarget, RoutineSchedule, Weekday } from './types.js';

// ---------- timezone math ----------

/**
 * Returns the wall-clock parts of `atUtc` rendered in `timezone`. Uses `Intl.DateTimeFormat`. If
 * the timezone is invalid the formatter throws — callers catch upstream.
 *
 * Exported for the same reason as {@link tzWallToUtcCandidates}/{@link tzWallToUtcGapFallback}:
 * its two defensive fallbacks (an Intl-reported hour of `"24"` at local midnight in some
 * locale/zone combinations, and an unrecognized weekday abbreviation) are ICU-implementation
 * edge cases no timezone on this test runner's ICU data naturally triggers — directly testable
 * with a mocked `Intl.DateTimeFormat.prototype.formatToParts` instead of left unreachable.
 */
export function partsInTimezone(
  timezone: string,
  atUtc: Date,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const parts = dtf.formatToParts(atUtc);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const weekdayStr = get('weekday');
  const weekdayMap: Record<string, Weekday> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  let h = Number(get('hour'));
  // Intl emits "24" at midnight in some locales/zones; normalize to 0.
  if (h === 24) h = 0;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: h,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekdayMap[weekdayStr] ?? 0,
  };
}

/**
 * Returns every UTC instant at which the wall clock in `timezone` reads the requested Y-M-D h:m,
 * sorted ascending. Most days have exactly one match. On a fall-back transition day the requested
 * time inside the repeated hour has two matches (one before the transition, one after); outside
 * that hour it still has one. On a spring-forward gap the requested time inside the gap has zero
 * matches — callers fall back to {@link tzWallToUtcGapFallback} to land on a post-gap instant the
 * same day. Probes offsets at three reference points across the day so that both pre- and
 * post-transition offsets are sampled regardless of which side of the transition `tentative`
 * happens to land on. Returns `[]` if `timezone` is invalid.
 *
 * Exported (unlike this module's other low-level helpers) so its own `catch` branch is directly
 * unit-testable: {@link nextWallTimeMatching}, this function's only real caller, already calls
 * the unguarded `partsInTimezone` earlier in its own loop body, so an invalid timezone throws
 * there first — this function's defensive catch is otherwise unreachable through that call path.
 */
export function tzWallToUtcCandidates(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date[] {
  try {
    const tentative = Date.UTC(year, month - 1, day, hour, minute, 0);
    const probeOffsetsMs = [-12, 0, 12].map((h) => h * 60 * 60_000);
    const seen = new Set<number>();
    const out: Date[] = [];
    for (const dms of probeOffsetsMs) {
      const off = tzOffsetMinutes(timezone, new Date(tentative + dms));
      const cand = new Date(tentative - off * 60_000);
      const t = cand.getTime();
      if (seen.has(t)) continue;
      if (matchesWallClock(timezone, cand, year, month, day, hour, minute)) {
        seen.add(t);
        out.push(cand);
      }
    }
    return out.sort((a, b) => a.getTime() - b.getTime());
  } catch {
    return [];
  }
}

/**
 * Spring-forward gap fallback: when the requested wall time doesn't exist in `timezone` on this
 * day (clocks jumped over it), return the later of the two probe candidates. That instant has
 * crossed the transition and renders as the first valid post-gap wall time, so a routine still
 * fires today instead of firing an hour early before the gap. Returns `null` if `timezone` is
 * invalid.
 *
 * Exported for the same reason as {@link tzWallToUtcCandidates} — its own `catch` branch is
 * otherwise unreachable through {@link nextWallTimeMatching}'s call path.
 */
export function tzWallToUtcGapFallback(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  try {
    const tentative = Date.UTC(year, month - 1, day, hour, minute, 0);
    const t1 = tzOffsetMinutes(timezone, new Date(tentative));
    const candidate1 = new Date(tentative - t1 * 60_000);
    const t2 = tzOffsetMinutes(timezone, candidate1);
    const candidate2 = new Date(tentative - t2 * 60_000);
    return candidate1.getTime() > candidate2.getTime() ? candidate1 : candidate2;
  } catch {
    return null;
  }
}

function matchesWallClock(
  timezone: string,
  at: Date,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): boolean {
  const p = partsInTimezone(timezone, at);
  return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
}

/** Minutes east of UTC for `timezone` at instant `at`. e.g. Asia/Shanghai returns 480. */
function tzOffsetMinutes(timezone: string, at: Date): number {
  const p = partsInTimezone(timezone, at);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - at.getTime()) / 60_000);
}

// ---------- next-fire calculation ----------

export function nextHourlyRunAt(minute: number, now = new Date()): Date {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(minute);
  if (next.getTime() <= now.getTime()) {
    next.setHours(next.getHours() + 1);
  }
  return next;
}

/**
 * Returns the next instant at which the wall-clock in `timezone` reads "HH:MM" on a day where
 * `predicate(weekday)` holds. Walks forward at most 14 calendar days as a safety bound (covers
 * any weekday-based pattern). Exported (unlike this module's other internal helpers) so its
 * 14-day-exhaustion fallback is directly unit-testable: every `predicate` `nextRunAtForSchedule`
 * actually passes (daily/weekdays/weekly) structurally guarantees a match within 7 days, making
 * that branch otherwise unreachable through the public schedule-kind API alone.
 */
/** Parses a strict "HH:MM" 24-hour wall time, returning `null` for any malformed or out-of-range value. */
function parseWallTime(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * What one candidate calendar day yielded while walking forward:
 * fire at this instant, move to the next day, or abandon the walk entirely.
 */
type DayResolution =
  | { kind: 'fire'; at: Date }
  | { kind: 'next-day' }
  | { kind: 'abandon' };

/**
 * Resolves the requested wall time on one specific calendar day in `timezone` to the instant a
 * routine should fire, given that everything at or before `now` has already passed.
 *
 * `abandon` covers the case where the requested wall time cannot be represented as a `Date` at all
 * — see {@link nextWallTimeMatching} for when that actually happens.
 */
function resolveDayFireInstant(
  timezone: string,
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  now: Date,
): DayResolution {
  const candidates = tzWallToUtcCandidates(timezone, date.year, date.month, date.day, hour, minute);
  if (candidates.length === 0) {
    // Spring-forward gap: no valid wall instant exists today; pick the synthesized post-gap
    // fallback so the routine still fires today.
    const fallback = tzWallToUtcGapFallback(timezone, date.year, date.month, date.day, hour, minute);
    if (!fallback) return { kind: 'abandon' };
    return fallback.getTime() > now.getTime() ? { kind: 'fire', at: fallback } : { kind: 'next-day' };
  }
  // Iterate candidates in ascending order so that on a fall-back overlap day, when `now`
  // already passed the first occurrence (EDT), we still pick the second one (EST) before
  // walking to the next day.
  for (const candidate of candidates) {
    if (candidate.getTime() > now.getTime()) return { kind: 'fire', at: candidate };
  }
  return { kind: 'next-day' };
}

export function nextWallTimeMatching(
  timezone: string,
  time: string,
  predicate: (weekday: Weekday) => boolean,
  now: Date,
): Date | null {
  const wall = parseWallTime(time);
  if (!wall) return null;

  // Walk day by day in the target timezone.
  for (let offset = 0; offset < 14; offset += 1) {
    const probe = new Date(now.getTime() + offset * 24 * 60 * 60_000);
    const parts = partsInTimezone(timezone, probe);
    if (!predicate(parts.weekday)) continue;
    const resolution = resolveDayFireInstant(timezone, parts, wall.hour, wall.minute, now);
    if (resolution.kind === 'fire') return resolution.at;
    // `abandon` means `tzWallToUtcGapFallback` returned null. Its own `catch` fires whenever the
    // Intl call inside it throws — which an invalid timezone causes, but so does an
    // unrepresentable instant. The latter is reachable from right here despite `timezone` being
    // proven valid by the `partsInTimezone` call above: when `now` sits within a day of the
    // maximum representable `Date` (+275760-09-13), `Date.UTC(...)` for a later wall time that
    // same day overflows to `NaN`, `new Date(NaN)` makes `formatToParts` throw `RangeError`, and
    // both `tzWallToUtcCandidates` (hence the empty candidate list) and `tzWallToUtcGapFallback`
    // swallow it. No later day can succeed either, so give up rather than spin the remaining
    // iterations. Covered by a direct test in schedule.test.ts.
    if (resolution.kind === 'abandon') return null;
  }
  return null;
}

export function nextRunAtForSchedule(schedule: RoutineSchedule, now = new Date()): Date | null {
  if (schedule.kind === 'hourly') {
    return nextHourlyRunAt(schedule.minute, now);
  }
  if (schedule.kind === 'daily') {
    return nextWallTimeMatching(schedule.timezone, schedule.time, () => true, now);
  }
  if (schedule.kind === 'weekdays') {
    // Mon=1 .. Fri=5
    return nextWallTimeMatching(schedule.timezone, schedule.time, (w) => w >= 1 && w <= 5, now);
  }
  if (schedule.kind === 'weekly') {
    return nextWallTimeMatching(schedule.timezone, schedule.time, (w) => w === schedule.weekday, now);
  }
  return null;
}

// ---------- validation ----------

export function isValidWallTime(time: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return false;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h >= 0 && h <= 23 && mm >= 0 && mm <= 59;
}

export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Every schedule kind that fires at a wall-clock time in a named timezone. */
type WallClockSchedule = Extract<RoutineSchedule, { kind: 'daily' | 'weekdays' | 'weekly' }>;

function validateHourlyMinute(minute: number): void {
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('hourly.minute must be an integer 0-59');
  }
}

function validateWeekday(weekday: number): void {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error('weekly.weekday must be 0-6');
  }
}

function validateWallClockSchedule(schedule: WallClockSchedule): void {
  if (!isValidWallTime(schedule.time)) {
    throw new Error(`Invalid time: ${schedule.time}`);
  }
  if (!isValidTimezone(schedule.timezone)) {
    throw new Error(`Invalid timezone: ${schedule.timezone}`);
  }
  if (schedule.kind === 'weekly') {
    validateWeekday(schedule.weekday);
  }
}

export function validateSchedule(schedule: RoutineSchedule): void {
  if (!schedule || typeof schedule !== 'object') {
    throw new Error('schedule is required');
  }
  if (schedule.kind === 'hourly') {
    validateHourlyMinute(schedule.minute);
    return;
  }
  if (schedule.kind === 'daily' || schedule.kind === 'weekdays' || schedule.kind === 'weekly') {
    validateWallClockSchedule(schedule);
    return;
  }
  throw new Error(`Unsupported schedule kind: ${(schedule as { kind: string }).kind}`);
}

export function validateTarget(target: RoutineProjectTarget): void {
  if (!target || typeof target !== 'object') {
    throw new Error('target is required');
  }
  if (target.mode === 'create_each_run') return;
  if (target.mode === 'reuse') {
    if (!target.projectId || typeof target.projectId !== 'string') {
      throw new Error('Reuse target requires a projectId');
    }
    return;
  }
  throw new Error(`Unsupported routine target mode: ${(target as { mode: string }).mode}`);
}
