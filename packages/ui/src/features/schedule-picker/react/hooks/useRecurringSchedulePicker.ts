import { useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useDismissOnOutsideOrEscape } from '../../../../browser/index.js';
import { detectLocalTimezone, listSupportedTimezones } from '../../../../utils/timezone.js';
import {
  buildScheduleValue,
  clampMinute,
  defaultScheduleEditorState,
  scheduleEditorStateFromValue,
} from '../../rules.js';
import type { ScheduleEditorState, ScheduleValue } from '../../types.js';

export interface UseRecurringSchedulePickerParams {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  /** Timezone list for the timezone `<select>`. Defaults to every timezone
   *  the runtime knows about (via `listSupportedTimezones()`), deduplicated
   *  against the runtime's own detected timezone. */
  timezones?: string[] | undefined;
}

export interface UseRecurringSchedulePickerResult {
  open: boolean;
  toggleOpen: () => void;
  close: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
  state: ScheduleEditorState;
  timezones: string[];
  setKind: (kind: ScheduleEditorState['kind']) => void;
  setMinute: (minute: number) => void;
  setTime: (time: string) => void;
  setWeekday: (weekday: ScheduleEditorState['weekday']) => void;
  setTimezone: (timezone: string) => void;
  /** Commits the current editor state as a `ScheduleValue` via `onChange`
   *  and closes the popover — bound to the popover's "Done" action. */
  commit: () => void;
}

/**
 * Owns the `RecurringSchedulePicker` popover's open/closed state and its
 * editor working-state (kind/minute/time/weekday/timezone), including
 * outside-click/Escape dismissal (via the shared `useDismissOnOutsideOrEscape`
 * hook). Deliberately i18n-free — this hook returns plain data, never
 * translated strings; the presentational layer wraps labels in `useT()`
 * itself (see this package's i18n policy: a hook that threads `t` through a
 * `useEffect`/`useCallback` dependency array risks an infinite render loop
 * when no `I18nProvider` is mounted).
 */
export function useRecurringSchedulePicker({
  value,
  onChange,
  timezones,
}: UseRecurringSchedulePickerParams): UseRecurringSchedulePickerResult {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [state, setState] = useState<ScheduleEditorState>(() =>
    scheduleEditorStateFromValue(value, defaultScheduleEditorState(detectLocalTimezone())),
  );

  const resolvedTimezones = useMemo(() => {
    if (timezones && timezones.length > 0) return timezones;
    const local = detectLocalTimezone();
    return Array.from(new Set([local, ...listSupportedTimezones()]));
  }, [timezones]);

  useDismissOnOutsideOrEscape({ onDismiss: () => setOpen(false) }, { enabled: open, containerRef });

  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      if (next) {
        // Re-sync the editor state from the latest committed value each time
        // the popover opens, so an external change to `value` (e.g. a reset)
        // is reflected instead of showing stale in-progress edits.
        setState((current2) => scheduleEditorStateFromValue(value, current2));
      }
      return next;
    });
  };

  const close = () => setOpen(false);

  const commit = () => {
    onChange(buildScheduleValue(state));
    setOpen(false);
  };

  return {
    open,
    toggleOpen,
    close,
    containerRef,
    state,
    timezones: resolvedTimezones,
    setKind: (kind) => setState((current) => ({ ...current, kind })),
    setMinute: (minute) => setState((current) => ({ ...current, minute: clampMinute(minute) })),
    setTime: (time) => setState((current) => ({ ...current, time })),
    setWeekday: (weekday) => setState((current) => ({ ...current, weekday })),
    setTimezone: (timezone) => setState((current) => ({ ...current, timezone })),
    commit,
  };
}
