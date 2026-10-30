/**
 * Mechanics for the composer bar's small model / reasoning-effort menus ("drop-ups"): open/close,
 * outside-click and Escape dismissal, a viewport-fixed position anchored ABOVE the trigger, focus
 * on open and back to the trigger on close, and arrow-key roving between the items.
 *
 * Same idiom as `useAgentRuntimePicker` (whose pure `resolveRovingIndex` this reuses), minus what a
 * flat list of choices does not need: no portal (the menu renders inline, so it inherits the
 * host's `data-theme` and the pane's scoped CSS; `position: fixed` still escapes the dock's
 * `overflow: hidden`, as `composerDiscoveryMenuPosition` documents) and no Tab trap (Tab simply
 * closes the menu and lets focus move on).
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';

import { resolveRovingIndex } from './useAgentRuntimePicker.hooks.js';

const MENU_ITEMS = '[role="menuitemradio"]';

/**
 * Viewport-fixed geometry for a drop-up: right-aligned with the trigger, clamped into the
 * viewport and (when given) into `bounds`, bottom edge just above it, and never taller than the
 * space above. Right-aligned because the model/effort cluster sits at the composer bar's trailing
 * edge, so the menu grows back into the pane instead of past the dock's right edge; `bounds` (the
 * composer box) keeps a menu wider than the room left of the trigger from spilling out of a narrow
 * dock onto the page beside it.
 *
 * @complexity Time/space: O(1).
 */
export function runtimeDropUpPosition(
  { trigger, width }: { trigger: DOMRect; width: number },
  { bounds }: { bounds?: Pick<DOMRect, 'left' | 'right'> } = {},
): CSSProperties {
  const margin = 12;
  const gap = 6;
  const minLeft = Math.max(margin, bounds?.left ?? -Infinity);
  const maxRight = Math.min(window.innerWidth - margin, bounds?.right ?? Infinity);
  const menuWidth = Math.max(0, Math.min(width, maxRight - minLeft));
  return {
    position: 'fixed',
    left: Math.min(Math.max(trigger.right - menuWidth, minLeft), maxRight - menuWidth),
    bottom: Math.max(margin, window.innerHeight - trigger.top + gap),
    width: menuWidth,
    maxHeight: Math.min(320, Math.max(0, trigger.top - gap - margin)),
    overflowY: 'auto',
    zIndex: 1000,
  };
}

export interface UseRuntimeDropUpResult {
  menuId: string;
  open: boolean;
  /** Undefined until the trigger has been measured; the menu does not render before then. */
  position: CSSProperties | undefined;
  triggerRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  toggleOpen: () => void;
  /** ArrowUp/ArrowDown on the closed trigger opens the menu, like a native select. */
  handleTriggerKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  handleMenuKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Runs the selection, closes, and returns focus to the trigger. */
  choose: (apply: () => void) => void;
}

/**
 * @complexity Time: O(1) per render; key handling is O(n) in the menu's item count.
 */
export function useRuntimeDropUp({ width }: { width: number }): UseRuntimeDropUpResult {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeToTrigger = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      // No focus restore: the pointer is already going somewhere else.
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeToTrigger();
    };
    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [closeToTrigger, open]);

  useEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      const bounds = triggerRef.current?.closest('.jini-composer')?.getBoundingClientRect();
      if (rect) setPosition(runtimeDropUpPosition({ trigger: rect, width }, bounds ? { bounds } : {}));
    };
    update();
    window.addEventListener('resize', update);
    // Capture phase: a scroll inside any ancestor moves the trigger too, and scroll does not bubble.
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, width]);

  useEffect(() => {
    if (!open || !position) return;
    const menu = menuRef.current;
    const checked = menu?.querySelector<HTMLElement>(`${MENU_ITEMS}[aria-checked="true"]`);
    (checked ?? menu?.querySelector<HTMLElement>(MENU_ITEMS))?.focus();
  }, [open, position]);

  const handleTriggerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    setOpen(true);
  }, [open]);

  const handleMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    // Only reachable via the element `menuRef` is attached to, so the ref is set by now; and the
    // menu is never rendered without items (the caller omits a drop-up that has no choices).
    const items = [...menuRef.current!.querySelectorAll<HTMLElement>(MENU_ITEMS)];
    const next = resolveRovingIndex({
      key: event.key,
      currentIndex: items.indexOf(document.activeElement as HTMLElement),
      count: items.length,
    });
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }, []);

  const choose = useCallback((apply: () => void) => {
    apply();
    closeToTrigger();
  }, [closeToTrigger]);

  return {
    menuId,
    open,
    position,
    triggerRef,
    menuRef,
    toggleOpen,
    handleTriggerKeyDown,
    handleMenuKeyDown,
    choose,
  };
}
