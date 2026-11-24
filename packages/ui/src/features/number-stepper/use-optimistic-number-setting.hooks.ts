import { useState } from "react";
import { acceptedSavedValue, type StepperBounds } from "./number-stepper.js";

/** A persisted whole-number setting as a stepper consumes it. */
export interface NumberSetting {
  /** False when the host has no way to persist the value: the host leaves the control out. */
  available: boolean;
  value: number;
  /** Set after a failed save, cleared by the next one. */
  error: string | null;
  save: (input: { next: number }) => void;
}

/** Persists a value and resolves with the store's own answer (which may differ, e.g. clamped). */
export type NumberSettingWrite = (input: { next: number }) => Promise<unknown>;

/**
 * The shown value moves at once on a save; a failed save puts the last value back and shows the
 * host's `saveError` copy. `value`/`setValue` are the host's live view of the stored value (it may
 * also change from elsewhere); `write` is undefined when the host cannot persist at all.
 * @complexity O(1) per save, one write.
 */
export function useOptimisticNumberSetting(
  { value, setValue, write, bounds, saveError }: {
    value: number; setValue: (input: { next: number }) => void; write: NumberSettingWrite | undefined; bounds: StepperBounds; saveError: string;
  },
  { onSaveFailure }: { onSaveFailure?: (input: { failure: unknown }) => void } = {},
): NumberSetting {
  const [error, setError] = useState<string | null>(null);
  const save = ({ next }: { next: number }, _options: Record<string, never> = {}) => {
    if (!write || next === value) return;
    const previous = value;
    setValue({ next });
    setError(null);
    void write({ next }).then(
      (saved) => setValue({ next: acceptedSavedValue({ value: saved, current: next, bounds }) }),
      (failure: unknown) => {
        onSaveFailure?.({ failure });
        setValue({ next: previous });
        setError(saveError);
      },
    );
  };
  return { available: write !== undefined, value, error, save };
}
