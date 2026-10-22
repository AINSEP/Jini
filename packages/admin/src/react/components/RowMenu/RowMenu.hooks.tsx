import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

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

type RowMenuWindow = Pick<Window, 'innerHeight' | 'innerWidth' | 'addEventListener' | 'removeEventListener'>;
type RowMenuDocument = Pick<Document, 'addEventListener' | 'removeEventListener'>;

/** What `useRowMenu` hands `RowMenu` — and the shape an injected `useRowMenu` fake must return. */
export interface RowMenuState {
  readonly open: boolean;
  readonly position: Position | null;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  /** A callback ref from the real hook (see {@link trackOpenMenu}; `null` while closed), or a host
   *  hook's ref object. Spelled out rather than React's `Ref`, whose callback form carries a brand
   *  that fails to match across two installed `@types/react` copies (Jini's vs a host app's). */
  readonly menuRef: RefObject<HTMLDivElement | null> | ((menu: HTMLDivElement | null) => void) | null;
  readonly itemRefs: RefObject<Array<HTMLButtonElement | null>>;
  readonly onTriggerClick: () => void;
  readonly onTriggerKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly selectItem: (item: { readonly onSelect: () => void }) => void;
}

/**
 * Starts the listeners one open menu needs and returns the matching stop. Called from the menu's
 * callback ref, so both elements are in hand: `trigger` is the button the menu opened from and
 * `menu` is the just-attached popup — neither is ever null here.
 *
 * Positioning runs immediately, at ref-attach time in the commit, i.e. after the (initially
 * off-screen, `visibility: hidden`) menu has actually laid out, so its real dimensions are known
 * before deciding above-vs-below — a plain `useEffect` would run one paint too late and produce a
 * visible jump. Recomputed on scroll and resize too: a portaled menu is a DOM sibling of its anchor,
 * not a child, so it does not track the anchor's position on its own the way an in-flow popup would.
 *
 * Click-outside and Escape close. Escape is document-scoped so it also works after focus
 * moves away from the popup. Scoped to the open window only, same lifecycle discipline as
 * `ConfirmButton`'s armed-only document listeners — a closed, idle `RowMenu` costs nothing beyond
 * its trigger button even with many mounted per table.
 *
 * @complexity O(1) per call and per scroll/resize/mousedown event.
 */
function trackOpenMenu(
  { trigger, menu }: { readonly trigger: HTMLElement; readonly menu: HTMLElement },
  { window, document, onPosition, onDismiss, onEscape }: {
    readonly window: RowMenuWindow;
    readonly document: RowMenuDocument;
    readonly onPosition: (position: Position) => void;
    readonly onDismiss: () => void;
    readonly onEscape: () => void;
  },
): () => void {
  function reposition() {
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const menuWidth = menu.offsetWidth;
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
    onPosition({
      top: placement === 'below' ? rect.bottom + 4 : rect.top - 4,
      left,
      placement,
    });
  }
  function onDocMouseDown(e: globalThis.MouseEvent) {
    const target = e.target as Node;
    if (menu.contains(target) || trigger.contains(target)) return;
    onDismiss();
  }
  function onDocKeyDown(e: globalThis.KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    onEscape();
  }
  reposition();
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  document.addEventListener('mousedown', onDocMouseDown);
  document.addEventListener('keydown', onDocKeyDown);
  return () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('keydown', onDocKeyDown);
  };
}

/**
 * Owns `RowMenu`'s open/close state, positioning, and keyboard/focus behavior.
 *
 * @param itemCount Length of the caller's item list — the only piece of `RowMenuProps` this state
 *   needs, for `ArrowUp`-to-last-item and wraparound navigation.
 */
export function useRowMenu(
  { itemCount, window, document }: { readonly itemCount: number; readonly window: RowMenuWindow; readonly document: RowMenuDocument },
): RowMenuState {
  // The trigger the menu is open against; `null` while closed. Held as state (not just a boolean)
  // so the menu's callback ref below is built with the element already in hand. Read from
  // `triggerRef` at open time: an unattached trigger leaves this `null`, so a menu with nothing to
  // anchor to never opens.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const open = anchor !== null;
  const [position, setPosition] = useState<Position | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  itemRefs.current = itemRefs.current.slice(0, itemCount);

  function close(returnFocus: boolean) {
    setAnchor(null);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  }

  function openAt(index: number) {
    setActiveIndex(index);
    setAnchor(triggerRef.current);
  }

  // Only the open menu renders this ref, so it only exists once there is an anchor. React calls it
  // with the menu element on attach and `null` on detach (React 18 and 19 alike; attach always comes
  // first, so `stop` is set by then). A new anchor or new `window`/`document` ports make a new ref,
  // which React detaches and re-attaches — the same re-subscribe an effect's deps would give.
  const menuRef = useMemo(() => {
    if (!anchor) return null;
    let stop: () => void;
    return (menu: HTMLDivElement | null) => {
      if (menu) stop = trackOpenMenu({ trigger: anchor, menu }, { window, document, onPosition: setPosition, onDismiss: () => close(false), onEscape: () => close(true) });
      else stop();
    };
    // `close` only touches state setters and `triggerRef`, all stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, window, document]);

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
        e.stopPropagation();
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
  function selectItem({ onSelect }: { readonly onSelect: () => void }) {
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
