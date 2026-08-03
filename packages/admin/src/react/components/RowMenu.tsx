import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { resolveTone, toneClassName, type ConfirmTone } from '../types.js';

/**
 * @file Three-dot overflow menu for table rows — replaces the "one visible button per row" pattern
 * so a row can grow more actions (Edit, Disable, Delete, …) without widening the table or producing
 * the wall of buttons that pattern turns into.
 *
 * Portaled to `document.body` and positioned with `getBoundingClientRect()` rather than rendered as
 * an in-flow absolutely-positioned child of the trigger — an admin table normally sits inside a
 * horizontal scroller (`overflow-x: auto`), and per the CSS overflow spec, setting either axis to a
 * non-`visible` value forces the *other* axis to compute as `auto` as well, so a menu positioned to
 * escape the table's own box would be silently clipped by that same scroller. This is the identical
 * problem `Sidebar.tsx`'s `RailTooltip` solves for `.cms-nav`'s `overflow-y: auto` (see that
 * component's doc comment, where it was verified live via `getComputedStyle`) — same fix here: a
 * DOM sibling of the app root, not a descendant of the clipping element.
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

export function RowMenu(props: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  itemRefs.current = itemRefs.current.slice(0, props.items.length);

  function close(returnFocus: boolean) {
    setOpen(false);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  }

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  // Measured after the (initially off-screen, `visibility: hidden`) menu has actually laid out, so
  // `menuRef.current`'s real dimensions are known before deciding above-vs-below — a plain
  // `useEffect` would run one paint too late and produce a visible jump. Recomputed on scroll and
  // resize too: a portaled menu is a DOM sibling of its anchor, not a child, so it does not track
  // the anchor's position on its own the way an in-flow popup would.
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight ?? 0;
      const menuWidth = menuRef.current?.offsetWidth ?? 0;
      const spaceBelow = window.innerHeight - rect.bottom;
      const fitsBelow = spaceBelow >= menuHeight + VIEWPORT_MARGIN;
      const placement: Position['placement'] =
        fitsBelow || rect.top < menuHeight + VIEWPORT_MARGIN ? 'below' : 'above';
      // Right-aligned to the trigger by default (the trigger is the table's last column), clamped
      // so it never overflows the viewport's left or right edge.
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, rect.right - menuWidth),
        window.innerWidth - menuWidth - VIEWPORT_MARGIN,
      );
      setPosition({
        top: placement === 'below' ? rect.bottom + 4 : rect.top - 4,
        left,
        placement,
      });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

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
    const count = props.items.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + count) % count);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(count - 1);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        // Leaving via Tab closes the menu but does not steal focus back to the trigger — the
        // browser's own tab order continues from wherever it lands, matching native menu behavior
        // (and unlike Escape, which is an explicit "back out" gesture).
        close(false);
        break;
      default:
        break;
    }
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
        {/* Three vertical dots — the conventional overflow/"kebab" affordance. Filled circles, not
            stroked outlines, unlike this package's other icons (`Sidebar.tsx`'s stroke-based rail-
            toggle chevrons): at this glyph's actual rendered size (16px, scaled down from this
            18-unit viewBox), a thin stroked ring goes muddy where a filled dot stays crisp. Always
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
              style={{
                position: 'fixed',
                top: position ? position.top : -9999,
                left: position ? position.left : -9999,
                // Laid out but invisible until the first `reposition()` measurement lands (see the
                // layout effect above) — keeps `offsetHeight`/`offsetWidth` measurable without a
                // visible flash at the wrong coordinates.
                visibility: position ? 'visible' : 'hidden',
                transform: position?.placement === 'above' ? 'translateY(-100%)' : undefined,
              }}
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
