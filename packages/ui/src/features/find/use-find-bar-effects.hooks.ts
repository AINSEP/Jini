import { useEffect, useRef } from 'react';
import { resolveFindTarget, stopFind, subscribeToFindResults, type FindBridge } from './find-target.js';
import { restoreFindInputFocus } from './find-input-focus.js';
import { shouldCloseOnGuestChange } from './find-bar-state.js';
import type { useFindBarState } from './use-find-bar-state.hooks.js';
import type { useFindFocusReclaim } from './use-find-focus-reclaim.hooks.js';

/**
 * The find bar's effects: opening on the bridge's Cmd+F, focusing the input on every open, the result
 * subscription, the typing-settled search, and closing when the visible surface changes.
 *
 * @complexity O(1) per effect run, beyond `runFind`/`stopFind`'s own cost.
 */
export function useFindBarEffects(
  {
    bridge, dispatch, state, inputElement, restoringFocus, target, awaitingReport, composing, activeGuestId, queryScheduler, cancelReclaimFrame, issueFind,
    guests,
  }:
    Pick<ReturnType<typeof useFindBarState>, "dispatch" | "state" | "inputElement" | "restoringFocus" | "target" | "awaitingReport" | "composing"
    | "queryScheduler" | "guests"> &
    Pick<ReturnType<typeof useFindFocusReclaim>, "cancelReclaimFrame" | "issueFind"> &
    { activeGuestId: string | null; bridge: FindBridge | undefined },
  _optional = {},
) {
  // The app menu's Find (Cmd+F): open (or, if already open, bump `focusNonce` so the effect below
  // refocuses even though `open` itself does not change).
  useEffect(() => {
    if (!bridge) return undefined;
    return bridge.onFindToggle({ listener: () => dispatch({ type: 'toggle' }) });
  }, [bridge]);

  // Focuses and selects the input every time the bar opens OR is re-summoned while already open —
  // matching Chrome's own Cmd+F, which reselects the existing query for a fast re-type.
  useEffect(() => {
    if (!state.open) return;
    // blur()+focus(), not a bare focus(): Cmd+F pressed while typing in the guest leaves the browser
    // routing keys into the guest, and on a re-summon the input is already this document's
    // activeElement — a bare focus() is then a no-op the browser never hears about. See
    // {@link restoreFindInputFocus}.
    restoreFindInputFocus({ input: inputElement.current }, { restoring: restoringFocus });
    inputElement.current?.select();
  }, [state.open, state.focusNonce]);

  // Subscribes to results from whichever target is live, only while the bar is open — an empty
  // query never subscribes at all (see the early return), matching `runFind`'s own stop-not-search.
  useEffect(() => {
    if (!state.open || state.query === '') return undefined;
    return subscribeToFindResults({ target, bridge, handlers: {
      onReported: () => {
        awaitingReport.current = false;
        if (!composing.current) restoreFindInputFocus({ input: inputElement.current }, { restoring: restoringFocus });
      },
      onResult: ({ result }) => dispatch({ type: 'result', result }),
    } });
    // `target` is a fresh object every render (`resolveFindTarget` builds one), so this depends on
    // its STABLE identity components instead — the guest map is a ref (never itself a dependency
    // trigger) and `activeGuestId` is what actually changes which entry it names.
    // biome-ignore lint/correctness/useExhaustiveDependencies: depends on target's stable inputs (activeGuestId, bridge), not the fresh `target` object itself — see the comment above.
  }, [state.open, state.query === '', activeGuestId, bridge]);
  // A query change — including the FIRST non-empty character — is a NEW search session
  // (`findNext: true`, per `find-target.ts`'s header); clearing back to '' stops it instead of searching
  // for nothing.
  useEffect(() => {
    queryScheduler.cancel();
    if (!state.open) return undefined;
    if (state.query === '') {
      awaitingReport.current = false;
      cancelReclaimFrame();
      stopFind({ target, bridge });
      return undefined;
    }
    const run = () => {
      // Blurring during an IME composition would discard the text still being composed.
      if (composing.current) { queryScheduler.schedule({ run }); return; }
      issueFind(state.query, { forward: true, findNext: true });
    };
    queryScheduler.schedule({ run });
    return () => queryScheduler.cancel();
    // biome-ignore lint/correctness/useExhaustiveDependencies: depends on target's stable inputs (activeGuestId), not the fresh `target`/`bridge` objects themselves.
  }, [state.query, state.open, activeGuestId]);

  // Closes (and clears the OUTGOING surface's own highlights) on a tab switch while the bar is
  // open — known rough edge until now: switching tabs left the bar open, still showing the
  // previous tab's stale query/count, and never cleared that tab's own highlight because nothing
  // called `stopFind` for it once it went off screen. Mirrors the identical class of problem
  // a collapse-on-workspace-change rule solves. `previousGuestIdRef` — not `target` — resolves the OUTGOING guest: by the
  // time this effect runs post-commit, `activeGuestId` (and therefore `target`) already point at
  // the NEW surface.
  const previousGuestIdRef = useRef(activeGuestId);
  useEffect(() => {
    if (shouldCloseOnGuestChange({ previousGuestId: previousGuestIdRef.current, activeGuestId, open: state.open })) {
      const outgoing = resolveFindTarget({ activeGuestId: previousGuestIdRef.current, guests, bridge });
      stopFind({ target: outgoing, bridge });
      dispatch({ type: 'close' });
    }
    previousGuestIdRef.current = activeGuestId;
    // biome-ignore lint/correctness/useExhaustiveDependencies: keys on activeGuestId's stable identity only, matching this file's other target-derived effects above.
  }, [activeGuestId]);
}
