import { useCallback, useRef, useState } from 'react';
import { createAsyncCommitGuard } from '@jini-ai/ui-core';
import { beginSilentUpdatesWrite, resolveSilentUpdatesWriteFailure, resolveSilentUpdatesWriteSuccess } from '@jini-ai/ui-core';
import type { SilentUpdatesState } from '@jini-ai/ui-core';

export interface UseSilentUpdatesToggleOptions {
  /** Seed value — the host's confirmed setting when this tab mounts. Only
   *  read on first render; later prop changes do not re-seed local state,
   *  same "host provides the starting truth, then the tab owns the optimistic
   *  edit" split as `useMemoryConfig`'s toggles (this tab has no competing
   *  reload/hydrate flow to reconcile against, so it doesn't need that half
   *  of that hook's machinery). */
  allowSilentUpdates: boolean;
  /** Performs the write. Rejecting means the host could not persist it and
   *  the toggle must roll back to what it displayed immediately before this
   *  attempt. `undefined` makes `toggle` a no-op — the consuming component
   *  typically hides its control entirely in that case (nothing to write
   *  through), but the hook tolerates it directly rather than pushing a
   *  "there's nothing to call" guard out to every caller. */
  onSilentUpdatePreferenceChange: ((allow: boolean) => Promise<void>) | undefined;
}

export interface UseSilentUpdatesToggleResult {
  allowSilentUpdates: boolean;
  busy: boolean;
  toggle: (next: boolean) => void;
}

/**
 * Optimistic write for the "allow silent updates" preference, safe under
 * overlapping toggles. Origin: `SettingsDialog.tsx`'s inline handler
 * (~5583-5644), which pairs a write-token ref with an optimistic set and a
 * rollback to the pre-write value.
 *
 * The token/staleness half of that mechanism is `createAsyncCommitGuard`
 * (already in `@jini-ai/ui-core`, built for exactly this shape of problem —
 * see its own doc comment) rather than a second token counter grown here.
 * `begin()` is called once per toggle click; because it is monotonic, it
 * both claims a revision for this attempt AND retroactively invalidates
 * every earlier attempt's revision, so an earlier attempt's settle arriving
 * after a later one started is dropped by the `isCurrent` check below —
 * regardless of settle order. The value/busy transition itself is
 * `beginSilentUpdatesWrite`/`resolveSilentUpdatesWriteSuccess`/
 * `resolveSilentUpdatesWriteFailure` (ui-core, pure, no ordering opinion of
 * their own — ordering is entirely this hook's job).
 *
 * @complexity O(1) per toggle call.
 */
export function useSilentUpdatesToggle({
  allowSilentUpdates,
  onSilentUpdatePreferenceChange,
}: UseSilentUpdatesToggleOptions): UseSilentUpdatesToggleResult {
  const [state, setState] = useState<SilentUpdatesState>(() => ({ allowSilentUpdates, busy: false }));
  const guardRef = useRef(createAsyncCommitGuard());

  const toggle = useCallback(
    (next: boolean) => {
      if (!onSilentUpdatePreferenceChange) return;
      const previous = state.allowSilentUpdates;
      const revision = guardRef.current.begin();
      setState(beginSilentUpdatesWrite(next));
      void onSilentUpdatePreferenceChange(next).then(
        () => {
          if (guardRef.current.isCurrent(revision)) setState(resolveSilentUpdatesWriteSuccess(next));
        },
        () => {
          if (guardRef.current.isCurrent(revision)) setState(resolveSilentUpdatesWriteFailure(previous));
        },
      );
    },
    [state.allowSilentUpdates, onSilentUpdatePreferenceChange],
  );

  return { allowSilentUpdates: state.allowSilentUpdates, busy: state.busy, toggle };
}
