import { useCallback, useEffect, useRef } from 'react';
import {
  FILE_DIALOG_FOCUS_DELAY_MS,
  FILE_DIALOG_STALE_MS,
  FILE_DIALOG_WARMUP_MS,
  FILE_DROPZONE_PROCESSING_MIN_VISIBLE_MS,
} from '../../constants.js';

export interface UseFileDialogTrackingResult {
  /** Call when the file input is clicked, before the OS dialog opens. A no-op if no `onProcessingStart` was supplied. */
  prepareTracking: () => void;
  /**
   * Call once the input's `change` event fires (a real selection). Clears
   * every timer and returns any in-flight "finish" callback (`undefined` if
   * no loading affordance was ever shown) — undelayed, so the caller
   * decides its own timing around the staging work that follows.
   */
  completeTracking: () => (() => void) | undefined;
  /** Call from the input's `cancel` event: completes tracking and, if a loading affordance was showing, schedules its finish after the minimum-visible delay so it doesn't flash. */
  handleDialogCancelled: () => void;
}

function clearTimer(ref: { current: number | undefined }) {
  if (ref.current === undefined) return;
  window.clearTimeout(ref.current);
  ref.current = undefined;
}

function scheduleFinish(finish: (() => void) | undefined) {
  if (!finish) return;
  window.setTimeout(finish, FILE_DROPZONE_PROCESSING_MIN_VISIBLE_MS);
}

/**
 * The file-dialog cancel-vs-still-loading detection heuristic, ported from
 * `DesignSystemFlow.tsx`'s `DropZone`. A native `<input type=file>` click
 * opens an OS-level dialog with no DOM signal for "still open" — only
 * `window` regaining `focus` (the dialog closed, picked or not) and the
 * input's own `cancel` event (dismissed with no selection) are observable.
 * Two racing timers decide when a `focus` is trustworthy enough to start a
 * loading affordance: a short delay that ignores a spurious focus firing
 * immediately after the click, and a longer warmup that force-starts the
 * affordance if `focus` never arrives at all (some platforms never blur the
 * main window for a file dialog). A stale-timeout safety net force-clears a
 * loading affordance that's been open too long without the dialog
 * resolving (a hung or buggy picker).
 *
 * Deliberately generalized from the origin: there, this heuristic only ran
 * for the directory-browse zone (`directory && onProcessingStart`); here it
 * runs for any zone that supplies `onProcessingStart`, since the heuristic
 * itself has no directory-specific behavior — a large flat file selection
 * benefits from the same loading affordance a large folder selection does.
 */
export function useFileDialogTracking(onProcessingStart?: () => () => void): UseFileDialogTrackingResult {
  const pendingRef = useRef(false);
  const canShowLoadingRef = useRef(false);
  const loadingFinishRef = useRef<(() => void) | undefined>(undefined);
  const focusDelayRef = useRef<number | undefined>(undefined);
  const warmupRef = useRef<number | undefined>(undefined);
  const staleRef = useRef<number | undefined>(undefined);
  const onProcessingStartRef = useRef(onProcessingStart);
  onProcessingStartRef.current = onProcessingStart;

  const completeTracking = useCallback((): (() => void) | undefined => {
    clearTimer(focusDelayRef);
    clearTimer(warmupRef);
    clearTimer(staleRef);
    pendingRef.current = false;
    canShowLoadingRef.current = false;
    const finish = loadingFinishRef.current;
    loadingFinishRef.current = undefined;
    return finish;
  }, []);

  const handleDialogCancelled = useCallback(() => {
    scheduleFinish(completeTracking());
  }, [completeTracking]);

  const beginReturnLoading = useCallback(() => {
    if (!pendingRef.current) return;
    if (!canShowLoadingRef.current) return;
    const start = onProcessingStartRef.current;
    if (!start) return;
    if (loadingFinishRef.current) return;
    loadingFinishRef.current = start();
    staleRef.current = window.setTimeout(() => {
      handleDialogCancelled();
    }, FILE_DIALOG_STALE_MS);
  }, [handleDialogCancelled]);

  useEffect(() => {
    if (!onProcessingStart) return undefined;
    function handleFocus() {
      beginReturnLoading();
    }
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
    // `beginReturnLoading` uses refs and stable callbacks — re-subscribing per render would just churn the listener for no behavioral change.
  }, [onProcessingStart, beginReturnLoading]);

  // Clears any pending timers on unmount without invoking a stored `finish`
  // (calling into host state after unmount would be the host's problem, but
  // avoiding it entirely is strictly safer than the origin, which had no
  // unmount cleanup for these timers at all).
  useEffect(() => {
    return () => {
      clearTimer(focusDelayRef);
      clearTimer(warmupRef);
      clearTimer(staleRef);
    };
  }, []);

  function prepareTracking() {
    if (!onProcessingStartRef.current) return;
    const previousFinish = completeTracking();
    previousFinish?.();
    pendingRef.current = true;
    canShowLoadingRef.current = false;
    focusDelayRef.current = window.setTimeout(() => {
      canShowLoadingRef.current = true;
      focusDelayRef.current = undefined;
    }, FILE_DIALOG_FOCUS_DELAY_MS);
    warmupRef.current = window.setTimeout(() => {
      canShowLoadingRef.current = true;
      warmupRef.current = undefined;
      beginReturnLoading();
    }, FILE_DIALOG_WARMUP_MS);
  }

  return { prepareTracking, completeTracking, handleDialogCancelled };
}
