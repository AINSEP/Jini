import { useT } from '../../../i18n/index.js';
import type { ScheduleKindOption, ScheduleKind } from '../../types.js';

export interface ScheduleKindTabsProps {
  kinds: ScheduleKindOption[];
  active: ScheduleKind;
  onChange: (kind: ScheduleKind) => void;
  useTHook?: typeof useT;
}

/** The kind-selector tab row (Hourly / Daily / Weekdays / Weekly by default). */
export function ScheduleKindTabs({ kinds, active, onChange, useTHook = useT }: ScheduleKindTabsProps) {
  const t = useTHook();
  return (
    <div className="jini-schedule-picker__kinds" role="tablist">
      {kinds.map((k) => (
        <button
          type="button"
          key={k.kind}
          role="tab"
          aria-selected={active === k.kind}
          className={`jini-schedule-picker__kind${active === k.kind ? ' is-active' : ''}`}
          onClick={() => onChange(k.kind)}
        >
          {t(k.label)}
        </button>
      ))}
    </div>
  );
}
