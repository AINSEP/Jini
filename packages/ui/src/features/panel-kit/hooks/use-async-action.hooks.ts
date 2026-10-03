import { type Dispatch, type SetStateAction, useState } from "react";

import { isAbortError } from "../helpers/retry-unreachable.js";

export interface AsyncActionState {
  // Explicit mutations own their success effects/reloads, so this hook deliberately stores no
  // result value. Shared error slots or row-id busy state need a different, caller-owned shape.
  saving: boolean;
  error: string | null;
  // Opening a dialog may clear an old error before a new run. Preserve the full React setter type,
  // including updater functions, so callers can forward it without narrowing their existing API.
  setError: Dispatch<SetStateAction<string | null>>;
  run: (required: { action: () => Promise<void>; describeError: (e: unknown) => string }) => Promise<void>;
}

/** Expose saving/error state for an action; cancellations stay silent and other failures use caller copy. */
export function useAsyncAction(): AsyncActionState {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run({ action, describeError }: { action: () => Promise<void>; describeError: (e: unknown) => string }) {
    // Each screen interprets server codes differently; inject the describer instead of importing
    // one feature's wording. action includes success effects, all completed before saving turns off.
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      // An aborted action must not leave a stale failure banner after browser history restoration.
      if (isAbortError({ error: e })) return;
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  return { saving, error, setError, run };
}
