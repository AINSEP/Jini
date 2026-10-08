/** Shared DOM lifecycle for the two custom select variants. Option/search policy stays in each adapter. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

// The panel is portaled to the end of document.body, its dialog, or a host container. Native Tab
// would follow that DOM position toward browser chrome; walk the trigger real DOM-order
// neighbours instead, staying inside a modal dialog when one owns the trigger.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** DOM-order focus candidates within root, excluding the floating panel's own controls. */
export function focusableInDomOrder({ exclude }: { exclude: HTMLElement | null }, { root = document }: { root?: ParentNode | undefined } = {}): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !exclude || !exclude.contains(el)
  );
}

/** Find the trigger's Tab neighbour, wrapping within its modal dialog to avoid inert page controls. */
export function resolveTabTarget({ panel, trigger, shiftKey }: { panel: HTMLElement | null; trigger: HTMLElement | null; shiftKey: boolean }, _optional: Record<string, never> = {}
): HTMLElement | null {
  const dialog = trigger?.closest("dialog[open]");
  // An open non-modal dialog permits focus outside it; only showModal() creates inert neighbours.
  const modalDialog = dialog?.matches(":modal") ? dialog : null;
  const nodes = focusableInDomOrder({ exclude: panel }, { root: modalDialog ?? document });
  const triggerIndex = trigger ? nodes.indexOf(trigger) : -1;
  if (triggerIndex < 0) return null;
  const nextIndex = triggerIndex + (shiftKey ? -1 : 1);
  return nodes[modalDialog ? (nextIndex + nodes.length) % nodes.length : nextIndex] ?? null;
}

/** Resolve a portal inside the trigger's native dialog so its menu stays above inert page content. */
export function resolveSelectPortalContainer({ trigger }: { trigger: HTMLElement | null },
  { container }: { container?: Element | DocumentFragment | null | undefined } = {},
): Element | DocumentFragment {
  return container ?? trigger?.closest('dialog') ?? document.body;
}

/** Pure containment decision; outside clicks must neither select an option nor steal focus. */
export function isSelectEventInside({ target, trigger, panel }: {
  target: Node; trigger: HTMLElement | null; panel: HTMLElement | null;
}, _optional: Record<string, never> = {}): boolean {
  return Boolean(trigger?.contains(target) || panel?.contains(target));
}

/** Apply the variant's geometry port; widget selects additionally dismiss a clipped/obscured trigger. */
export function repositionSelectPopover<P>({ trigger, measurePosition, setPosition }: {
  trigger: HTMLElement; measurePosition: (input: { trigger: HTMLElement }) => P; setPosition: (position: P) => void;
}, { onOutOfView }: { onOutOfView?: (() => void) | undefined } = {}) {
  if (onOutOfView) {
    const rect = trigger.getBoundingClientRect();
    const outOfViewport = rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth;
    if (outOfViewport) { onOutOfView(); return; }
    if (typeof document.elementFromPoint === 'function') {
      const topmostAtCenter = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const obscured = !topmostAtCenter || !(trigger.contains(topmostAtCenter) || topmostAtCenter.contains(trigger));
      if (obscured) { onOutOfView(); return; }
    }
  }
  setPosition(measurePosition({ trigger }));
}

/** Measure before mounting/focusing a portal, then keep it anchored until close; listeners are disposed on close/unmount.
 * Geometry is O(1); focus/visibility effects use the live DOM. The port retains each variant's existing placement bounds.
 */
export function useSelectPopoverPosition<P>(required: {
  open: boolean; triggerRef: RefObject<HTMLButtonElement | null>; panelRef: RefObject<HTMLDivElement | null>;
  measurePosition: (input: { trigger: HTMLElement }) => P;
}, optional: {
  portal?: boolean | undefined;
  focusInitial?: ((input: { panel: HTMLDivElement | null }) => void) | undefined;
  onOutOfView?: (() => void) | undefined;
} = {}) {
  const { open, triggerRef, panelRef } = required, portal = optional.portal !== false;
  const latest = useRef({ required, optional });
  latest.current = { required, optional };
  const [position, setPosition] = useState<P | null>(null);
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger) setPosition(latest.current.required.measurePosition({ trigger }));
  }, [triggerRef]);
  // Two phases, deliberately in one effect rather than two: (1) `position` starts `null` on every
  // open (`closePanel` resets it), so the panel/`createPortal` call below isn't rendered at all yet
  // — `panelRef`/`searchInputRef` are still unattached, so focusing them here would silently no-op.
  // Computing `position` schedules a state update; because this is a `useLayoutEffect`, React
  // re-renders and re-runs layout effects synchronously before the browser paints, rather than
  // waiting a frame. (2) On that second pass `position` is non-null, the portal now exists in the
  // DOM, and the refs are populated — only now is it correct to move focus into it. Found live via
  // this component's own tests: every keyboard-driven test failed until this was split out, because
  // `panelRef.current`/`searchInputRef.current` were both still `null` when focus was attempted in
  // the same pass that first computed the position.
  // biome-ignore lint/correctness/useExhaustiveDependencies: two-phase focus effect — see comment above; changing search/focus callbacks are read through latest and intentionally do not redrive it.
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    if (portal && !position) { updatePosition(); return; }
    latest.current.optional.focusInitial?.({ panel: panelRef.current });
  }, [open, position, portal, updatePosition, panelRef]);
  // Keeps the panel anchored to the trigger if the surrounding page/dialog scrolls or resizes while
  // it's open — `.widget-picker-body`'s own `overflow-y: auto` made this a real, live scenario
  // rather than a hypothetical one. `scroll` needs the capture phase: an inner element's own scroll
  // does not bubble to `window` in the bubble phase. The decision logic itself is
  // `repositionSelectPopover`, above; this effect is only the DOM listener wiring.
  //
  // Found live in a real browser, not by this component's own test suite: scrolling a host's
  // scrolling ancestor far enough that the trigger scrolls out of its own visible clip used to leave
  // this effect happily recomputing a mathematically-correct `position` for it — the panel just
  // ended up following the trigger to an off-screen (or behind-the-header, obscured) spot, floating
  // there indefinitely, nominally still "open" with no visible way to tell.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll/resize listener wiring — see comment above; onOutOfView is read through latest; only lifecycle/ref changes re-arm it.
  useEffect(() => {
    if (!open || !portal) return;
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      repositionSelectPopover({ trigger, measurePosition: latest.current.required.measurePosition, setPosition },
        { onOutOfView: latest.current.optional.onOutOfView });
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, portal, triggerRef]);
  return { position, setPosition, updatePosition };
}

/** Open/close, outside dismissal and Escape/Tab focus handling shared by the public select variants.
 * Tab scans the focusable DOM in O(n); other lifecycle transitions are O(1).
 * @example useSelectPopover({ measurePosition }, { focusInitial: ({ panel }) => panel?.focus() })
 */
export function useSelectPopover<P>(required: { measurePosition: (input: { trigger: HTMLElement }) => P }, optional: {
  portal?: boolean | undefined; disabled?: boolean | undefined; dismissWhenHidden?: boolean | undefined;
  focusInitial?: ((input: { panel: HTMLDivElement | null }) => void) | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
} = {}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null), panelRef = useRef<HTMLDivElement | null>(null);
  // Stored in a ref (not a `useEffect` dependency) so an unmemoized caller
  // passing a fresh function identity every render never re-fires this for
  // any reason OTHER than `open` actually changing.
  const latest = useRef(optional);
  latest.current = optional;
  useEffect(() => { latest.current.onOpenChange?.(open); }, [open]);
  const placement = useSelectPopoverPosition({ open, triggerRef, panelRef, measurePosition: required.measurePosition }, {
    portal: optional.portal, focusInitial: optional.focusInitial,
    onOutOfView: optional.dismissWhenHidden ? () => closePanel({ refocusTrigger: false }) : undefined,
  });
  function openPanel() { if (!latest.current.disabled) setOpen(true); }
  function closePanel({ refocusTrigger }: { refocusTrigger: boolean }) {
    setOpen(false);
    placement.setPosition(null); // forces the effect through its "measure, then focus" two-phase sequence again on the next open, rather than focusing at a stale, pre-close position
    if (refocusTrigger) triggerRef.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    function onOutside(event: MouseEvent) {
      if (isSelectEventInside({ target: event.target as Node, trigger: triggerRef.current, panel: panelRef.current })) return;
      closePanel({ refocusTrigger: false });
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);
  function handleDismissKey(event: KeyboardEvent<HTMLElement>): boolean {
    if (!open) return false;
    if (event.key === 'Escape') {
      // Must not bubble: a host dialog (`WidgetPickerDialog`) listens for Escape on `document`
      // to cancel the whole modal. Without stopping propagation here, closing just this dropdown
      // would also close the dialog underneath it — the regression `Select.unit.test.tsx` pins.
      event.preventDefault(); event.stopPropagation(); closePanel({ refocusTrigger: true }); return true;
    }
    if (event.key === 'Tab') {
      // See `resolveTabTarget`'s own comment: walk the trigger's real DOM-order neighbours rather
      // than let native Tab handling run, since this event is bubbling from a panel portaled to
      // the end of `document.body`, its dialog, or a host container, not sitting next to the
      // trigger in the DOM. Dialog-local traversal avoids focusing inert page neighbours.
      if (optional.portal !== false) {
        const target = resolveTabTarget({ panel: panelRef.current, trigger: triggerRef.current, shiftKey: event.shiftKey });
        event.preventDefault(); closePanel({ refocusTrigger: false }); target?.focus();
      } else closePanel({ refocusTrigger: false });
      return true;
    }
    return false;
  }
  return { open, triggerRef, panelRef, ...placement, openPanel, closePanel, handleDismissKey };
}

/** Open-key decision shared by variants; returns false for unrelated keys or an already-open/disabled trigger. */
export function openSelectOnKey({ event, open, openPanel }: {
  event: KeyboardEvent<HTMLElement>; open: boolean; openPanel: () => void;
}, { disabled }: { disabled?: boolean | undefined } = {}): boolean {
  if (disabled || open || !['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return false;
  event.preventDefault(); openPanel(); return true;
}

/** Shared keyboard dispatch; adapters map navigation onto their enabled-value or filtered-index contract. */
export function applySelectNavigationKey({ key, actions }: { key: string; actions: {
  preventDefault: () => void; move: (delta: 1 | -1) => void; edge: (edge: 'first' | 'last') => void; choose: () => void;
} }, { spaceChooses = false }: { spaceChooses?: boolean } = {}): boolean {
  if (key === 'ArrowDown' || key === 'ArrowUp') { actions.preventDefault(); actions.move(key === 'ArrowDown' ? 1 : -1); return true; }
  if (key === 'Home' || key === 'End') { actions.preventDefault(); actions.edge(key === 'Home' ? 'first' : 'last'); return true; }
  if (key === 'Enter' || (spaceChooses && key === ' ')) { actions.preventDefault(); actions.choose(); return true; }
  return false;
}
