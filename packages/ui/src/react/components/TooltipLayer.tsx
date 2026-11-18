import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
export type InputModality = 'keyboard' | 'pointer';

export interface TooltipState {
  target: HTMLElement;
  text: string;
  placement: TooltipPlacement;
  style: {
    x: number;
    y: number;
    visibility: 'hidden' | 'visible';
  };
}

export const TOOLTIP_MARGIN = 8;
export const TOOLTIP_GAP = 7;

// Contract: any element with class `jini-tooltip` and a non-empty
// `data-tooltip` attribute is a tooltip trigger. `aria-expanded="true"`
// suppresses the tooltip (the element already has an open popover/menu of
// its own, so a hover tooltip on top of it would be redundant).
export function isTooltipTarget(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement
    && el.classList.contains('jini-tooltip')
    && Boolean(el.dataset.tooltip?.trim())
    && el.getAttribute('aria-expanded') !== 'true';
}

export function readTooltipTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null;
  const candidate = start.closest('.jini-tooltip[data-tooltip]');
  return isTooltipTarget(candidate) ? candidate : null;
}

export function tooltipPlacement(target: HTMLElement): TooltipPlacement {
  const raw = target.dataset.tooltipPlacement;
  return raw === 'bottom' || raw === 'left' || raw === 'right' ? raw : 'top';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function positionTooltip(
  target: HTMLElement,
  tooltip: HTMLElement,
  placement: TooltipPlacement,
): TooltipState['style'] {
  const rect = target.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxLeft = Math.max(TOOLTIP_MARGIN, viewportWidth - tip.width - TOOLTIP_MARGIN);
  const maxTop = Math.max(TOOLTIP_MARGIN, viewportHeight - tip.height - TOOLTIP_MARGIN);

  let left = rect.left + rect.width / 2 - tip.width / 2;
  let top = rect.top - tip.height - TOOLTIP_GAP;

  if (placement === 'bottom') {
    top = rect.bottom + TOOLTIP_GAP;
  } else if (placement === 'left') {
    left = rect.left - tip.width - TOOLTIP_GAP;
    top = rect.top + rect.height / 2 - tip.height / 2;
  } else if (placement === 'right') {
    left = rect.right + TOOLTIP_GAP;
    top = rect.top + rect.height / 2 - tip.height / 2;
  } else {
    // 'top': the centred-above position computed above already applies.
  }

  return {
    x: Math.round(clamp(left, TOOLTIP_MARGIN, maxLeft)),
    y: Math.round(clamp(top, TOOLTIP_MARGIN, maxTop)),
    visibility: 'visible',
  };
}

export function sameStyle(
  left: TooltipState['style'],
  right: TooltipState['style'],
): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.visibility === right.visibility;
}

export interface UseTooltipLayerResult {
  /** The tooltip to render, or `null` when nothing is shown. */
  state: TooltipState | null;
  /** Attach to the rendered tooltip node; the hook measures it to position itself. */
  tooltipRef: MutableRefObject<HTMLDivElement | null>;
  /** Imperatively show the tooltip for a target (no-ops if it has no tooltip text). */
  showTooltip: (target: HTMLElement) => void;
  /** Imperatively hide the tooltip. */
  hideTooltip: (options?: { restoreTitle?: boolean }) => void;
}

type SetTooltipState = Dispatch<SetStateAction<TooltipState | null>>;
type TouchTap = { target: HTMLElement | null; wasOpen: boolean } | null;

/** Pure reducer step for showing `target`: reuse `current` when nothing changed, else (re)start hidden for measuring. */
function nextStateForShow({ current, target, text, placement }: {
  current: TooltipState | null;
  target: HTMLElement;
  text: string;
  placement: TooltipPlacement;
}): TooltipState {
  if (current?.target === target) {
    if (current.text === text && current.placement === placement) return current;
    return { ...current, text, placement };
  }
  return { target, text, placement, style: { x: 0, y: 0, visibility: 'hidden' } };
}

/** Pure reducer step for repositioning: null when the target is gone/expanded, `current` when unchanged. */
function nextStateForPosition({ current, node }: {
  current: TooltipState | null;
  node: HTMLDivElement | null;
}): TooltipState | null {
  if (!current) return null;
  if (!document.contains(current.target)) return null;
  if (current.target.getAttribute('aria-expanded') === 'true') return null;
  if (!node) return current;
  const placement = tooltipPlacement(current.target);
  const nextText = current.target.dataset.tooltip?.trim() ?? current.text;
  const nextStyle = positionTooltip(current.target, node, placement);
  if (
    current.text === nextText
    && current.placement === placement
    && sameStyle(current.style, nextStyle)
  ) {
    return current;
  }
  return { ...current, text: nextText, placement, style: nextStyle };
}

/** Swaps a target's native `title` out while its tooltip is in play, so the two never double up. */
function useNativeTitleSuppression() {
  const suppressedTitleRef = useRef<{ target: HTMLElement; title: string } | null>(null);

  const restoreNativeTitle = useCallback(() => {
    const suppressed = suppressedTitleRef.current;
    if (!suppressed) return;
    if (document.contains(suppressed.target)) {
      if (!suppressed.target.hasAttribute('title')) {
        suppressed.target.setAttribute('title', suppressed.title);
      }
      suppressed.target.removeAttribute('data-jini-tooltip-native-title');
    }
    suppressedTitleRef.current = null;
  }, []);

  const suppressNativeTitle = useCallback((target: HTMLElement) => {
    if (suppressedTitleRef.current?.target === target) return;
    restoreNativeTitle();
    const title = target.getAttribute('title');
    if (!title) return;
    target.setAttribute('data-jini-tooltip-native-title', title);
    target.removeAttribute('title');
    suppressedTitleRef.current = { target, title };
  }, [restoreNativeTitle]);

  return { restoreNativeTitle, suppressNativeTitle };
}

interface TooltipActionsDeps {
  rafRef: MutableRefObject<number | null>;
  setState: SetTooltipState;
  restoreNativeTitle: () => void;
  suppressNativeTitle: (target: HTMLElement) => void;
}

/** show / hide / hide-for-activation callbacks. */
function useTooltipActions({ rafRef, setState, restoreNativeTitle, suppressNativeTitle }: TooltipActionsDeps) {
  const hideTooltip = useCallback((options: { restoreTitle?: boolean } = {}) => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (options.restoreTitle !== false) restoreNativeTitle();
    setState(null);
  }, [rafRef, restoreNativeTitle, setState]);

  const hideTooltipForActivation = useCallback((target: HTMLElement | null) => {
    if (!target) {
      hideTooltip();
      return;
    }
    suppressNativeTitle(target);
    hideTooltip({ restoreTitle: false });
  }, [hideTooltip, suppressNativeTitle]);

  const showTooltip = useCallback((target: HTMLElement) => {
    const text = target.dataset.tooltip?.trim();
    if (!text) return;
    suppressNativeTitle(target);
    const placement = tooltipPlacement(target);
    setState((current) => nextStateForShow({ current, target, text, placement }));
  }, [suppressNativeTitle, setState]);

  return { hideTooltip, hideTooltipForActivation, showTooltip };
}

interface TooltipEventDeps {
  lastInputRef: MutableRefObject<InputModality>;
  // Touch has no hover, and a tap's own pointerdown/click would hide the tip
  // the instant it appeared — so a touch tap on a trigger TOGGLES the tip
  // instead. `touchTapRef` remembers the trigger under the touch pointerdown
  // (and whether its tip was already open) until the matching click.
  touchTapRef: MutableRefObject<TouchTap>;
  openTargetRef: MutableRefObject<HTMLElement | null>;
  showTooltip: (target: HTMLElement) => void;
  hideTooltip: (options?: { restoreTitle?: boolean }) => void;
  hideTooltipForActivation: (target: HTMLElement | null) => void;
  suppressNativeTitle: (target: HTMLElement) => void;
}

function createPointerHandlers(deps: TooltipEventDeps) {
  const { lastInputRef, touchTapRef, openTargetRef, showTooltip, hideTooltip, hideTooltipForActivation } = deps;
  return {
    onPointerOver: (event: PointerEvent) => {
      lastInputRef.current = 'pointer';
      if (event.pointerType === 'touch') return;
      const target = readTooltipTarget(event.target);
      if (target) showTooltip(target);
    },
    onTargetExit: (event: PointerEvent | FocusEvent) => {
      if ('pointerType' in event && event.pointerType === 'touch') return;
      const target = readTooltipTarget(event.target);
      if (!target) return;
      const next = event.relatedTarget;
      if (next instanceof Node && target.contains(next)) return;
      hideTooltip();
    },
    onPointerDown: (event: PointerEvent) => {
      lastInputRef.current = 'pointer';
      const target = readTooltipTarget(event.target);
      touchTapRef.current = null;
      if (event.pointerType === 'touch' && target) {
        touchTapRef.current = { target, wasOpen: openTargetRef.current === target };
        return;
      }
      hideTooltipForActivation(target);
    },
    onPointerCancel: () => {
      lastInputRef.current = 'pointer';
      touchTapRef.current = null;
      hideTooltip();
    },
    onClick: (event: MouseEvent) => {
      const target = readTooltipTarget(event.target);
      const touchTap = touchTapRef.current;
      touchTapRef.current = null;
      if (target && touchTap?.target === target && !touchTap.wasOpen) {
        showTooltip(target);
        return;
      }
      hideTooltipForActivation(target);
    },
  };
}

function createFocusKeyHandlers(deps: TooltipEventDeps) {
  const { lastInputRef, showTooltip, hideTooltip, hideTooltipForActivation, suppressNativeTitle } = deps;
  const shouldShowForFocus = (target: HTMLElement) => {
    if (lastInputRef.current === 'keyboard') return true;
    try {
      return target.matches(':focus-visible');
    } catch {
      return false;
    }
  };
  return {
    onFocusIn: (event: FocusEvent) => {
      const target = readTooltipTarget(event.target);
      if (!target) return;
      if (shouldShowForFocus(target)) {
        showTooltip(target);
        return;
      }
      suppressNativeTitle(target);
    },
    onKeyDown: (event: KeyboardEvent) => {
      lastInputRef.current = 'keyboard';
      if (event.key === 'Escape') hideTooltip();
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        hideTooltipForActivation(readTooltipTarget(event.target));
      }
    },
  };
}

/** Delegates pointer/focus/keyboard events on `document` (and resize/scroll on `window`) to the tooltip actions. */
function useTooltipEventDelegation({ deps, scheduleUpdatePosition }: {
  deps: TooltipEventDeps;
  scheduleUpdatePosition: () => void;
}) {
  const { showTooltip, hideTooltip, hideTooltipForActivation, suppressNativeTitle } = deps;
  const { lastInputRef, touchTapRef, openTargetRef } = deps;

  useEffect(() => {
    const pointer = createPointerHandlers({
      lastInputRef, touchTapRef, openTargetRef, showTooltip, hideTooltip, hideTooltipForActivation, suppressNativeTitle,
    });
    const focusKey = createFocusKeyHandlers({
      lastInputRef, touchTapRef, openTargetRef, showTooltip, hideTooltip, hideTooltipForActivation, suppressNativeTitle,
    });
    const documentListeners: [string, EventListener][] = [
      ['pointerover', pointer.onPointerOver as EventListener],
      ['pointerout', pointer.onTargetExit as EventListener],
      ['pointerdown', pointer.onPointerDown as EventListener],
      ['pointercancel', pointer.onPointerCancel as EventListener],
      ['click', pointer.onClick as EventListener],
      ['focusin', focusKey.onFocusIn as EventListener],
      ['focusout', pointer.onTargetExit as EventListener],
      ['keydown', focusKey.onKeyDown as EventListener],
    ];
    for (const [type, listener] of documentListeners) document.addEventListener(type, listener);
    window.addEventListener('resize', scheduleUpdatePosition);
    window.addEventListener('scroll', scheduleUpdatePosition, true);
    return () => {
      for (const [type, listener] of documentListeners) document.removeEventListener(type, listener);
      window.removeEventListener('resize', scheduleUpdatePosition);
      window.removeEventListener('scroll', scheduleUpdatePosition, true);
    };
  }, [
    hideTooltip, hideTooltipForActivation, scheduleUpdatePosition, showTooltip, suppressNativeTitle,
    lastInputRef, touchTapRef, openTargetRef,
  ]);
}

/** Hides the tip as soon as its target stops being a valid trigger (class/attr/disabled changes). */
function useTargetMutationGuard({ target, hideTooltip }: {
  target: HTMLElement | undefined;
  hideTooltip: (options?: { restoreTitle?: boolean }) => void;
}) {
  useEffect(() => {
    if (!target || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      if (!isTooltipTarget(target)) {
        hideTooltip({ restoreTitle: false });
      }
    });
    observer.observe(target, {
      attributes: true,
      attributeFilter: ['aria-expanded', 'class', 'data-tooltip', 'disabled'],
    });
    return () => observer.disconnect();
  }, [hideTooltip, target]);
}

/**
 * All of the tooltip layer's behavior — state, refs, the show/hide/position
 * callbacks, and the `document`/`window` event delegation — with no rendering.
 * Delegates pointer/focus/keyboard events on `document` to find
 * `.jini-tooltip[data-tooltip]` elements and computes one positioned tooltip.
 * Exported (with the pure helpers above) so the logic is testable and mockable
 * in isolation from the DOM render; `TooltipLayer` is the dumb consumer.
 */
export function useTooltipLayer(): UseTooltipLayerResult {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastInputRef = useRef<InputModality>('pointer');
  const touchTapRef = useRef<TouchTap>(null);
  const openTargetRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<TooltipState | null>(null);

  const { restoreNativeTitle, suppressNativeTitle } = useNativeTitleSuppression();
  const actions = useTooltipActions({ rafRef, setState, restoreNativeTitle, suppressNativeTitle });
  const { hideTooltip, showTooltip } = actions;

  const updatePosition = useCallback(() => {
    setState((current) => nextStateForPosition({ current, node: tooltipRef.current }));
  }, []);

  const scheduleUpdatePosition = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updatePosition();
    });
  }, [updatePosition]);

  useLayoutEffect(() => {
    openTargetRef.current = state?.target ?? null;
    if (!state) return;
    updatePosition();
  }, [state?.target, state?.text, state?.placement, updatePosition]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      restoreNativeTitle();
    };
  }, [restoreNativeTitle]);

  useTargetMutationGuard({ target: state?.target, hideTooltip });
  useTooltipEventDelegation({
    deps: { lastInputRef, touchTapRef, openTargetRef, suppressNativeTitle, ...actions },
    scheduleUpdatePosition,
  });

  return { state, tooltipRef, showTooltip, hideTooltip };
}

/**
 * Single global tooltip layer. Mount once near the app root; any element
 * anywhere in the tree can opt in just by adding the `jini-tooltip` class and
 * a `data-tooltip` attribute (optionally `data-tooltip-placement`). All logic
 * lives in {@link useTooltipLayer}; this component only renders the positioned
 * tooltip via a portal.
 */
export interface TooltipLayerProps {
  /** Custom hook override for dependency injection / testing. */
  useTooltipLayer?: typeof useTooltipLayer;
}

export function TooltipLayer({
  useTooltipLayer: useTooltipLayerHook = useTooltipLayer,
}: TooltipLayerProps = {}) {
  const { state, tooltipRef } = useTooltipLayerHook();

  if (!state || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={tooltipRef}
      className="jini-tooltip-layer"
      role="tooltip"
      style={{
        transform: `translate3d(${state.style.x}px, ${state.style.y}px, 0)`,
        visibility: state.style.visibility,
      }}
    >
      {state.text}
    </div>,
    document.body,
  );
}
