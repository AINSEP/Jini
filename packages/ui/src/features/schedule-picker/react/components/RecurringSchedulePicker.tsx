import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { PillButton } from '../../../../react/components/PillButton.js';
import { DEFAULT_SCHEDULE_KINDS, DEFAULT_WEEKDAYS } from '../../constants.js';
import { showsWeekdayGrid } from '../../rules.js';
import { useRecurringSchedulePicker } from '../hooks/useRecurringSchedulePicker.js';
import { ScheduleFields } from './ScheduleFields.js';
import { ScheduleKindTabs } from './ScheduleKindTabs.js';
import { ScheduleSummary, translatedScheduleSummaryLabel } from './ScheduleSummary.js';
import { WeekdayGrid } from './WeekdayGrid.js';
import type { ScheduleKindOption, ScheduleValue, WeekdayOption } from '../../types.js';

export interface RecurringSchedulePickerProps {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  /** Override the default Hourly/Daily/Weekdays/Weekly tab set. */
  kinds?: ScheduleKindOption[];
  /** Override the default Sunday-first weekday grid. */
  weekdays?: WeekdayOption[];
  /** Override the timezone `<select>` options. Defaults to every timezone
   *  the runtime knows about. */
  timezones?: string[];
  disabled?: boolean;
  /** Custom hook override for dependency injection / testing. */
  useRecurringSchedulePicker?: typeof useRecurringSchedulePicker;
}

/**
 * A self-contained "cron-lite" recurring-schedule picker: a labeled trigger
 * pill showing the current schedule's summary, expanding into a popover with
 * kind tabs, a weekday grid (weekly only), and time/timezone (or hourly
 * minute) fields, with a "Done" action that commits the edit.
 *
 * Origin: `SchedulePopover` from the vendored schedule/mention god-component
 * (recon r6 §1.19) — a generic schedule builder; only the original's
 * `RoutineSchedule` type was product-specific, replaced here by the
 * standalone `ScheduleValue` union (see `types.ts`). The form-building/
 * REST-submission wiring the original component sat inside stays behind in
 * the host (per r6 §1.19's own "OD-specific" list).
 */
export function RecurringSchedulePicker({
  value,
  onChange,
  kinds = DEFAULT_SCHEDULE_KINDS,
  weekdays = DEFAULT_WEEKDAYS,
  timezones,
  disabled = false,
  useRecurringSchedulePicker: useRecurringSchedulePickerHook = useRecurringSchedulePicker,
}: RecurringSchedulePickerProps) {
  const t = useT();
  const picker = useRecurringSchedulePickerHook({ value, onChange, timezones });

  return (
    <div ref={picker.containerRef} className="jini-schedule-picker">
      <PillButton
        icon={<Icon name="history" size={12} />}
        trailingIcon={<Icon name="chevron-down" size={11} />}
        active={picker.open}
        label={<ScheduleSummary schedule={value} weekdays={weekdays} />}
        aria-label={translatedScheduleSummaryLabel(t, value, weekdays)}
        onClick={picker.toggleOpen}
        disabled={disabled}
      >
        {picker.open ? (
          <div className="jini-schedule-picker__popover">
            <ScheduleKindTabs kinds={kinds} active={picker.state.kind} onChange={picker.setKind} />

            {showsWeekdayGrid(picker.state.kind) ? (
              <WeekdayGrid weekdays={weekdays} active={picker.state.weekday} onChange={picker.setWeekday} />
            ) : null}

            <ScheduleFields
              state={picker.state}
              timezones={picker.timezones}
              onMinuteChange={picker.setMinute}
              onTimeChange={picker.setTime}
              onTimezoneChange={picker.setTimezone}
            />

            <div className="jini-schedule-picker__done">
              <button type="button" className="jini-schedule-picker__done-btn" onClick={picker.commit}>
                {t('Done')}
              </button>
            </div>
          </div>
        ) : null}
      </PillButton>
    </div>
  );
}
