/**
 * Keep state/effects and DOM helpers separate from JSX so the dropdown hook can be
 * injected through useDropdown and exercised directly without driving a portaled tree.
 * Compose the smaller hooks unconditionally in their original relative order to obey
 * React hook ordering. Extracting the live DOM key handling from pure highlight decisions
 * reduces the review burden without changing focus or event-order contracts.
 */
import { useSelectPopover, useSelectPopoverPosition, repositionSelectPopover, openSelectOnKey, applySelectNavigationKey } from '../../../../react/components/select-popover.js';
export { focusableInDomOrder, resolveTabTarget } from '../../../../react/components/select-popover.js';
import { useEffect, useId, useMemo, useRef, useState } from "react";

// Below eight options, a search field adds clutter to a list that is already easy to scan.
const SEARCH_VISIBILITY_THRESHOLD = 8;

// 280px is only a placement heuristic; the panel actual maxHeight and scroll limit use
// the remaining viewport space so a low trigger does not open a mostly off-screen panel.
const ESTIMATED_PANEL_HEIGHT = 280;

export interface SelectOption {
  value: string;
  label: string;
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
}, _optional: Record<string, never> = {}) {
  return useSelectPopoverPosition({ open, triggerRef, panelRef, measurePosition: computePosition }, {
    focusInitial: ({ panel }) => (showSearch ? searchInputRef.current : panel)?.focus(), onOutOfView,
  });
}

/** Compatibility geometry seam; lifecycle decisions are owned by the shared popover. */
export function repositionOrClose({ trigger, onOutOfView, setPosition }: { trigger: HTMLElement; onOutOfView: () => void; setPosition: (position: PanelPosition) => void }, _optional: Record<string, never> = {}) {
  repositionSelectPopover({ trigger, measurePosition: computePosition, setPosition }, { onOutOfView });
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
  return applySelectNavigationKey({ key, actions: {
    preventDefault: actions.preventDefault, move: actions.moveHighlight,
    edge: (edge) => actions.setHighlightedIndex(edgeHighlightIndex({ filteredLength: filtered.length, edge })),
    choose: () => {
      const option = highlightedOptionOrNull({ filtered, highlightedIndex });
      if (option) actions.selectOption(option);
    },
  } });
}

// Keep live event/focus effects in the key handler; move the trigger-neighbour calculation
// out so changing the DOM effects does not bury the independently testable focus decision.
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
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Index -> `<li>` node, so the highlight-follow effect below can scroll the right row into view
  // without an id-based `querySelector` (this component's ids come from `useId()`, which can
  // contain characters — `:`, in React's own scheme — that need escaping in a CSS selector; a
  // direct ref avoids that entirely). Populated by each option's own ref callback below.
  const optionRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  const listboxId = useId();

  const showSearch = options.length >= SEARCH_VISIBILITY_THRESHOLD;
  const popover = useSelectPopover({ measurePosition: computePosition }, {
    disabled, dismissWhenHidden: true,
    focusInitial: ({ panel }) => (showSearch ? searchInputRef.current : panel)?.focus(),
  });
  const { open, position, triggerRef, panelRef, closePanel } = popover;
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
    popover.openPanel();
    setHighlightedIndex(initialIndex >= 0 ? initialIndex : options.length ? 0 : -1);
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

  useResetHighlightOnQueryChange({ open, query, hasMatches: filtered.length > 0, setHighlightedIndex });
  useScrollHighlightedIntoView({ open, highlightedIndex, optionRefs });

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    openSelectOnKey({ event, open, openPanel }, { disabled });
  }
  // Escape/Tab need live propagation and focus effects. Highlight/selection keys delegate
  // to the pure helper; preventDefault is injected to preserve its order before each action.
  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (popover.handleDismissKey(event)) return;
    applyHighlightKey({ key: event.key, filtered, highlightedIndex, actions: {
      preventDefault: () => event.preventDefault(), moveHighlight, setHighlightedIndex, selectOption,
    } });
  }

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
