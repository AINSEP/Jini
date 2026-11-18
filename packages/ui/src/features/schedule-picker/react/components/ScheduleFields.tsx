import { useT } from '../../../i18n/index.js';
import { tzCityLabel } from '../../../../utils/timezone.js';
import { showsTimeFields } from '../../rules.js';
import type { ScheduleEditorState } from '../../types.js';

export interface ScheduleFieldsProps {
  state: ScheduleEditorState;
  timezones: string[];
  onMinuteChange: (minute: number) => void;
  onTimeChange: (time: string) => void;
  onTimezoneChange: (timezone: string) => void;
  useTHook?: typeof useT;
}

/**
 * The kind-dependent input row: an "hour minute" number field for
 * `'hourly'`, or a time + timezone pair for every other kind.
 */
export function ScheduleFields({ state, timezones, onMinuteChange, onTimeChange, onTimezoneChange, useTHook = useT }: ScheduleFieldsProps) {
  const t = useTHook();

  if (!showsTimeFields({ kind: state.kind })) {
    return (
      <label className="jini-schedule-picker__field">
        <span>{t('Minute of every hour')}</span>
        <input
          type="number"
          min={0}
          max={59}
          step={1}
          value={state.minute}
          onChange={(e) => onMinuteChange(Number(e.target.value))}
        />
      </label>
    );
  }

  return (
    <div className="jini-schedule-picker__row">
      <label className="jini-schedule-picker__field">
        <span>{t('Time')}</span>
        <input type="time" value={state.time} onChange={(e) => onTimeChange(e.target.value)} />
      </label>
      <label className="jini-schedule-picker__field">
        <span>{t('Timezone')}</span>
        <select value={state.timezone} onChange={(e) => onTimezoneChange(e.target.value)}>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tzCityLabel(tz)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
