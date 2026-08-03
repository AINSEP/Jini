import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { resolveTone, toneClassName, type ConfirmTone } from './confirm-tone.js';

/**
 * @file Three-dot overflow menu for table rows — replaces the "one visible button per row" pattern
 * so a row can grow more actions (Edit, Disable, Delete, …) without widening the table or producing
 * the wall of buttons that pattern turns into.
 *
 * Portaled to `document.body` and positioned with `getBoundingClientRect()` rather than rendered as
 * an in-flow absolutely-positioned child of the trigger — a list table normally sits inside a
 * horizontal scroller (`overflow-x: auto`, which is exactly what `DataTable`'s `.table-scroll`
 * wrapper is for), and per the CSS overflow spec, setting either axis to a non-`visible` value
 * forces the *other* axis to compute as `auto` as well, so a menu positioned to escape the table's
 * own box would be silently clipped by that same scroller. Verified live via `getComputedStyle`:
 * setting `overflow-x: visible` alongside `overflow-y: auto` still reads back as `overflow-x: auto`.
 * The fix is to leave the subtree entirely — a DOM sibling of the app root, not a descendant of the
 * clipping element.
 *
 * Unstyled: `.row-menu-trigger`, `.row-menu-popup`, `.row-menu-popup-above`, and `.row-menu-item`
 * are emitted for the host stylesheet to define. Only the positioning that has to be measured at
 * runtime is set inline.
 */

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** Visual tone — `"warning"` for reversible-but-access-affecting actions (e.g. Disable),
   *  `"danger"` for genuinely destructive ones (e.g. Delete). Defaults to `"default"` (neutral).
   *  Shares `ConfirmDialog`'s three-tier vocabulary on purpose — a caller wiring up "Disable opens
   *  nothing, Delete opens a ConfirmDialog" from the same item list should not have to reconcile
   *  two different tone enums to keep the colors matching. Wins over `destructive` below when both
   *  are passed. */
  tone?: ConfirmTone;
  /** @deprecated Use `tone: "danger"` instead — this only ever expressed the danger tier, and the
   *  vocabulary has a second one (`"warning"`) this boolean cannot reach. Kept working (mapped to
   *  `tone: "danger"` when `tone` is not set) for existing callers rather than a breaking rename. */
  destructive?: boolean;
}

export interface RowMenuProps {
  items: RowMenuItem[];
  /** Full accessible name for the trigger, e.g. `Actions for "My Post"` — the row's own title
   *  doesn't disambiguate a bare "⋯" for a screen-reader user navigating control-by-control rather
   *  than row-by-row, same reasoning as `ConfirmButton.ariaLabel`. */
  triggerLabel: string;
}

interface Position {
  top: number;
  left: number;
  placement: 'below' | 'above';
}

/** 8px clearance kept between the menu and the viewport edge on every side it's tested against. */
const VIEWPORT_MARGIN = 8;

/**
 * Where the popup goes, given the trigger's viewport rect and the popup's own measured size.
 *
 * Placement flips above the trigger only when the menu genuinely does not fit below *and* there is
 * room above — a menu taller than the space on either side stays `'below'`, since a flipped one
 * would run off the top instead, which is the worse of the two overflows (the trigger itself
 * scrolls out of reach).
 *
 * Pure, and deliberately outside the component: it reads `window` but touches no ref or state, so
 * the above-vs-below decision and the horizontal clamp can be reasoned about on their own.
 */
function popupPosition(rect: DOMRect, menuWidth: number, menuHeight: number): Position {
  const spaceBelow = window.innerHeight - rect.bottom;
  const fitsBelow = spaceBelow >= menuHeight + VIEWPORT_MARGIN;
  const placement: Position['placement'] =
    fitsBelow || rect.top < menuHeight + VIEWPORT_MARGIN ? 'below' : 'above';
  // Right-aligned to the trigger by default (the trigger is the table's last column), clamped so it
  // never overflows the viewport's left or right edge.
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.right - menuWidth),
    window.innerWidth - menuWidth - VIEWPORT_MARGIN,
  );
  return {
    top: placement === 'below' ? rect.bottom + 4 : rect.top - 4,
    left,
    placement,
  };
}

/**
 * Roving-focus target for a navigation key, or `null` when `key` is not one — which is what tells
 * the handler to leave the event alone rather than swallow it with `preventDefault()`.
 *
 * Both arrow directions wrap (`+ count` before the modulo keeps `ArrowUp` off index `-1`), matching
 * the menu pattern's expected behavior of cycling rather than stopping at the ends.
 */
function nextActiveIndex(key: string, current: number, count: number): number | null {
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Inline style for the popup box. Only the runtime-measured values belong here — everything else is
 * the host stylesheet's `.row-menu-popup`.
 *
 * Before the first measurement lands, the menu is parked off-screen and `visibility: hidden` rather
 * than left unmounted: it has to be laid out for `offsetWidth`/`offsetHeight` to be readable at all,
 * and hiding it this way keeps it measurable without a visible flash at the wrong coordinates.
 */
function popupStyle(position: Position | null): CSSProperties {
  if (!position) return { position: 'fixed', top: -9999, left: -9999, visibility: 'hidden' };
  return {
    position: 'fixed',
    top: position.top,
    left: position.left,
    visibility: 'visible',
    transform: position.placement === 'above' ? 'translateY(-100%)' : undefined,
  };
}

/**
 * The popup's live viewport position while `open`, or `null` when it is closed or not yet measured.
 *
 * Measured in a LAYOUT effect, after the (initially off-screen, `visibility: hidden`) menu has
 * actually laid out, so `menuRef.current`'s real dimensions are known before deciding
 * above-vs-below — a plain `useEffect` would run one paint too late and produce a visible jump.
 * Recomputed on scroll and resize too: a portaled menu is a DOM sibling of its anchor, not a child,
 * so it does not track the anchor's position on its own the way an in-flow popup would.
 *
 * Returning to `null` on close is what makes the next open re-measure from scratch rather than
 * paint one frame at the previous row's coordinates.
 */
function useAnchoredPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
): Position | null {
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setPosition(
        popupPosition(
          trigger.getBoundingClientRect(),
          menuRef.current?.offsetWidth ?? 0,
          menuRef.current?.offsetHeight ?? 0,
        ),
      );
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, triggerRef, menuRef]);

  return position;
}

export function RowMenu(props: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  itemRefs.current = itemRefs.current.slice(0, props.items.length);
  const position = useAnchoredPosition(open, triggerRef, menuRef);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  // Click-outside closes. Scoped to the open window only, same lifecycle discipline as
  // `ConfirmButton`'s armed-only document listeners — a closed, idle `RowMenu` costs nothing beyond
  // its trigger button even with many mounted per table.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: globalThis.MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keeps real DOM focus on the active item (roving focus via `tabIndex={-1}` on every item except
  // the active one) rather than only tracking `activeIndex` in state — arrow-key navigation needs
  // to move the browser's actual focus for a screen reader to announce it.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openAt(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt(props.items.length - 1);
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      // Leaving via Tab closes the menu but does not steal focus back to the trigger — the
      // browser's own tab order continues from wherever it lands, matching native menu behavior
      // (and unlike Escape, which is an explicit "back out" gesture).
      close(false);
      return;
    }
    const next = nextActiveIndex(e.key, activeIndex, props.items.length);
    if (next === null) return;
    e.preventDefault();
    setActiveIndex(next);
  }

  function selectItem(item: RowMenuItem) {
    close(true);
    item.onSelect();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="row-menu-trigger"
        aria-label={props.triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onTriggerKeyDown}
      >
        {/* Three vertical dots — the conventional overflow/"kebab" affordance. Filled circles
            rather than the stroked outlines this glyph is often drawn with: at its actual rendered
            size (16px, scaled down from this 18-unit viewBox), a thin stroked ring goes muddy where
            a filled dot stays crisp. Always
            paired with the real accessible name (`aria-label` on the `<button>` above, from
            `triggerLabel`) rather than shipped as a bare unlabeled icon — this glyph itself is
            `aria-hidden`, a screen reader never reaches it. */}
        <svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="4.5" r="1.5" />
          <circle cx="9" cy="9" r="1.5" />
          <circle cx="9" cy="13.5" r="1.5" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={props.triggerLabel}
              className={`row-menu-popup${position?.placement === 'above' ? ' row-menu-popup-above' : ''}`}
              style={popupStyle(position)}
              onKeyDown={onMenuKeyDown}
            >
              {props.items.map((item, index) => {
                const toneClass = toneClassName(resolveTone(item));
                return (
                  <button
                    key={item.key}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={['row-menu-item', toneClass].filter(Boolean).join(' ')}
                    onClick={() => selectItem(item)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
