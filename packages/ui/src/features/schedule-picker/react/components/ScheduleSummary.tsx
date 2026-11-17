import { useT } from '../../../i18n/index.js';
import type { I18nContextValue } from '../../../i18n/index.js';
import { decomposeSchedule } from '../../rules.js';
import type { ScheduleValue, WeekdayOption } from '../../types.js';

export interface ScheduleSummaryProps {
  schedule: ScheduleValue;
  weekdays?: WeekdayOption[];
  useTHook?: typeof useT;
}

/**
 * Plain-string, TRANSLATED one-line summary (e.g. `'Daily at 9:00 AM · UTC'`
 * becoming `'Quotidien à 9:00 AM · UTC'` under a French dictionary) — used
 * as the trigger pill's `aria-label`. Takes `t` as an explicit parameter
 * (rather than calling `useT()` itself) so a plain non-component caller can
 * reuse it; `RecurringSchedulePicker` calls this with its own `useT()`
 * result instead of duplicating the decompose-then-translate logic.
 */
export function translatedScheduleSummaryLabel(
  t: I18nContextValue['t'],
  schedule: ScheduleValue,
  weekdays?: WeekdayOption[],
): string {
  const parts = decomposeSchedule(schedule, weekdays);
  if (parts.kind === 'hourly') return `${t('Hourly')} at :${parts.minute}`;
  return `${t(parts.freq)} at ${parts.time} · ${parts.tz}`;
}

/**
 * Renders a schedule as structured, translated pill segments
 * (`freq · time · tz`, or `Hourly · :05`) for better visual hierarchy than a
 * single concatenated string. Shares `decomposeSchedule` with the plain-string
 * `describeScheduleSummary` (`rules.ts`) so formatting only lives in one place.
 */
export function ScheduleSummary({ schedule, weekdays, useTHook = useT }: ScheduleSummaryProps) {
  const t = useTHook();
  const parts = decomposeSchedule(schedule, weekdays);

  if (parts.kind === 'hourly') {
    return (
      <span className="jini-schedule-summary__segments">
        <span className="jini-schedule-summary__freq">{t('Hourly')}</span>
        <span className="jini-schedule-summary__sep">·</span>
        <span className="jini-schedule-summary__time">:{parts.minute}</span>
      </span>
    );
  }

  return (
    <span className="jini-schedule-summary__segments">
      <span className="jini-schedule-summary__freq">{t(parts.freq)}</span>
      <span className="jini-schedule-summary__sep">·</span>
      <span className="jini-schedule-summary__time">{parts.time}</span>
      <span className="jini-schedule-summary__sep">·</span>
      <span className="jini-schedule-summary__tz">{parts.tz}</span>
    </span>
  );
}
