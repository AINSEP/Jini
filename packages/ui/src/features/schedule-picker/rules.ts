/**
 * Pure schedule-editor logic — no React, no i18n hook. Every English label
 * this module returns (e.g. `'Hourly'`, `'Daily'`, weekday long names) is
 * meant to be passed through the caller's `useT()` as a key, per this
 * package's i18n convention (`rules.ts` stays hook-free by design; the
 * React layer wraps the return value).
 */
import { DEFAULT_WEEKDAYS } from './constants.js';
import type { ScheduleEditorState, ScheduleKind, ScheduleSummaryParts, ScheduleValue, Weekday, WeekdayOption } from './types.js';

/** Clamp a candidate "minute of the hour" to a valid integer 0-59. Non-finite
 *  input (e.g. `NaN` from an emptied number input) clamps to 0. */
export function clampMinute(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(59, Math.round(value)));
}

/** Format a `'HH:MM'` 24h time string as 12h with an AM/PM suffix
 *  (`'09:00'` -> `'9:00 AM'`). Returns the input unchanged if it doesn't
 *  match the expected shape. */
export function formatTime12h(time: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const mm = m[2];
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${to12Hour(h)}:${mm} ${suffix}`;
}

function to12Hour(h: number): number {
  if (h === 0) return 12;
  return h > 12 ? h - 12 : h;
}

function weekdayLongName(weekday: Weekday, weekdays: WeekdayOption[]): string {
  return weekdays.find((w) => w.value === weekday)?.long ?? weekdays[0]?.long ?? 'Sunday';
}

/**
 * Decompose a {@link ScheduleValue} into display-ready, still-untranslated
 * parts — single source of truth shared by {@link describeScheduleSummary}
 * (a plain string) and the React layer's structured pill-segment renderer,
 * so a change to time/weekday formatting only needs to happen here.
 */
export function decomposeSchedule(
  schedule: ScheduleValue,
  weekdays: WeekdayOption[] = DEFAULT_WEEKDAYS,
): ScheduleSummaryParts {
  if (schedule.kind === 'hourly') {
    return { kind: 'hourly', minute: String(schedule.minute).padStart(2, '0') };
  }
  let freq: string;
  if (schedule.kind === 'daily') freq = 'Daily';
  else if (schedule.kind === 'weekdays') freq = 'Weekdays';
  else freq = weekdayLongName(schedule.weekday, weekdays);
  return { kind: 'timed', freq, time: formatTime12h(schedule.time), tz: schedule.timezone };
}

/** Plain-English one-line summary, e.g. `'Hourly at :05'` or
 *  `'Daily at 9:00 AM · America/Los_Angeles'`. Useful as a default
 *  `aria-label`/title when a host hasn't wired translated copy. Callers
 *  wanting translated output should decompose+translate the parts
 *  themselves instead (see `useRecurringSchedulePicker`). */
export function describeScheduleSummary(schedule: ScheduleValue, weekdays: WeekdayOption[] = DEFAULT_WEEKDAYS): string {
  const parts = decomposeSchedule(schedule, weekdays);
  if (parts.kind === 'hourly') return `Hourly at :${parts.minute}`;
  return `${parts.freq} at ${parts.time} · ${parts.tz}`;
}

/** A fresh editor state defaulting to a daily 09:00 schedule in the given
 *  timezone (typically the caller's `detectLocalTimezone()`). */
export function defaultScheduleEditorState(timezone: string): ScheduleEditorState {
  return {
    kind: 'daily',
    minute: 0,
    time: '09:00',
    weekday: 1,
    timezone,
  };
}

/**
 * Merge a {@link ScheduleValue} onto a base editor state: only the fields
 * the value's kind actually carries are overwritten, so switching kinds in
 * the UI afterward still has sensible values for the untouched fields
 * (mirrors the vendored `formFromRoutine`'s partial-application behavior).
 */
export function scheduleEditorStateFromValue(
  value: ScheduleValue,
  base: ScheduleEditorState,
): ScheduleEditorState {
  if (value.kind === 'hourly') {
    return { ...base, kind: 'hourly', minute: value.minute };
  }
  if (value.kind === 'weekly') {
    return { ...base, kind: 'weekly', weekday: value.weekday, time: value.time, timezone: value.timezone };
  }
  return { ...base, kind: value.kind, time: value.time, timezone: value.timezone };
}

/** Project an editor state down to the tagged-union `ScheduleValue` its
 *  active `kind` actually needs. */
export function buildScheduleValue(state: ScheduleEditorState): ScheduleValue {
  if (state.kind === 'hourly') return { kind: 'hourly', minute: state.minute };
  if (state.kind === 'weekly') {
    return { kind: 'weekly', weekday: state.weekday, time: state.time, timezone: state.timezone };
  }
  return { kind: state.kind, time: state.time, timezone: state.timezone };
}

/** Is `kind` one that shows the weekday grid? Only `'weekly'` does. */
export function showsWeekdayGrid(kind: ScheduleKind): boolean {
  return kind === 'weekly';
}

/** Is `kind` one that shows the time+timezone fields (as opposed to the
 *  hourly minute field)? Every kind except `'hourly'`. */
export function showsTimeFields(kind: ScheduleKind): boolean {
  return kind !== 'hourly';
}
