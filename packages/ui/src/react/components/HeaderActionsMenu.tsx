// HeaderActionsMenu — a compact "More" overflow menu for a sticky/compact
// header: a single trigger button that opens a grouped popover of actions
// (divided into visually-separated groups, empty groups skipped). Closes on
// outside click or Escape.

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import { Icon, type IconName } from './Icon.js';

export interface HeaderMenuAction {
  id: string;
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Toggles render with checkbox semantics + a trailing check when active. */
  active?: boolean;
}

export interface HeaderActionsMenuProps {
  /** Each inner array renders as one visually-divided group; empty groups are skipped. */
  groups: HeaderMenuAction[][];
  /** Accessible label for the trigger button and the popover menu. */
  label: string;
  /** Custom hook override for dependency injection / testing. */
  useHeaderActionsMenu?: typeof useHeaderActionsMenu;
}

// ---------------------------------------------------------------------------
// Pure helpers — no React, directly unit-testable.
// ---------------------------------------------------------------------------

/** Drops empty groups so only groups with at least one action render. */
export function filterVisibleActionGroups(groups: HeaderMenuAction[][]): HeaderMenuAction[][] {
  return groups.filter((group) => group.length > 0);
}

/** The single key that dismisses the menu. */
export function isHeaderMenuDismissKey(key: string): boolean {
  return key === 'Escape';
}

/**
 * Whether a pointer event landed outside the menu (and should therefore close
 * it). A missing container never counts as "outside".
 */
export function isOutsideHeaderMenu(
  container: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  if (!container) return false;
  return !container.contains(target as Node | null);
}

/** ARIA role: plain menuitem, or checkbox semantics when the item is a toggle. */
export function headerMenuItemRole(active: boolean | undefined): 'menuitem' | 'menuitemcheckbox' {
  return active === undefined ? 'menuitem' : 'menuitemcheckbox';
}

/** `aria-checked` value: only meaningful (and only set) for toggle items. */
export function headerMenuItemAriaChecked(active: boolean | undefined): boolean | undefined {
  return active === undefined ? undefined : active;
}

/** The icon to render — the spinner while loading, otherwise the item's icon. */
export function headerMenuItemIcon(item: HeaderMenuAction): IconName {
  return item.loading ? 'spinner' : item.icon;
}

/** Disabled while explicitly disabled or loading. */
export function headerMenuItemDisabled(item: HeaderMenuAction): boolean {
  return Boolean(item.disabled || item.loading);
}

/** `aria-busy` value: `true` while loading, otherwise unset. */
export function headerMenuItemBusy(item: HeaderMenuAction): true | undefined {
  return item.loading || undefined;
}

// ---------------------------------------------------------------------------
// Hooks — every stateful/effectful seam, exported for isolated testing.
// ---------------------------------------------------------------------------

export interface HeaderActionsMenuDisclosure {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

/** Open/close state for the popover with stable toggle/close callbacks. */
export function useHeaderActionsMenuDisclosure(): HeaderActionsMenuDisclosure {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close };
}

/** Memoized list of non-empty groups. */
export function useVisibleActionGroups(groups: HeaderMenuAction[][]): HeaderMenuAction[][] {
  return useMemo(() => filterVisibleActionGroups(groups), [groups]);
}

/**
 * While `open`, closes the menu on an outside `mousedown` or an Escape keydown.
 * Listeners are only attached while open and torn down on close/unmount.
 */
export function useHeaderActionsMenuDismiss(params: {
  open: boolean;
  onDismiss: () => void;
  containerRef: MutableRefObject<HTMLElement | null>;
}): void {
  const { open, onDismiss, containerRef } = params;
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (isOutsideHeaderMenu(containerRef.current, event.target)) onDismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (isHeaderMenuDismissKey(event.key)) onDismiss();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onDismiss, containerRef]);
}

export interface UseHeaderActionsMenuResult {
  open: boolean;
  toggle: () => void;
  close: () => void;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  visibleGroups: HeaderMenuAction[][];
}

/**
 * Composes the menu's whole behavior — disclosure, the visible-group filter,
 * and the outside/Escape dismissal — so {@link HeaderActionsMenu} is a dumb
 * render.
 */
export function useHeaderActionsMenu(groups: HeaderMenuAction[][]): UseHeaderActionsMenuResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { open, toggle, close } = useHeaderActionsMenuDisclosure();
  const visibleGroups = useVisibleActionGroups(groups);
  useHeaderActionsMenuDismiss({ open, onDismiss: close, containerRef });
  return { open, toggle, close, containerRef, visibleGroups };
}

// ---------------------------------------------------------------------------
// Component — dumb render, all logic delegated above.
// ---------------------------------------------------------------------------

export function HeaderActionsMenu({
  groups,
  label,
  useHeaderActionsMenu: useHeaderActionsMenuHook = useHeaderActionsMenu,
}: HeaderActionsMenuProps) {
  const { open, toggle, close, containerRef, visibleGroups } = useHeaderActionsMenuHook(groups);

  if (visibleGroups.length === 0) return null;

  return (
    <div className="jini-header-actions-menu" ref={containerRef}>
      <button
        type="button"
        className="jini-header-actions-menu-trigger"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid="header-actions-menu-trigger"
      >
        <Icon name="more-horizontal" size={16} />
      </button>
      {open ? (
        <div className="jini-header-actions-menu-popover" role="menu" aria-label={label}>
          {visibleGroups.map((group, groupIndex) => (
            // `visibleGroups` is `groups.filter((g) => g.length > 0)`, so
            // `group[0]` is always defined here.
            <Fragment key={group[0]!.id}>
              {groupIndex > 0 ? <div className="jini-header-actions-menu-divider" aria-hidden /> : null}
              {group.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role={headerMenuItemRole(item.active)}
                  aria-checked={headerMenuItemAriaChecked(item.active)}
                  className="jini-header-actions-menu-item"
                  disabled={headerMenuItemDisabled(item)}
                  aria-busy={headerMenuItemBusy(item)}
                  onClick={() => {
                    item.onClick();
                    close();
                  }}
                >
                  <span className="jini-header-actions-menu-item-icon" aria-hidden>
                    <Icon name={headerMenuItemIcon(item)} size={15} />
                  </span>
                  <span className="jini-header-actions-menu-item-label">{item.label}</span>
                  {item.active ? (
                    <span className="jini-header-actions-menu-item-check" aria-hidden>
                      <Icon name="check" size={14} />
                    </span>
                  ) : null}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
