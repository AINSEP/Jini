import { describe, expect, it } from 'vitest';
import { DEFAULT_WEEKDAYS } from '../constants.js';
import {
  buildScheduleValue,
  clampMinute,
  decomposeSchedule,
  defaultScheduleEditorState,
  describeScheduleSummary,
  formatTime12h,
  scheduleEditorStateFromValue,
  showsTimeFields,
  showsWeekdayGrid,
} from '../rules.js';
import type { ScheduleEditorState, ScheduleValue } from '../types.js';

describe('clampMinute', () => {
  it('rounds and clamps into 0-59', () => {
    expect(clampMinute({ value: 30.6 })).toBe(31);
    expect(clampMinute({ value: -5 })).toBe(0);
    expect(clampMinute({ value: 100 })).toBe(59);
    expect(clampMinute({ value: 0 })).toBe(0);
    expect(clampMinute({ value: 59 })).toBe(59);
  });

  it('treats non-finite input as 0', () => {
    expect(clampMinute({ value: NaN })).toBe(0);
    expect(clampMinute({ value: Infinity })).toBe(0);
    expect(clampMinute({ value: -Infinity })).toBe(0);
  });
});

describe('formatTime12h', () => {
  it('formats midnight, noon, morning, and evening correctly', () => {
    expect(formatTime12h({ time: '00:00' })).toBe('12:00 AM');
    expect(formatTime12h({ time: '12:00' })).toBe('12:00 PM');
    expect(formatTime12h({ time: '09:05' })).toBe('9:05 AM');
    expect(formatTime12h({ time: '23:45' })).toBe('11:45 PM');
    expect(formatTime12h({ time: '13:30' })).toBe('1:30 PM');
  });

  it('returns the input unchanged when it does not match HH:MM', () => {
    expect(formatTime12h({ time: 'not-a-time' })).toBe('not-a-time');
    expect(formatTime12h({ time: '9:00' })).toBe('9:00');
  });
});

describe('decomposeSchedule', () => {
  it('decomposes an hourly schedule', () => {
    expect(decomposeSchedule({ schedule: { kind: 'hourly', minute: 5 } })).toEqual({ kind: 'hourly', minute: '05' });
    expect(decomposeSchedule({ schedule: { kind: 'hourly', minute: 45 } })).toEqual({ kind: 'hourly', minute: '45' });
  });

  it('decomposes a daily schedule', () => {
    expect(decomposeSchedule({ schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } })).toEqual({
      kind: 'timed',
      freq: 'Daily',
      time: '9:00 AM',
      tz: 'UTC',
    });
  });

  it('decomposes a weekdays schedule', () => {
    expect(decomposeSchedule({ schedule: { kind: 'weekdays', time: '17:30', timezone: 'UTC' } })).toEqual({
      kind: 'timed',
      freq: 'Weekdays',
      time: '5:30 PM',
      tz: 'UTC',
    });
  });

  it('decomposes a weekly schedule using the matching weekday long name', () => {
    expect(decomposeSchedule({ schedule: { kind: 'weekly', weekday: 3, time: '10:00', timezone: 'UTC' } })).toEqual({
      kind: 'timed',
      freq: 'Wednesday',
      time: '10:00 AM',
      tz: 'UTC',
    });
  });

  it('falls back to the first weekday label when a custom weekdays list omits the target weekday', () => {
    const customWeekdays = [{ value: 1 as const, short: 'Mon', long: 'Monday' }];
    expect(decomposeSchedule({ schedule: { kind: 'weekly', weekday: 3, time: '10:00', timezone: 'UTC' } }, { weekdays: customWeekdays })).toEqual({
      kind: 'timed',
      freq: 'Monday',
      time: '10:00 AM',
      tz: 'UTC',
    });
  });

  it('falls back to Sunday when given an empty weekdays list', () => {
    expect(decomposeSchedule({ schedule: { kind: 'weekly', weekday: 3, time: '10:00', timezone: 'UTC' } }, { weekdays: [] })).toEqual({
      kind: 'timed',
      freq: 'Sunday',
      time: '10:00 AM',
      tz: 'UTC',
    });
  });

  it('defaults to DEFAULT_WEEKDAYS when no weekdays list is passed', () => {
    expect(decomposeSchedule({ schedule: { kind: 'weekly', weekday: 6, time: '08:00', timezone: 'UTC' } })).toEqual({
      kind: 'timed',
      freq: DEFAULT_WEEKDAYS[6]?.long,
      time: '8:00 AM',
      tz: 'UTC',
    });
  });
});

describe('describeScheduleSummary', () => {
  it('formats an hourly summary', () => {
    expect(describeScheduleSummary({ schedule: { kind: 'hourly', minute: 5 } })).toBe('Hourly at :05');
  });

  it('formats a timed summary', () => {
    expect(describeScheduleSummary({ schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } })).toBe('Daily at 9:00 AM · UTC');
  });
});

describe('defaultScheduleEditorState', () => {
  it('returns a daily 09:00 schedule in the given timezone', () => {
    expect(defaultScheduleEditorState({ timezone: 'Asia/Tokyo' })).toEqual({
      kind: 'daily',
      minute: 0,
      time: '09:00',
      weekday: 1,
      timezone: 'Asia/Tokyo',
    });
  });
});

describe('scheduleEditorStateFromValue', () => {
  const base: ScheduleEditorState = defaultScheduleEditorState({ timezone: 'UTC' });

  it('merges an hourly value onto the base state', () => {
    const value: ScheduleValue = { kind: 'hourly', minute: 15 };
    expect(scheduleEditorStateFromValue({ value, base })).toEqual({ ...base, kind: 'hourly', minute: 15 });
  });

  it('merges a weekly value onto the base state', () => {
    const value: ScheduleValue = { kind: 'weekly', weekday: 5, time: '14:00', timezone: 'Europe/Berlin' };
    expect(scheduleEditorStateFromValue({ value, base })).toEqual({
      ...base,
      kind: 'weekly',
      weekday: 5,
      time: '14:00',
      timezone: 'Europe/Berlin',
    });
  });

  it('merges a daily/weekdays value onto the base state, preserving the untouched weekday field', () => {
    const value: ScheduleValue = { kind: 'weekdays', time: '08:30', timezone: 'Europe/Berlin' };
    const result = scheduleEditorStateFromValue({ value, base });
    expect(result).toEqual({ ...base, kind: 'weekdays', time: '08:30', timezone: 'Europe/Berlin' });
    expect(result.weekday).toBe(base.weekday);
  });
});

describe('buildScheduleValue', () => {
  it('projects an hourly state', () => {
    const state: ScheduleEditorState = { kind: 'hourly', minute: 40, time: '09:00', weekday: 1, timezone: 'UTC' };
    expect(buildScheduleValue(state)).toEqual({ kind: 'hourly', minute: 40 });
  });

  it('projects a weekly state', () => {
    const state: ScheduleEditorState = { kind: 'weekly', minute: 0, time: '11:00', weekday: 4, timezone: 'UTC' };
    expect(buildScheduleValue(state)).toEqual({ kind: 'weekly', weekday: 4, time: '11:00', timezone: 'UTC' });
  });

  it('projects a daily state', () => {
    const state: ScheduleEditorState = { kind: 'daily', minute: 0, time: '11:00', weekday: 4, timezone: 'UTC' };
    expect(buildScheduleValue(state)).toEqual({ kind: 'daily', time: '11:00', timezone: 'UTC' });
  });

  it('projects a weekdays state', () => {
    const state: ScheduleEditorState = { kind: 'weekdays', minute: 0, time: '11:00', weekday: 4, timezone: 'UTC' };
    expect(buildScheduleValue(state)).toEqual({ kind: 'weekdays', time: '11:00', timezone: 'UTC' });
  });
});

describe('showsWeekdayGrid / showsTimeFields', () => {
  it('only weekly shows the weekday grid', () => {
    expect(showsWeekdayGrid({ kind: 'weekly' })).toBe(true);
    expect(showsWeekdayGrid({ kind: 'daily' })).toBe(false);
    expect(showsWeekdayGrid({ kind: 'weekdays' })).toBe(false);
    expect(showsWeekdayGrid({ kind: 'hourly' })).toBe(false);
  });

  it('every kind except hourly shows time fields', () => {
    expect(showsTimeFields({ kind: 'hourly' })).toBe(false);
    expect(showsTimeFields({ kind: 'daily' })).toBe(true);
    expect(showsTimeFields({ kind: 'weekdays' })).toBe(true);
    expect(showsTimeFields({ kind: 'weekly' })).toBe(true);
  });
});
