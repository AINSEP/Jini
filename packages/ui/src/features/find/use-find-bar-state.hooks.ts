import { useCallback, useReducer, useRef } from 'react';
import { createFindQueryScheduler } from './find-query-scheduler.js';
import { findBarReducer, initialFindBarState } from './find-bar-state.js';
import { resolveFindTarget, type FindableGuest, type FindBridge } from './find-target.js';
import type { FindFocusClock } from './find-focus-clock.js';

/** Optional seams of {@link useFindBarState}. */
export interface UseFindBarStateOptions {
  /** Builds the typing-settle scheduler; defaults to {@link createFindQueryScheduler}. */
  readonly createQueryScheduler?: typeof createFindQueryScheduler;
}

/**
 * The find bar's state and every ref the other find hooks share: the reducer, the registered guests,
 * the input element, the reclaim bookkeeping and the typing-settle scheduler, plus the live target.
 *
 * @param input.activeGuestId the visible guest's id, or `null` when the host's own top-level page is
 *   on screen.
 * @param input.bridge the host's find bridge; `undefined` outside a real desktop window.
 * @complexity O(1) per render.
 */
export function useFindBarState(
  { clock, activeGuestId, bridge }: { activeGuestId: string | null; clock: FindFocusClock; bridge: FindBridge | undefined },
  { createQueryScheduler = createFindQueryScheduler }: UseFindBarStateOptions = {},
) {
  const [state, dispatch] = useReducer(findBarReducer, initialFindBarState);
  // A ref, not state: registering a guest must never itself trigger a render — every mounted tab
  // calls it on every commit (through the host's composed guest ref), and the map's CONTENTS are only ever read
  // at the moment a search actually runs, never rendered.
  const guests = useRef(new Map<string, FindableGuest>()).current;
  const inputElement = useRef<HTMLInputElement | null>(null);
  // When the last find was ISSUED (not when a result was reported) — see `issueFind` and
  // {@link shouldReclaimFindFocus}. A ref, not state: recording it must never itself trigger a
  // render.
  const lastFindAt = useRef<number | null>(null);
  // The pending deferred reclaim (see the blur listener below), so `close`/unmount can cancel one
  // scheduled for a bar that is no longer open by the time it would run.
  const reclaimTimer = useRef<unknown>(null);
  // Raised while {@link restoreFindInputFocus} blurs the input itself, so the blur listener below
  // does not mistake that for a Chromium theft — see that function's doc.
  const restoringFocus = useRef(false);
  // Between ISSUING a find and its first reported result — see {@link shouldKeepReclaimingFindFocus}.
  const awaitingReport = useRef(false);
  // An IME composition is in progress in the find input — reclaiming would end it.
  const composing = useRef(false);
  const reclaimFrame = useRef<number | null>(null);
  const queryScheduler = useRef(createQueryScheduler({}, { clock })).current;

  const registerGuest = useCallback(
    (projectId: string, element: FindableGuest | null) => {
      if (element) guests.set(projectId, element);
      else guests.delete(projectId);
    },
    [guests],
  );

  const target = resolveFindTarget({ activeGuestId, guests, bridge });
  return {
    state, dispatch, guests, inputElement, lastFindAt, reclaimTimer, restoringFocus, awaitingReport, composing, reclaimFrame, queryScheduler, registerGuest,
    target,
  };
}
