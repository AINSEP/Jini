/**
 * Keep state/effects and DOM helpers separate from JSX so the dropdown hook can be
 * injected through useDropdown and exercised directly without driving a portaled tree.
 * Compose the smaller hooks unconditionally in their original relative order to obey
 * React hook ordering. Extracting the live DOM key handling from pure highlight decisions
 * reduces the review burden without changing focus or event-order contracts.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

// Below eight options, a search field adds clutter to a list that is already easy to scan.
const SEARCH_VISIBILITY_THRESHOLD = 8;

// 280px is only a placement heuristic; the panel actual maxHeight and scroll limit use
// the remaining viewport space so a low trigger does not open a mostly off-screen panel.
const ESTIMATED_PANEL_HEIGHT = 280;

// The panel is portaled to the end of document.body. Native Tab would follow that DOM
// position toward browser chrome; walk the trigger real DOM-order neighbours instead.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SelectOption {
  value: string;
  label: string;
}

export function focusableInDomOrder({ exclude }: { exclude: HTMLElement | null }): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !exclude || !exclude.contains(el)
  );
}

export interface PanelPosition {
  top?: number | undefined;
  bottom?: number | undefined;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Use fixed viewport-relative coordinates to escape scrolling/overflow-hidden ancestors
 * without coupling to their layout. maxHeight uses actual remaining space, not the estimate,
 * so the panel scroll area clips options before the viewport edge does.
 */
export function computePosition({ trigger }: { trigger: HTMLElement }): PanelPosition {
  const rect = trigger.getBoundingClientRect();
  const gap = 4;
  const viewportHeight = window.innerHeight;
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  const openUpward = spaceBelow < ESTIMATED_PANEL_HEIGHT && spaceAbove > spaceBelow;
  if (openUpward) {
    return { bottom: viewportHeight - rect.top + gap, left: rect.left, width: rect.width, maxHeight: Math.max(120, spaceAbove - gap * 2) };
  }
  return { top: rect.bottom + gap, left: rect.left, width: rect.width, maxHeight: Math.max(120, spaceBelow - gap * 2) };
}

export function buildOptionId({ listboxId, index }: { listboxId: string; index: number }): string {
  return `${listboxId}-option-${index}`;
}

/**
 * Positioning reports a clipped or obscured trigger through onOutOfView; deciding whether
 * to close belongs to the dropdown lifecycle rather than this reusable measurement hook.
 */
export function usePanelPosition({
  open,
  triggerRef,
  panelRef,
  searchInputRef,
  showSearch,
  onOutOfView,
}: {
  open: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  showSearch: boolean;
  onOutOfView: () => void;
}) {
  const [position, setPosition] = useState<PanelPosition | null>(null);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: two-phase focus effect — see comment above; refs/showSearch intentionally excluded, only open/position redrive it.
  useLayoutEffect(() => {
    if (!open) return;
    if (!position) {
      if (triggerRef.current) setPosition(computePosition({ trigger: triggerRef.current }));
      return;
    }
    if (showSearch) {
      searchInputRef.current?.focus();
    } else {
      panelRef.current?.focus();
    }
  }, [open, position]);

  // Keeps the panel anchored to the trigger if the surrounding page/dialog scrolls or resizes while
  // it's open — `.widget-picker-body`'s own `overflow-y: auto` made this a real, live scenario
  // rather than a hypothetical one. `scroll` needs the capture phase: an inner element's own scroll
  // does not bubble to `window` in the bubble phase. The decision logic itself is
  // `repositionOrClose`, above; this effect is only the DOM listener wiring.
  //
  // Found live in a real browser, not by this component's own test suite: scrolling a host's
  // scrolling ancestor far enough that the trigger scrolls out of its own visible clip used to leave
  // this effect happily recomputing a mathematically-correct `position` for it — the panel just
  // ended up following the trigger to an off-screen (or behind-the-header, obscured) spot, floating
  // there indefinitely, nominally still "open" with no visible way to tell.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll/resize listener wiring — see comment above; triggerRef/onOutOfView intentionally excluded, only `open` re-arms it.
  useEffect(() => {
    if (!open) return;
    function reposition() {
      const el = triggerRef.current;
      if (!el) return;
      repositionOrClose({ trigger: el, onOutOfView: onOutOfView, setPosition: setPosition });
    }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  return { position, setPosition };
}

export function repositionOrClose({ trigger, onOutOfView, setPosition }: { trigger: HTMLElement; onOutOfView: () => void; setPosition: (position: PanelPosition) => void }) {
  const rect = trigger.getBoundingClientRect();
  const outOfViewport = rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth;
  if (outOfViewport) {
    onOutOfView();
    return;
  }
  if (typeof document.elementFromPoint === "function") {
    const topmostAtCenter = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const obscured = !topmostAtCenter || !(trigger.contains(topmostAtCenter) || topmostAtCenter.contains(trigger));
    if (obscured) {
      onOutOfView();
      return;
    }
  }
  setPosition(computePosition({ trigger: trigger }));
}

function useCloseOnOutsideClick({
  open,
  triggerRef,
  panelRef,
  onOutside,
}: {
  open: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onOutside: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onOutside();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

// A search can remove the previously highlighted option; re-anchor to the first match
// rather than keep a stale index outside the narrowed list.
function useResetHighlightOnQueryChange({
  open,
  query,
  hasMatches,
  setHighlightedIndex,
}: {
  open: boolean;
  query: string;
  hasMatches: boolean;
  setHighlightedIndex: (index: number) => void;
}) {
  useEffect(() => {
    if (!open) return;
    setHighlightedIndex(hasMatches ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
}

/**
 * Keyboard highlight used to move logically past the visible fold without scrolling its
 * row into view. nearest scrolls only what is needed instead of recentering the list and
 * fighting a user who has already scrolled it manually.
 */
function useScrollHighlightedIntoView({
  open,
  highlightedIndex,
  optionRefs,
}: {
  open: boolean;
  highlightedIndex: number;
  optionRefs: React.RefObject<Map<number, HTMLLIElement>>;
}) {
  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const el = optionRefs.current.get(highlightedIndex);
    // Guarded the same way as `document.elementFromPoint` above — this app's own jsdom test
    // harness doesn't implement `scrollIntoView` at all (not even as a no-op), so an unguarded call
    // throws inside the effect on every highlight change.
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, [open, highlightedIndex]);
}

export function resolveTabTarget({ panel, trigger, shiftKey }: { panel: HTMLElement | null; trigger: HTMLElement | null; shiftKey: boolean }
): HTMLElement | null {
  const nodes = focusableInDomOrder({ exclude: panel });
  const triggerIndex = trigger ? nodes.indexOf(trigger) : -1;
  if (triggerIndex < 0) return null;
  return nodes[triggerIndex + (shiftKey ? -1 : 1)] ?? null;
}

export function edgeHighlightIndex({ filteredLength, edge }: { filteredLength: number; edge: "first" | "last" }): number {
  if (filteredLength === 0) return -1;
  return edge === "first" ? 0 : filteredLength - 1;
}

export function highlightedOptionOrNull({ filtered, highlightedIndex }: { filtered: SelectOption[]; highlightedIndex: number }): SelectOption | null {
  return highlightedIndex >= 0 ? (filtered[highlightedIndex] ?? null) : null;
}

export function applyHighlightKey({ key, filtered, highlightedIndex, actions }: { key: string; filtered: SelectOption[]; highlightedIndex: number; actions: {
    preventDefault: () => void;
    moveHighlight: (delta: 1 | -1) => void;
    setHighlightedIndex: (index: number) => void;
    selectOption: (option: SelectOption) => void;
  } }
): boolean {
  switch (key) {
    case "ArrowDown":
      actions.preventDefault();
      actions.moveHighlight(1);
      return true;
    case "ArrowUp":
      actions.preventDefault();
      actions.moveHighlight(-1);
      return true;
    case "Home":
      actions.preventDefault();
      actions.setHighlightedIndex(edgeHighlightIndex({ filteredLength: filtered.length, edge: "first" }));
      return true;
    case "End":
      actions.preventDefault();
      actions.setHighlightedIndex(edgeHighlightIndex({ filteredLength: filtered.length, edge: "last" }));
      return true;
    case "Enter": {
      actions.preventDefault();
      const option = highlightedOptionOrNull({ filtered: filtered, highlightedIndex: highlightedIndex });
      if (option) actions.selectOption(option);
      return true;
    }
    default:
      return false;
  }
}

// Keep live event/focus effects in the key handler; move the trigger-neighbour calculation
// out so changing the DOM effects does not bury the independently testable focus decision.
function useSelectKeyboardHandlers({
  disabled,
  open,
  openPanel,
  closePanel,
  moveHighlight,
  selectOption,
  highlightedIndex,
  setHighlightedIndex,
  filtered,
  triggerRef,
  panelRef,
}: {
  disabled: boolean | undefined;
  open: boolean;
  openPanel: () => void;
  closePanel: (opts: { refocusTrigger: boolean }) => void;
  moveHighlight: (delta: 1 | -1) => void;
  selectOption: (option: SelectOption) => void;
  highlightedIndex: number;
  setHighlightedIndex: (index: number) => void;
  filtered: SelectOption[];
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled || open) return;
    switch (e.key) {
      case "Enter":
      case " ":
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        openPanel();
        break;
      default:
        break;
    }
  }


  // Escape/Tab need live propagation and focus effects. Highlight/selection keys delegate
  // to the pure helper; preventDefault is injected to preserve its order before each action.
  function handlePanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // Must not bubble: a host dialog (`WidgetPickerDialog`) listens for Escape on `document`
      // to cancel the whole modal. Without stopping propagation here, closing just this dropdown
      // would also close the dialog underneath it — the regression `Select.unit.test.tsx` pins.
      e.preventDefault();
      e.stopPropagation();
      closePanel({ refocusTrigger: true });
      return;
    }
    if (e.key === "Tab") {
      // See `resolveTabTarget`'s own comment: walk the trigger's real DOM-order neighbours rather
      // than let native Tab handling run, since this event is bubbling from a panel portaled to
      // the end of `document.body`, not sitting next to the trigger in the DOM.
      const target = resolveTabTarget({ panel: panelRef.current, trigger: triggerRef.current, shiftKey: e.shiftKey });
      e.preventDefault();
      closePanel({ refocusTrigger: false });
      target?.focus();
      return;
    }
    applyHighlightKey({ key: e.key, filtered: filtered, highlightedIndex: highlightedIndex, actions: {
      preventDefault: () => e.preventDefault(),
      moveHighlight,
      setHighlightedIndex,
      selectOption,
    } });
  }

  return { handleTriggerKeyDown, handlePanelKeyDown };
}

/**
 * Separate hook state from rendering so search visibility, wraparound, placement and
 * out-of-view closing can be asserted directly without coupling every case to portal DOM.
 */
export function useSelectDropdown({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}, { disabled }: { disabled?: boolean | undefined } = {}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Index -> `<li>` node, so the highlight-follow effect below can scroll the right row into view
  // without an id-based `querySelector` (this component's ids come from `useId()`, which can
  // contain characters — `:`, in React's own scheme — that need escaping in a CSS selector; a
  // direct ref avoids that entirely). Populated by each option's own ref callback below.
  const optionRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  const listboxId = useId();

  const showSearch = options.length >= SEARCH_VISIBILITY_THRESHOLD;
  const filtered = useMemo(() => {
    if (!showSearch || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, showSearch]);

  const selectedOption = options.find((o) => o.value === value) ?? null;

  function openPanel() {
    if (disabled) return;
    const initialIndex = options.findIndex((o) => o.value === value);
    setQuery("");
    setOpen(true);
    setHighlightedIndex(initialIndex >= 0 ? initialIndex : options.length ? 0 : -1);
  }

  function closePanel(opts: { refocusTrigger: boolean }) {
    setOpen(false);
    setPosition(null); // forces the effect below through its "measure, then focus" two-phase sequence again on the next open, rather than focusing at a stale, pre-close position
    if (opts.refocusTrigger) triggerRef.current?.focus();
  }

  function selectOption(option: SelectOption) {
    onChange(option.value);
    closePanel({ refocusTrigger: true });
  }

  function moveHighlight(delta: 1 | -1) {
    setHighlightedIndex((current) => {
      if (filtered.length === 0) return -1;
      return (current + delta + filtered.length) % filtered.length;
    });
  }

  const { position, setPosition } = usePanelPosition({
    open,
    triggerRef,
    panelRef,
    searchInputRef,
    showSearch,
    onOutOfView: () => closePanel({ refocusTrigger: false }),
  });

  useCloseOnOutsideClick({
    open,
    triggerRef,
    panelRef,
    onOutside: () => closePanel({ refocusTrigger: false }),
  });

  useResetHighlightOnQueryChange({ open, query, hasMatches: filtered.length > 0, setHighlightedIndex });

  useScrollHighlightedIntoView({ open, highlightedIndex, optionRefs });

  const { handleTriggerKeyDown, handlePanelKeyDown } = useSelectKeyboardHandlers({
    disabled,
    open,
    openPanel,
    closePanel,
    moveHighlight,
    selectOption,
    highlightedIndex,
    setHighlightedIndex,
    filtered,
    triggerRef,
    panelRef,
  });

  const optionId = (index: number) => buildOptionId({ listboxId: listboxId, index: index });

  return {
    open,
    query,
    setQuery,
    highlightedIndex,
    setHighlightedIndex,
    position,
    triggerRef,
    panelRef,
    searchInputRef,
    optionRefs,
    listboxId,
    showSearch,
    filtered,
    selectedOption,
    openPanel,
    closePanel,
    selectOption,
    handleTriggerKeyDown,
    handlePanelKeyDown,
    optionId,
  };
}
