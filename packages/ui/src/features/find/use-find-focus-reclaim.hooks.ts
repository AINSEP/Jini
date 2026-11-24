import { useCallback } from 'react';
import { runFind, type FindBridge } from './find-target.js';
import { restoreFindInputFocus, shouldKeepReclaimingFindFocus } from './find-input-focus.js';
import type { FindFocusClock } from './find-focus-clock.js';
import type { useFindBarState } from './use-find-bar-state.hooks.js';

/**
 * The focus-reclaim half of the find bar: issuing a find (and recording when), the per-frame
 * reclaim until it reports, and cancelling the pending frame or deferred blur reclaim.
 *
 * @complexity O(1) per call.
 */
export function useFindFocusReclaim(
  { reclaimFrame, clock, inputElement, lastFindAt, awaitingReport, composing, restoringFocus, target, bridge, reclaimTimer }:
    Pick<ReturnType<typeof useFindBarState>, "reclaimFrame" | "inputElement" | "lastFindAt" | "awaitingReport" | "composing" | "restoringFocus" | "target"
    | "reclaimTimer"> &
    { clock: FindFocusClock; bridge: FindBridge | undefined }
) {
  // Runs a find and records WHEN, so a blur shortly after can be told apart from the user clicking
  // away — see {@link shouldReclaimFindFocus}. Every call site that starts or steps a search goes
  // through this instead of calling `runFind` directly.
  const cancelReclaimFrame = useCallback(() => {
    if (reclaimFrame.current !== null) {
      clock.cancelFrame({ frame: reclaimFrame.current });
      reclaimFrame.current = null;
    }
  }, [clock]);

  // Re-asserts focus on every frame until the find just issued reports — see
  // {@link shouldKeepReclaimingFindFocus} for why no single, event-driven restore can do this.
  const reclaimUntilReported = useCallback(() => {
    cancelReclaimFrame();
    const tick = () => {
      reclaimFrame.current = null;
      const keepGoing = shouldKeepReclaimingFindFocus({
        open: inputElement.current !== null,
        lastFindAt: lastFindAt.current,
        now: clock.now(),
        awaitingReport: awaitingReport.current,
        composing: composing.current,
      });
      if (!keepGoing) return;
      restoreFindInputFocus({ input: inputElement.current }, { restoring: restoringFocus });
      reclaimFrame.current = clock.requestFrame({ callback: tick });
    };
    reclaimFrame.current = clock.requestFrame({ callback: tick });
  }, [cancelReclaimFrame, clock]);

  const issueFind = useCallback(
    (text: string, options: { forward: boolean; findNext: boolean }) => {
      lastFindAt.current = clock.now();
      awaitingReport.current = true;
      runFind({ target, bridge, text, options });
      // Reclaim immediately for a typed query as well as on subsequent frames/results.
      if (options.findNext && !composing.current) restoreFindInputFocus({ input: inputElement.current }, { restoring: restoringFocus });
      // Only for a NEW session (a typed character): Enter/Shift+Enter's step must not be disturbed
      // mid-flight. Each reclaim's focus() puts the input's caret back as this frame's selection, and
      // a follow-up find that reads it anchors on the find bar instead of the previous match (see
      // {@link runFind}) — measured live, the per-frame reclaim turned Enter's 2 -> 3 -> 4 into
      // 2 -> 3 -> 2. Stepping is keyed on Enter, not on text going into the input, so its keys are
      // not the ones the gap loses; the report's own restore still covers it.
      if (options.findNext) reclaimUntilReported();
    },
    [target, bridge, reclaimUntilReported, clock],
  );

  const clearReclaimTimer = useCallback(() => {
    if (reclaimTimer.current !== null) {
      clock.cancel({ timer: reclaimTimer.current });
      reclaimTimer.current = null;
    }
  }, [clock]);
  return { cancelReclaimFrame, issueFind, clearReclaimTimer };
}
