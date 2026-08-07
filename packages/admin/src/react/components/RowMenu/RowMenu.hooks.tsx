import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * @file `RowMenu`'s open/close state, viewport-aware positioning, and keyboard/focus behavior,
 * split out of the component so it can be swapped for a fake via the `useRowMenu` prop on
 * `RowMenuProps` — see that prop's doc comment in `RowMenu.tsx`.
 */

interface Position {
  top: number;
  left: number;
  placement: 'below' | 'above';
}

/** 8px clearance kept between the menu and the viewport edge on every side it's tested against. */
const VIEWPORT_MARGIN = 8;

/**
 * Owns `RowMenu`'s open/close state, positioning, and keyboard/focus behavior.
 *
 * @param itemCount Length of the caller's item list — the only piece of `RowMenuProps` this state
 *   needs, for `ArrowUp`-to-last-item and wraparound navigation.
 */
export function useRowMenu(itemCount: number) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  itemRefs.current = itemRefs.current.slice(0, itemCount);

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

  function onTriggerClick() {
    if (open) close(false);
    else openAt(0);
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openAt(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt(itemCount - 1);
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % itemCount);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + itemCount) % itemCount);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(itemCount - 1);
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

  /** Closes (returning focus to the trigger, same as Escape) and then fires the selected item's own
   *  callback — takes the callback directly rather than a whole `RowMenuItem` so this hook stays
   *  free of any dependency on that component-level type. */
  function selectItem(onSelect: () => void) {
    close(true);
    onSelect();
  }

  return {
    open,
    position,
    triggerRef,
    menuRef,
    itemRefs,
    onTriggerClick,
    onTriggerKeyDown,
    onMenuKeyDown,
    selectItem,
  };
}
