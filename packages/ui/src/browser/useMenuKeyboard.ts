import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

/** The document fields used to read and restore menu focus. */
export type DocumentFocus = Pick<Document, 'activeElement' | 'body'>;

/**
 * Which menu entry a key moves focus to, or `null` when the key is not a menu-navigation key.
 * Wraps at both ends, as native menus do. `current` is `-1` when focus is not on an entry yet.
 *
 * @complexity O(1).
 */
export function menuFocusIndex(
  { key, current, count }: { key: string; current: number; count: number }, _optional = {},
): number | null {
  if (count === 0) return null;
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

const MENU_ENTRIES = '[role="menuitem"], [role="menuitemradio"]';

/**
 * The keyboard half of a `role="menu"` dropdown: on open, focus lands on the first entry (the
 * selected one for a radio group is reached with the arrows like any other); Up/Down/Home/End move
 * between entries; and when the menu closes with focus still inside it — an entry was chosen, or
 * Escape — focus goes back to the trigger instead of falling to `<body>`. Escape itself stays
 * the separate dismiss hook's job. A click elsewhere moved focus on purpose, so that is left alone.
 *
 * @param options.doc where the currently focused element is read; `document` by default.
 * @complexity O(n) per key in the number of entries.
 */
export function useMenuKeyboard<T extends HTMLElement = HTMLDivElement, B extends HTMLElement = HTMLButtonElement>(
  { open }: { open: boolean },
  { doc = document }: { doc?: DocumentFocus } = {},
): { menuRef: RefObject<T | null>; triggerRef: RefObject<B | null>; onMenuKeyDown: (event: ReactKeyboardEvent<T>) => void } {
  const menuRef = useRef<T>(null);
  const triggerRef = useRef<B>(null);
  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLElement>(MENU_ENTRIES)?.focus();
    return () => {
      const active = doc.activeElement;
      if (!active || active === doc.body || menuRef.current?.contains(active)) triggerRef.current?.focus();
    };
  }, [open, doc]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<T>) => {
    const entries = [...(menuRef.current?.querySelectorAll<HTMLElement>(MENU_ENTRIES) ?? [])];
    const next = menuFocusIndex({ key: event.key, current: entries.indexOf(doc.activeElement as HTMLElement), count: entries.length });
    if (next === null) return;
    event.preventDefault();
    entries[next]?.focus();
  };

  return { menuRef, triggerRef, onMenuKeyDown };
}

