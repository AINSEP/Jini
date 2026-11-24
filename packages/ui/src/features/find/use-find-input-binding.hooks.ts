import { useCallback, useEffect, useRef } from 'react';
import { stopFind, type FindBridge } from './find-target.js';
import { restoreFindInputFocus, shouldReclaimFindFocus } from './find-input-focus.js';
import type { FindFocusClock } from './find-focus-clock.js';
import type { useFindBarState } from './use-find-bar-state.hooks.js';
import type { useFindFocusReclaim } from './use-find-focus-reclaim.hooks.js';

/**
 * Binds the find input: a callback ref that installs the blur reclaim and IME composition tracking on
 * the mounted node, an unmount cleanup, and the bar's `close`.
 *
 * @complexity O(1) per call.
 */
export function useFindInputBinding(
  {
    restoringFocus, clearReclaimTimer, reclaimTimer, clock, inputElement, lastFindAt, composing, queryScheduler, cancelReclaimFrame, awaitingReport, target,
    bridge, dispatch,
  }:
    Pick<ReturnType<typeof useFindBarState>, "restoringFocus" | "reclaimTimer" | "inputElement" | "lastFindAt" | "composing" | "queryScheduler"
    | "awaitingReport" | "target" | "dispatch"> &
    Pick<ReturnType<typeof useFindFocusReclaim>, "clearReclaimTimer" | "cancelReclaimFrame"> &
    { clock: FindFocusClock; bridge: FindBridge | undefined },
  _optional = {},
) {
  // Reclaims focus the moment Chromium takes it, BEFORE the result round trip — on a big page that
  // trip can take long enough for a fast typist's next letters to reach the guest. A native `blur`
  // listener, not React's `onBlur`: the theft is a PAGE-level focus loss (`document.activeElement`
  // stays the input), which does not fire through React's root `focusout` delegation the way a real
  // blur-to-another-element does (component logic belongs in hooks, so this stays in the hook,
  // not the host's component). Deferred with `setTimeout(0)` rather than refocusing inline: the host-side blur
  // fires SYNCHRONOUSLY inside Chromium's own find, so an inline refocus would fight it. Never calls
  // `issueFind`/`runFind`/`stopFind` from here — Chromium steals focus once per issued find, so one
  // reclaim per find settles it; re-running the search on refocus is the focus-fight loop a guest
  // theft can otherwise trigger.
  const attachBlurReclaim = useCallback(
    (node: HTMLInputElement) => {
      const onBlur = () => {
        if (restoringFocus.current) return;
        clearReclaimTimer();
        reclaimTimer.current = clock.schedule({ callback: () => {
          reclaimTimer.current = null;
          // Re-reads `inputElement.current`, not the closed-over `node`: the bar may have closed
          // (and unmounted the input) by the time this deferred callback runs.
          if (shouldReclaimFindFocus({ open: inputElement.current !== null, lastFindAt: lastFindAt.current, now: clock.now() })) {
            restoreFindInputFocus({ input: inputElement.current }, { restoring: restoringFocus });
          }
        }, delay: 0 });
      };
      const onCompositionStart = () => {
        composing.current = true;
      };
      const onCompositionEnd = () => {
        composing.current = false;
      };
      node.addEventListener('blur', onBlur);
      node.addEventListener('compositionstart', onCompositionStart);
      node.addEventListener('compositionend', onCompositionEnd);
      return () => {
        node.removeEventListener('blur', onBlur);
        node.removeEventListener('compositionstart', onCompositionStart);
        node.removeEventListener('compositionend', onCompositionEnd);
        composing.current = false;
      };
    },
    [clearReclaimTimer, clock],
  );

  // Detaches the previous node's blur listener before attaching the next one, so a remount (or the
  // bar closing) never leaves a stale listener on a detached node.
  const detachBlurReclaim = useRef<(() => void) | null>(null);
  const inputRef = useCallback(
    (node: HTMLInputElement | null) => {
      detachBlurReclaim.current?.();
      detachBlurReclaim.current = null;
      inputElement.current = node;
      if (node) detachBlurReclaim.current = attachBlurReclaim(node);
    },
    [attachBlurReclaim],
  );

  useEffect(() => () => {
    queryScheduler.cancel();
    clearReclaimTimer();
    cancelReclaimFrame();
  }, [queryScheduler, clearReclaimTimer, cancelReclaimFrame]);

  const close = () => {
    queryScheduler.cancel();
    clearReclaimTimer();
    cancelReclaimFrame();
    awaitingReport.current = false;
    stopFind({ target, bridge });
    dispatch({ type: 'close' });
  };
  return { inputRef, close };
}
