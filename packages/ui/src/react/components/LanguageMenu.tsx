import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { Icon } from './Icon.js';

// Shape lives in `features/language/types.ts` (plain data, shared with the
// settings Language tab); re-exported so existing importers of this module
// still find it.
import type { LocaleOption } from '../../features/language/types.js';
export type { LocaleOption } from '../../features/language/types.js';

export interface LanguageMenuProps {
  /** Supported locales and their display labels — host-supplied, not hardcoded. */
  locales: LocaleOption[];
  locale: string;
  onLocaleChange: (locale: string) => void;
  compact?: boolean;
  placement?: 'up' | 'down';
  align?: 'start' | 'end';
  /** Custom hook override for dependency injection / testing. */
  useLanguageMenu?: typeof useLanguageMenu;
}

// ---------------------------------------------------------------------------
// Pure helpers — no React, directly unit-testable.
// ---------------------------------------------------------------------------

/** The label for the active locale, falling back to the raw code when unknown. */
export function resolveActiveLocaleLabel(locales: LocaleOption[], locale: string): string {
  return locales.find((l) => l.code === locale)?.label ?? locale;
}

/** The single key that dismisses the menu. */
export function isLanguageMenuDismissKey(key: string): boolean {
  return key === 'Escape';
}

/**
 * Whether a pointer event landed outside the menu (and should therefore close
 * it). A missing container never counts as "outside" — matching the original
 * `if (!wrapRef.current) return;` guard, which took no action without a node.
 */
export function isOutsideLanguageMenu(
  container: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  if (!container) return false;
  return !container.contains(target as Node | null);
}

export function languageMenuPillClassName(compact: boolean): string {
  return `foot-pill lang-pill${compact ? ' lang-pill--compact' : ''}`;
}

export function languageMenuPopoverClassName(
  placement: 'up' | 'down',
  compact: boolean,
  align: 'start' | 'end',
): string {
  return `lang-menu-popover lang-menu-popover--${placement}${
    compact ? ' lang-menu-popover--compact' : ''
  } lang-menu-popover--align-${align}`;
}

export function languageMenuItemClassName(active: boolean): string {
  return `lang-menu-item${active ? ' active' : ''}`;
}

// ---------------------------------------------------------------------------
// Hooks — every stateful/effectful seam, exported for isolated testing.
// ---------------------------------------------------------------------------

export interface LanguageMenuDisclosure {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

/** Open/close state for the popover with stable toggle/close callbacks. */
export function useLanguageMenuDisclosure(): LanguageMenuDisclosure {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close };
}

/** Memoized active-locale label derived from the (host-supplied) locale list. */
export function useActiveLocaleLabel(locales: LocaleOption[], locale: string): string {
  return useMemo(() => resolveActiveLocaleLabel(locales, locale), [locales, locale]);
}

/**
 * While `open`, closes the menu on an outside `mousedown` or an Escape keydown.
 * Listeners are only attached while open and torn down on close/unmount.
 */
export function useLanguageMenuDismiss(params: {
  open: boolean;
  onDismiss: () => void;
  containerRef: MutableRefObject<HTMLElement | null>;
}): void {
  const { open, onDismiss, containerRef } = params;
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (isOutsideLanguageMenu(containerRef.current, event.target)) onDismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (isLanguageMenuDismissKey(event.key)) onDismiss();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onDismiss, containerRef]);
}

export interface UseLanguageMenuResult {
  open: boolean;
  toggle: () => void;
  close: () => void;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  activeLabel: string;
}

/**
 * Composes the menu's whole behavior — disclosure, the active-locale label, and
 * the outside/Escape dismissal — behind one hook so {@link LanguageMenu} is a
 * dumb render.
 */
export function useLanguageMenu(locales: LocaleOption[], locale: string): UseLanguageMenuResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { open, toggle, close } = useLanguageMenuDisclosure();
  const activeLabel = useActiveLocaleLabel(locales, locale);
  useLanguageMenuDismiss({ open, onDismiss: close, containerRef });
  return { open, toggle, close, containerRef, activeLabel };
}

// ---------------------------------------------------------------------------
// Component — dumb render, all logic delegated above.
// ---------------------------------------------------------------------------

/**
 * Compact language switcher rendered as a small pill that expands into a
 * popover menu. Locale list/labels and the active locale are entirely
 * host-supplied — this component owns only the open/close and keyboard/
 * click-outside behavior. Animation is CSS-driven via the `open`/`closing`
 * classes on the popover; the host supplies the actual transition.
 */
export function LanguageMenu({
  locales,
  locale,
  onLocaleChange,
  compact = false,
  placement = 'up',
  align = 'start',
  useLanguageMenu: useLanguageMenuHook = useLanguageMenu,
}: LanguageMenuProps) {
  const { open, toggle, close, containerRef, activeLabel } = useLanguageMenuHook(locales, locale);

  return (
    <div className="lang-menu-wrap" ref={containerRef}>
      <button
        type="button"
        className={languageMenuPillClassName(compact)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? activeLabel : undefined}
        onClick={toggle}
        title={activeLabel}
      >
        <Icon name="languages" size={compact ? 20 : 12} />
        {compact ? null : (
          <>
            <span>{activeLabel}</span>
            <Icon name="chevron-down" size={11} />
          </>
        )}
      </button>
      {open ? (
        <div className={languageMenuPopoverClassName(placement, compact, align)} role="menu">
          {locales.map(({ code, label }) => {
            const active = locale === code;
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={languageMenuItemClassName(active)}
                onClick={() => {
                  onLocaleChange(code);
                  close();
                }}
              >
                <span className="lang-menu-label">{label}</span>
                <span className="lang-menu-code">{code}</span>
                {active ? (
                  <span className="lang-menu-check" aria-hidden>
                    <Icon name="check" size={12} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
