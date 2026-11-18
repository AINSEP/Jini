import { useT } from '../../../i18n/index.js';
import type { Weekday, WeekdayOption } from '../../types.js';

export interface WeekdayGridProps {
  weekdays: WeekdayOption[];
  active: Weekday;
  onChange: (weekday: Weekday) => void;
  useTHook?: typeof useT;
}

/** The single-select weekday button grid, shown for the `'weekly'` schedule kind. */
export function WeekdayGrid({ weekdays, active, onChange, useTHook = useT }: WeekdayGridProps) {
  const t = useTHook();
  return (
    <div className="jini-schedule-picker__weekdays" aria-label={t('Weekday')}>
      {weekdays.map((d) => (
        <button
          key={d.value}
          type="button"
          className={`jini-schedule-picker__weekday${active === d.value ? ' is-active' : ''}`}
          aria-pressed={active === d.value}
          onClick={() => onChange(d.value)}
          title={t(d.long)}
        >
          {t(d.short)}
        </button>
      ))}
    </div>
  );
}
