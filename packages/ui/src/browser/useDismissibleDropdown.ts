/**
 * @file A dropdown menu's open state with click-outside/Escape dismissal, and the handlers of a
 * settings dropdown (a toggle button, a set of choices, a link to a fuller page). Every dropdown in a
 * host's top nav or on a card wanted the same open flag plus "a press outside or Escape closes it";
 * hand-rolled copies of that listener pair are how a menu becomes a menu bug.
 *
 * The listener logic is not reimplemented here: it is {@link useDismissOnOutsideOrEscape} with
 * Escape in the capture phase, so a child that stops a bubbling Escape cannot keep the menu open.
 */
import {
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useDismissOnOutsideOrEscape } from './useDismissOnOutsideOrEscape.js';

/** What {@link useDismissibleDropdown} hands back: the open flag, its setter and the menu's container ref. */
export interface DismissibleDropdown<T extends HTMLElement = HTMLDivElement> {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  /** Attach to the element whose subtree counts as "inside" the dropdown. */
  containerRef: RefObject<T | null>;
}

/**
 * A dropdown's open state plus the "click/tap outside or Escape closes it" behaviour. Listens only
 * while open, and detaches on close and unmount.
 * @returns The open flag, its setter and the container ref. @complexity O(1).
 */
export function useDismissibleDropdown<T extends HTMLElement = HTMLDivElement>(): DismissibleDropdown<T> {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<T>(null);

  useDismissOnOutsideOrEscape({ onDismiss: () => setOpen(false) }, { enabled: open, containerRef, escapeCapture: true });

  return { open, setOpen, containerRef };
}

/** A settings dropdown's three handlers — see {@link settingsControlHandlers}. */
export interface SettingsControlHandlers<TChoice> {
  /** The trigger button: flips the dropdown, unless the control is disabled. */
  toggleOpen: () => void;
  /** A choice (e.g. a theme pill): applies it, then closes the dropdown. */
  chooseTheme: (input: { next: TChoice }) => void;
  /** The link to the fuller settings page: closes the dropdown, then opens the page. */
  openAppearancePage: () => void;
}

/**
 * A settings dropdown's handlers, built from its dropdown setter and its two callbacks.
 *
 * Only the trigger checks `disabled`: an `aria-disabled` control stays focusable and clickable, so
 * the click itself must do nothing. The dropdown entries do not, because a dropdown that cannot
 * open offers nothing to click.
 *
 * @complexity O(1).
 */
export function settingsControlHandlers<TChoice>(input: {
  disabled: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  onThemeChange: (next: TChoice) => void;
  onOpenAppearance: () => void;
}): SettingsControlHandlers<TChoice> {
  return {
    toggleOpen: () => {
      if (input.disabled) return;
      input.setOpen((current) => !current);
    },
    chooseTheme: ({ next }) => {
      input.onThemeChange(next);
      input.setOpen(false);
    },
    openAppearancePage: () => {
      input.setOpen(false);
      input.onOpenAppearance();
    },
  };
}
