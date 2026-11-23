import type { PanelPosition, WidgetSelectOption as SelectOption } from "../../../react/kit.js";


// Live state/effects and their rationale: Jini/packages/ui/src/features/admin-widgets/components/Select/Select.hooks.tsx.
// No dropdown hook lives here: hosts inject the two-object `useSelectDropdown({ value, onChange,
// options }, { disabled })` straight into the Select, with no single-object pass-through between.

// Retain existing public helpers until Jini exports them from its public admin-widgets barrel.
// Their host contracts are used by direct DOM tests; no live state/effect is copied.
/** Rough placement heuristic, not a hard limit — the panel still carries its own `max-height` +
 * `overflow-y` (the host's select stylesheet); this only decides which side of the trigger to open toward,
 * so a trigger sitting near the bottom of the viewport doesn't open a panel that's mostly
 * off-screen. */
const ESTIMATED_PANEL_HEIGHT = 280;

/** Everything Tab could legitimately land on, in real DOM order. Used only to find the trigger's
 * own DOM-order neighbour (see `handlePanelKeyDown`'s `"Tab"` case) — the floating panel is
 * portaled to the end of `document.body` (the host's select stylesheet's header explains why), which would
 * otherwise put it last in document order and send a real Tab keypress to the browser chrome
 * instead of whatever naturally follows the trigger on screen. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableInDomOrder({ exclude }: { exclude: HTMLElement | null }, _options: Record<string, never> = {}): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !exclude || !exclude.contains(el)
  );
}

/** `position: fixed` coordinates measured off the trigger's live `getBoundingClientRect()` —
 * viewport-relative, so the panel escapes any scrolling/overflow-hidden ancestor (see
 * the host's select stylesheet) without needing to know anything about that ancestor. Opens upward when
 * there isn't `ESTIMATED_PANEL_HEIGHT` of room below AND there's more room above than below;
 * either way the returned `maxHeight` is the ACTUAL remaining space in that direction, not the
 * estimate, so the panel's own scroll (not the viewport edge) is what ever clips it. */
export function computePosition({ trigger }: { trigger: HTMLElement }, _options: Record<string, never> = {}): PanelPosition {
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

/** Builds a listbox option's DOM `id`, shared between the `<li>` itself and the trigger's
 * `aria-activedescendant`, so both elements use the same id scheme. */
export function buildOptionId({ listboxId, index }: { listboxId: string; index: number }, _options: Record<string, never> = {}): string {
  return `${listboxId}-option-${index}`;
}

/**
 * The scroll/resize repositioning decision accepts the trigger and callbacks explicitly so it
 * can be exercised without mounting the dropdown.
 *
 * A native `<select>`'s OS popup does not survive its trigger leaving view; this closes the panel
 * instead of chasing a trigger nobody can see, the same idea. `elementFromPoint` at the trigger's
 * own center is the generic obscured-by-something check (works for any clipping ancestor, not just
 * one dialog's own `overflow-y`) — it asks "is my trigger actually the thing rendered at its own
 * center point", which is false once a clipping ancestor (or the viewport edge) has hidden it.
 * Guarded, not assumed available: some environments (older WebViews, this app's own jsdom test
 * harness) don't implement `elementFromPoint` at all — where it doesn't, this degrades to the
 * viewport-edge check alone rather than throwing.
 */
export function repositionOrClose({ trigger, onOutOfView, setPosition }: { trigger: HTMLElement; onOutOfView: () => void; setPosition: (position: PanelPosition) => void }, _options: Record<string, never> = {}) {
  const rect = trigger.getBoundingClientRect();
  const outOfViewport = rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth;
  if (outOfViewport) {
    onOutOfView();
    return;
  }
  if (isObscuredAtCenter({ trigger, rect })) {
    onOutOfView();
    return;
  }
  setPosition(computePosition({ trigger }));
}

/** True when something other than the trigger (or an ancestor/descendant of it) is rendered at the
 * trigger's center. Where `elementFromPoint` is not implemented this answers false, so the caller
 * falls back to the viewport-edge check alone. */
function isObscuredAtCenter({ trigger, rect }: { trigger: HTMLElement; rect: DOMRect }, _options: Record<string, never> = {}): boolean {
  if (typeof document.elementFromPoint !== "function") return false;
  const topmostAtCenter = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return !topmostAtCenter || !(trigger.contains(topmostAtCenter) || topmostAtCenter.contains(trigger));
}

/** Resolves Tab's DOM-order neighbour of the trigger. Returns
 *  `null` when the trigger can't be found among the focusable nodes (disabled mid-session — see
 *  `Select.unit.test.tsx`'s "Tab closes the panel without moving focus..." regression), which the
 *  caller reads as "don't move focus, just close." */
export function resolveTabTarget(
  { panel, trigger, shiftKey }: { panel: HTMLElement | null; trigger: HTMLElement | null; shiftKey: boolean },
  _options: Record<string, never> = {},
): HTMLElement | null {
  const nodes = focusableInDomOrder({ exclude: panel });
  const triggerIndex = trigger ? nodes.indexOf(trigger) : -1;
  if (triggerIndex < 0) return null;
  return nodes[triggerIndex + (shiftKey ? -1 : 1)] ?? null;
}

/** Home/End's highlight target within `filtered` — the first or last index, or `-1` when the list
 *  is empty (nothing to highlight). */
export function edgeHighlightIndex({ filteredLength, edge }: { filteredLength: number; edge: "first" | "last" }, _options: Record<string, never> = {}): number {
  if (filteredLength === 0) return -1;
  return edge === "first" ? 0 : filteredLength - 1;
}

/** The option Enter should select — the currently-highlighted row, or `null` when nothing valid is
 *  highlighted (highlight reset to `-1`, or stale after `filtered` shrank out from under it, e.g. a
 *  search query narrowing the list). */
export function highlightedOptionOrNull({ filtered, highlightedIndex }: { filtered: SelectOption[]; highlightedIndex: number }, _options: Record<string, never> = {}): SelectOption | null {
  return highlightedIndex >= 0 ? (filtered[highlightedIndex] ?? null) : null;
}

/**
 * The five highlight-navigation/selection keys — `ArrowDown`/`ArrowUp`/`Home`/`End`/`Enter`.
 * `handlePanelKeyDown`'s `"Escape"` and `"Tab"` cases deliberately stay in the handler itself
 * instead of coming here too: both do something that has to run against the live event/DOM
 * (`stopPropagation()`; `resolveTabTarget` + `.focus()`) rather than a plain calculation, the same
 * separation between DOM effects and highlight decisions.
 *
 * `preventDefault` is injected as a callback rather than left to the caller based on this
 * function's return value, so every case calls `preventDefault()` immediately before the state
 * change it goes with, not
 * after. A boolean-return design can't do that: `Enter` needs `preventDefault()` unconditionally
 * regardless of whether `highlightedOptionOrNull` finds a row to select, so the caller would have to
 * call it *after* resolving the action, reordering that case relative to the other four.
 *
 * Returns whether the key was recognized (`false` for an unhandled key). The return value makes
 * "did this
 * key do anything" directly assertable instead of only inferable from which spy fired.
 */
export function applyHighlightKey(
  { key, filtered, highlightedIndex, actions }: {
    key: string;
    filtered: SelectOption[];
    highlightedIndex: number;
    actions: {
      preventDefault: () => void;
      moveHighlight: (delta: 1 | -1) => void;
      setHighlightedIndex: (index: number) => void;
      selectOption: (option: SelectOption) => void;
    };
  },
  _options: Record<string, never> = {},
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
      const option = highlightedOptionOrNull({ filtered, highlightedIndex });
      if (option) actions.selectOption(option);
      return true;
    }
    default:
      return false;
  }
}
