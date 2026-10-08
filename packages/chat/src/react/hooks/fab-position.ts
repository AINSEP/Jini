import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * @file Draggable position for the assistant `ChatFab` (MSG-09).
 *
 * Own hook, not inline state in `ChatFab.tsx` — the same reasoning as `useSidebarRail`: this is
 * real, testable-on-its-own behavior (persistence, clamping, free-drag). Colocated as
 * `ChatFab.hooks.tsx` next to the component it belongs to (2026-08-06 extraction, moved out of
 * the flatter `apps/admin/src/hooks/*.hooks.ts` convention `apps/admin/INFO.md` still documents
 * for hooks with no single owning component) rather than left under `hooks/`, since
 * `useFabPosition` has exactly one consumer. No `-port.hooks.ts` / `-dependencies.hooks.ts` pair,
 * for the same reason as `useSidebarRail`: the only outside dependency is `localStorage`, a
 * browser built-in, not a swappable backend worth a fake-port seam.
 *
 * Position is persisted as **two independent 0–1 fractions of the viewport** —
 * `rightFraction` (distance from the right edge, as a fraction of `innerWidth`) and
 * `bottomFraction` (distance from the bottom edge, as a fraction of `innerHeight`) — never raw
 * pixels. This is the same class of bug the pre-existing `.chat-fab-dock-open { right:
 * calc(380px + 20px) }` rule had (see `styles/assistant.css`'s old comment): a pixel position
 * valid at the viewport it was set on can be off-screen at a different one (window resized,
 * phone rotated). A pair of fractions is resolution-independent by construction — re-deriving
 * pixels on every render/resize instead of trusting a stored pixel value is what actually fixes
 * the class of bug, not just one instance of it.
 *
 * An earlier version of this hook additionally snapped the drop point to whichever edge it was
 * nearer, and persisted `{ side: "left" | "right", bottomFraction }` — a shape that can only ever
 * express a position glued to one vertical edge, which is why a drop in the middle of the screen
 * used to jump to a corner. That snap is gone: the FAB rests exactly where it is dropped,
 * anywhere on screen. The old `{ side, bottomFraction }` value is still read and migrated, not
 * discarded — see `readPersisted` below — so an existing user's FAB does not jump to the default
 * corner on first load after this change.
 */









interface StoredFabPosition {
  /** Fraction of `window.innerWidth`, measured from the right edge, in `[0, 1]`. */
  rightFraction: number;
  /** Fraction of `window.innerHeight`, measured from the bottom edge, in `[0, 1]`. */
  bottomFraction: number;
  /**
   * Whether this position came from an actual drag-and-drop, as opposed to the untouched
   * `DEFAULT_POSITION` or a migrated legacy value. Gates the dock-avoidance clamps in `style`
   * below (2026-08-05 fix): the avoidance exists to stop the FAB's DEFAULT bottom-right spot from
   * landing on the dock's composer send button and eating its clicks (see `avoidRightPx`'s own
   * doc for that bug's history) — it was never meant to veto a position the operator chose on
   * purpose, including one on top of the open dock. `false` for migrated legacy values on
   * purpose, not just by omission: an old `{ side, bottomFraction }` entry predates free-drag
   * entirely and carries no evidence the operator ever placed it deliberately relative to the
   * dock, so it gets the same protection as the default rather than an unearned pass.
   */
  pinnedByUser: boolean;
}

/** The pre-free-drag shape: an edge plus a vertical fraction only, no horizontal offset at all
 *  (the FAB always rested flush against `FAB_EDGE_MARGIN` on whichever side it snapped to). Kept
 *  as its own type only long enough to describe what `readPersisted` migrates away from. */
interface LegacyStoredFabPosition {
  side: "left" | "right";
  bottomFraction: number;
}

function isLegacyShape(value: Record<string, unknown>): value is Record<string, unknown> & LegacyStoredFabPosition {
  return (value.side === "left" || value.side === "right") && typeof value.bottomFraction === "number";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readPersisted({ storage, storageKey: STORAGE_KEY, viewport: window, edgeMargin: FAB_EDGE_MARGIN, sizePx: FAB_SIZE_PX }: FabPositionInput): StoredFabPosition | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (typeof parsed.rightFraction === "number" && typeof parsed.bottomFraction === "number") {
      return {
        rightFraction: clamp(parsed.rightFraction, 0, 1),
        bottomFraction: clamp(parsed.bottomFraction, 0, 1),
        // Absent on any value written before the `pinnedByUser` field existed — treated as `false`
        // (same protection as the default spot) rather than assumed `true`, since a pre-existing
        // stored drop is exactly the case `pinnedByUser`'s own doc calls out as unearned evidence.
        pinnedByUser: parsed.pinnedByUser === true,
      };
    }

    if (isLegacyShape(parsed)) {
      // Map the edge to an x-fraction near that edge — the legacy shape never recorded a
      // horizontal offset (it was always pinned flush to the edge margin), so "near that edge" is
      // the most faithful reading of it available, not an approximation of a value that existed.
      const rightFraction =
        parsed.side === "right"
          ? FAB_EDGE_MARGIN / window.innerWidth
          : (window.innerWidth - FAB_EDGE_MARGIN - FAB_SIZE_PX) / window.innerWidth;
      return {
        rightFraction: clamp(rightFraction, 0, 1),
        bottomFraction: clamp(parsed.bottomFraction, 0, 1),
        pinnedByUser: false,
      };
    }

    // Unrecognized shape (corrupted value, a future format, hand-edited localStorage) — fall back
    // to the default rather than risk propagating `NaN`/`undefined` into pixel math downstream.
    return null;
  } catch {
    return null;
  }
}

function writePersisted(position: StoredFabPosition, { storage, storageKey }: FabPositionInput): void {
  try {
    storage.setItem(storageKey, JSON.stringify(position));
  } catch {
    // Best-effort, same reasoning as `useSidebarRail`'s `writePersisted` — a user who cannot
    // persist the position still gets a working, draggable FAB for the current tab.
  }
}

/** A safe default before the first drag — bottom-right corner, matching the FAB's original
 *  hard-coded `right: 20px; bottom: 20px`. Both fractions are `0` ("flush against the edge"),
 *  not "off-screen at the corner" — `style` below clamps them up to `FAB_EDGE_MARGIN` regardless
 *  of viewport size. */
const DEFAULT_POSITION: StoredFabPosition = { rightFraction: 0, bottomFraction: 0, pinnedByUser: false };

export interface FabPositionResult {
  /** Inline `style` for the FAB button — `right` and `bottom`, in px, always resolved against
   *  the *current* viewport (never a stale stored pixel value). Always both: the FAB is
   *  positioned as an offset from the right/bottom edges regardless of where on screen it was
   *  dropped, so there is no left-vs-right branch to keep in sync with the stored fractions. */
  style: { right: number; bottom: number };
  /** Attach to the FAB's `onPointerDown`. */
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  /**
   * Call from the FAB's `onClick`, in place of the toggle callback directly — returns `true` if
   * the click should be treated as a real activation (fire the toggle) and `false` if it is the
   * tail end of a drag and should be swallowed.
   *
   * Deliberately NOT the `isDragging` boolean below checked inline at the call site: `pointerup`
   * (which ends the drag) and `click` (which this guards) are two different events, dispatched
   * back-to-back by the browser, and by the time `click` fires React may not have re-rendered
   * with `isDragging`'s new value yet — reading a piece of React state that was *just* set a
   * moment earlier in the same synchronous sequence is exactly the kind of timing this project's
   * conventions call out as unreliable (see `use-settings-slice.hooks.ts`'s "read at run time, not
   * schedule time" refrain, one level down in raw event timing rather than async scheduling).
   * `consumeDragFlag` reads and clears a ref instead, which has no such lag.
   */
  consumeDragFlag: () => boolean;
  /** For UI feedback only (e.g. suppressing the hover/press transition while dragging) — not to
   *  be used to decide whether to swallow a click; use `consumeDragFlag` for that. */
  isDragging: boolean;
}

/**
 * @param options.dockOpen When the assistant dock/sheet is open, an UNTOUCHED or migrated-legacy
 *   resting spot moves off it so it never sits over the dock's own composer/close controls by
 *   accident — this mirrors what the old hard-coded `.chat-fab-dock-open` rule did for the
 *   desktop-docked panel, generalized to the dragged position and to the mobile sheet's own
 *   (viewport-fraction) height. A spot the operator explicitly dragged onto the dock is left alone
 *   (see `pinnedByUser`'s own doc on `StoredFabPosition`) — this option only guards against an
 *   unintentional overlap, not against a deliberate one.
 * @param options.avoidBottomPx Extra clearance to hold above the bottom edge while `dockOpen` —
 *   the caller passes the mobile sheet's current height here (0 at desktop, where the dock sits
 *   to the *side*, not below, so no bottom clearance is needed there — see `App.tsx`).
 * @param options.avoidRightPx Extra clearance to hold left of the right edge while `dockOpen` —
 *   the caller passes the DESKTOP dock's current width here (0 in sheet mode, where the sheet
 *   spans the full width and `avoidBottomPx` is the axis that matters).
 *
 *   This axis was missing until 2026-08-05, and its absence was a live defect rather than a
 *   theoretical gap: the FAB is `position: fixed` and offset from the RIGHT edge, and the desktop
 *   dock is also pinned to the right edge, so with the dock open the 56px FAB sat directly on top
 *   of the dock's own composer send button and swallowed its clicks. Playwright caught it as
 *   `<button class="chat-fab chat-fab-dock-open"> intercepts pointer events` while trying to send
 *   a message — i.e. the assistant could not be used with a mouse at the default FAB position.
 *
 *   How it got lost is worth recording, because the code confidently said otherwise: the old
 *   `.chat-fab-dock-open { right: calc(380px + 20px) }` rule moved the FAB SIDEWAYS. When this
 *   hook replaced it, only the vertical axis was carried over, while the comment on
 *   `effectiveBottom` below claimed `avoidBottomPx` "generalizes" what that rule did — it does
 *   not, it generalizes a different axis, and desktop passes `avoidBottomPx: 0`, so on desktop
 *   nothing displaced the FAB at all. The `.chat-fab-dock-open` class is still applied by
 *   `ChatFab.tsx` and has had no CSS rule behind it since.
 *
 *   Measured by the caller rather than hard-coded back to 380px, for the same
 *   resolution-independence reason this whole hook exists (see the module doc).
 *
 * @complexity O(1) per pointer event — no work scales with anything caller-controlled.
 */
export function useFabPosition(options: FabPositionInput, _optional: Record<string, never> = {}): FabPositionResult {
  // Storage/DOM handles and CSS geometry are fixed for this mounted button; dock clearances stay live.
  const environment = useRef(options).current;
  const { viewport: window, pointerEvents: document, edgeMargin: FAB_EDGE_MARGIN, sizePx: FAB_SIZE_PX, dragThresholdPx: DRAG_THRESHOLD_PX } = environment;
  const { dockOpen, avoidBottomPx } = options;
  const avoidRightPx = options.avoidRightPx ?? 0;
  const [persisted, setPersisted] = useState<StoredFabPosition>(() => readPersisted(environment) ?? DEFAULT_POSITION);
  const [isDragging, setIsDragging] = useState(false);

  /**
   * All the mutable drag bookkeeping lives in refs, not state, and is read/written only inside
   * the `pointermove`/`pointerup` handlers below.
   *
   * This is deliberate, not an optimization: `document.addEventListener("pointermove", handler)`
   * binds to whatever `handler` closure existed at `pointerdown` time and is never re-subscribed
   * mid-drag. If this logic instead branched on the REACT STATE `isDragging` — which is exactly
   * what an earlier version of this hook did — every handler invoked after the first `pointermove`
   * would still see the `isDragging=false` closure captured at `pointerdown`, because the state
   * update that flips it to `true` doesn't re-create (and re-attach) the listener. Concretely,
   * that made `handlePointerUp`'s `if (isDragging)` check always false, so a real drag's end
   * position was silently never persisted. Refs have no such staleness — they are the same
   * mutable cell on every read regardless of which render's closure is doing the reading.
   */
  const draggingRef = useRef(false);
  const didDragRef = useRef(false);
  const liveRef = useRef<{ right: number; bottom: number } | null>(null);
  const dragStart = useRef<{ pointerId: number; startX: number; startY: number; startRight: number; startBottom: number } | null>(null);

  /** Bumped to force a re-render on every pointermove and on resize — `liveRef`/`window.innerWidth`
   *  are read directly in `style`'s `useMemo` below, neither of which React tracks as a reactive
   *  dependency on its own, so without this counter in that hook's dependency array the memo
   *  would never invalidate and the FAB would visually freeze mid-drag. */
  const [renderTick, forceRender] = useState(0);

  // Re-clamp on resize/orientationchange — `rightFraction`/`bottomFraction` are already
  // resolution-independent on their own axes, but this still forces a re-render so any consumer
  // computing pixels from `window.innerWidth`/`innerHeight` (this hook included, in `style`
  // below) recomputes rather than holding a value measured against the previous viewport.
  useEffect(() => {
    function onResize() {
      forceRender((n) => n + 1);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // Stable identities (empty dep arrays) — see the `draggingRef` doc above for why these must
  // never depend on state that would force a re-subscribe mid-gesture.
  const handlePointerMove = useCallback((e: PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const dx = e.clientX - start.startX;
    const dy = e.clientY - start.startY;
    if (!draggingRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      draggingRef.current = true;
      didDragRef.current = true;
      setIsDragging(true);
    }
    if (draggingRef.current) {
      // Dragging moves the FAB's bottom-right-anchored box: moving the pointer right shrinks
      // `right` (px from the right edge); moving it down shrinks `bottom`.
      liveRef.current = { right: start.startRight - dx, bottom: start.startBottom - dy };
      forceRender((n) => n + 1);
    }
  }, []);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    (e.target as Element).releasePointerCapture?.(start.pointerId);
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("pointercancel", handlePointerUp);

    const live = liveRef.current;
    const wasDragging = draggingRef.current;
    dragStart.current = null;
    liveRef.current = null;
    draggingRef.current = false;

    if (live && wasDragging) {
      // Persist exactly where it was dropped — no edge-snap (see file header). Clamped to
      // `[0, 1]` here only to keep the *fraction* well-formed; the margin-aware on-screen clamp
      // happens once, in `style` below, the same way it already did for the vertical axis alone —
      // so a drop near an edge still ends up fully on-screen after conversion back to pixels, on
      // this viewport and any other.
      const next: StoredFabPosition = {
        rightFraction: clamp(live.right / window.innerWidth, 0, 1),
        bottomFraction: clamp(live.bottom / window.innerHeight, 0, 1),
        // A completed drag-and-drop is exactly the deliberate placement `pinnedByUser` exists to
        // recognize — see its own doc for what this unlocks in `style` below.
        pinnedByUser: true,
      };
      setPersisted(next);
      writePersisted(next, environment);
    }
    setIsDragging(false);
    // `didDragRef` is intentionally NOT cleared here — `consumeDragFlag` (called from `onClick`,
    // which fires after this handler) is what clears it, once. Clearing it here would defeat the
    // whole point: `click` always follows `pointerup`, so the flag has to survive until then.
  }, [handlePointerMove]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      // Right-button/non-primary pointers don't start a drag — a right-click should still be
      // able to open a context menu, not get captured as a failed drag gesture.
      if (e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      dragStart.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startRight: window.innerWidth - rect.right,
        startBottom: window.innerHeight - rect.bottom,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      document.addEventListener("pointercancel", handlePointerUp);
    },
    [handlePointerMove, handlePointerUp],
  );

  const consumeDragFlag = useCallback((): boolean => {
    const dragged = didDragRef.current;
    didDragRef.current = false;
    return dragged;
  }, []);

  // `renderTick`/`isDragging` are read only to force recomputation while dragging (their values
  // are not otherwise used in the body — the live position comes from `liveRef`/`draggingRef`
  // directly, per the staleness note above) — expected extra deps, not a lint miss.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderTick/isDragging force recompute while dragging; not otherwise used in the body.
  const style = useMemo(() => {
    const live = liveRef.current;
    if (draggingRef.current && live) {
      // Clamped live so a fast drag can't throw the FAB fully off-screen mid-gesture, only to
      // have it snap back on release — the same margin used for the resting position below.
      return {
        right: clamp(live.right, FAB_EDGE_MARGIN, window.innerWidth - FAB_EDGE_MARGIN - FAB_SIZE_PX),
        bottom: clamp(live.bottom, FAB_EDGE_MARGIN, window.innerHeight - FAB_EDGE_MARGIN - FAB_SIZE_PX),
      };
    }
    const rightPx = clamp(
      persisted.rightFraction * window.innerWidth,
      FAB_EDGE_MARGIN,
      window.innerWidth - FAB_EDGE_MARGIN - FAB_SIZE_PX,
    );
    const bottomPx = clamp(
      persisted.bottomFraction * window.innerHeight,
      FAB_EDGE_MARGIN,
      window.innerHeight - FAB_EDGE_MARGIN - FAB_SIZE_PX,
    );
    // While the dock/sheet is open, hold clear of it — but only at the UNTOUCHED default spot or a
    // migrated legacy one (`!persisted.pinnedByUser`); an operator who explicitly dragged the FAB
    // somewhere, including onto the open dock, gets that placement respected instead of vetoed (see
    // `pinnedByUser`'s own doc for the 2026-08-05 bug this distinction fixes: the avoidance below
    // was pushing ANY drop inside the dock's width back out onto the page on every release, because
    // it did not yet know a drop was deliberate).
    //
    // TWO axes, because the dock occupies a different edge depending on mode, and getting this
    // wrong is not cosmetic — a FAB overlapping the composer's send button eats the click:
    //   - sheet mode (mobile): the sheet spans the full width along the BOTTOM, so `avoidBottomPx`
    //     (its measured height) is the axis that matters.
    //   - docked mode (desktop): the dock is pinned to the RIGHT edge, which is the same edge the
    //     FAB offsets from, so `avoidRightPx` (its measured width) is the axis that matters.
    // The old `.chat-fab-dock-open { right: calc(380px + 20px) }` rule covered only the second of
    // those, and only at one hard-coded width; an earlier version of this comment claimed
    // `avoidBottomPx` generalized it, which was wrong — different axis. See the `avoidRightPx`
    // param doc for what that cost.
    //
    // Re-clamped against the viewport, and that clamp is load-bearing rather than defensive.
    // `avoidBottomPx` is a raw PIXEL measurement of another element (`App.tsx` measures the sheet),
    // so it is the one input here that is not viewport-relative by construction — everything else
    // on this path is a 0-1 fraction re-derived against the current window. A sheet taller than
    // `innerHeight - FAB_EDGE_MARGIN - FAB_SIZE_PX` therefore pushes the FAB clean off the top
    // edge, where it is unreachable and looks simply missing. Reported by the operator as "hidden
    // and not shown at the bottom" and identified by reading this expression — the specific
    // viewport it reproduces at has NOT been pinned down, so treat the clamp as the fix and this
    // sentence as the limit of what was confirmed. Bounded below by the margin too, so an
    // unmeasured sheet reporting 0 cannot pin the FAB flush to the edge either.
    const avoidDock = dockOpen && !persisted.pinnedByUser;
    const effectiveBottom = clamp(
      avoidDock ? Math.max(bottomPx, avoidBottomPx + FAB_EDGE_MARGIN) : bottomPx,
      FAB_EDGE_MARGIN,
      Math.max(FAB_EDGE_MARGIN, window.innerHeight - FAB_EDGE_MARGIN - FAB_SIZE_PX),
    );
    // Same shape, same clamp, and the clamp is load-bearing for the same reason: `avoidRightPx` is
    // a raw pixel measurement of another element, so a dock wider than the viewport allows would
    // otherwise push the FAB off the left edge where it looks simply missing.
    const effectiveRight = clamp(
      avoidDock ? Math.max(rightPx, avoidRightPx + FAB_EDGE_MARGIN) : rightPx,
      FAB_EDGE_MARGIN,
      Math.max(FAB_EDGE_MARGIN, window.innerWidth - FAB_EDGE_MARGIN - FAB_SIZE_PX),
    );
    return { right: effectiveRight, bottom: effectiveBottom };
  }, [persisted, dockOpen, avoidBottomPx, avoidRightPx, renderTick, isDragging]);

  return { style, onPointerDown, consumeDragFlag, isDragging };
}

/** Storage and DOM handles are host ports; geometry matches the host button CSS. */
export interface FabPositionInput {
 readonly dockOpen: boolean; readonly avoidBottomPx: number; readonly avoidRightPx?: number;
 readonly storageKey: string; readonly storage: Pick<Storage, "getItem" | "setItem">;
 readonly viewport: Window; readonly pointerEvents: Document;
 /** Keeps the FAB's edge margin and the sheet-avoidance gap in one place instead of duplicating
 *  the literal in both this file and `styles.css`. */
 readonly edgeMargin: number;
 /** Matches `.chat-fab`'s own `width`/`height` in `styles/assistant.css` — used only to keep a
 *  dragged position from clamping the FAB half off-screen; if that CSS size ever changes, update
 *  both together (there is no single source of truth to read the rendered size from here without
 *  a layout measurement on every drag frame, which is not worth it for a constant that changes
 *  approximately never). */
 readonly sizePx: number;
 /** Below this many pixels of net pointer movement, a pointerdown/up pair is treated as a click,
 *  not a drag — small enough that an intentional drag is never mistaken for a tap, large enough
 *  that a tap's inevitable few pixels of finger movement never gets misread as a drag and eaten. */
 readonly dragThresholdPx: number;
}
