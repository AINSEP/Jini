import type { KeyboardEvent, MutableRefObject, ReactNode } from 'react';
import type { AgentControlProps, useAgentHandle } from '../hooks/useAgentHandle.js';
import type { useOverlayContainer } from '../kit.js';
import type { CustomSelectItem, CustomSelectMenuPosition, useCustomSelect, useCustomSelectOriginTheme } from './CustomSelect.js';

export interface CustomSelectProps extends AgentControlProps {
  useAgentHandleHook?: typeof useAgentHandle;
  useOverlayContainerHook?: typeof useOverlayContainer;
  useCustomSelectOriginThemeHook?: typeof useCustomSelectOriginTheme;
  value: string;
  options: CustomSelectItem[];
  onChange: (value: string) => void;
  ariaLabel: string;
  labelledBy?: string;
  // `| undefined` (not just `?`) so a caller under `exactOptionalPropertyTypes`
  // can forward its OWN optional `className` prop straight through without
  // needing a conditional-spread — see `SearchableModelSelect`, this
  // component's first real consumer.
  className?: string | undefined;
  triggerClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
  placeholder?: string;
  portal?: boolean;
  /** Host-owned portal destination; otherwise the nearest native dialog keeps the menu in its top layer.
   * Keep this container outside clipping regions and transformed fixed-position containing blocks.
   */
  portalContainer?: Element | DocumentFragment | null | undefined;
  title?: string;
  onFocus?: () => void;
  /** Extra content rendered inside the menu, above the option list — the seam
   *  `SearchableModelSelect` uses to place a search input inside the popover
   *  without this component needing to know search exists. `undefined`
   *  renders nothing extra, so every existing caller is unaffected. */
  menuHeader?: ReactNode;
  /** Fires whenever the menu's open state changes. Optional: a plain select
   *  has nothing to do with this; `SearchableModelSelect` uses it to focus
   *  its search input and reset the query exactly when the menu opens. */
  onOpenChange?: (open: boolean) => void;
  /** Custom hook override for dependency injection / testing. */
  useCustomSelect?: typeof useCustomSelect;
}

export interface UseCustomSelectParams {
  value: string;
  options: CustomSelectItem[];
  onChange: (value: string) => void;
  portal: boolean;
  placeholder?: string | undefined;
  /** See `CustomSelectProps.onOpenChange`. */
  onOpenChange?: ((open: boolean) => void) | undefined;
}

export interface UseCustomSelectResult {
  /** Colon-free id prefix for the trigger/menu/option ids. */
  idBase: string;
  buttonRef: MutableRefObject<HTMLButtonElement | null>;
  menuRef: MutableRefObject<HTMLDivElement | null>;
  open: boolean;
  activeValue: string;
  position: CustomSelectMenuPosition | null;
  /** Label to show on the trigger (selected option, else placeholder, else value). */
  selectedLabel: string;
  /** Maps each option value to its stable DOM id. */
  optionIdByValue: Map<string, string>;
  /** `aria-activedescendant` for the trigger, or `undefined` when none. */
  activeOptionId: string | undefined;
  /** Recompute the portal menu position from the live trigger rect. */
  updatePosition: () => void;
  /** Commit a value (ignoring missing/disabled), close, and refocus the trigger. */
  choose: (nextValue: string) => void;
  /** Set the active (highlighted) option value. */
  setActiveValue: (value: string) => void;
  /** Toggle the menu open/closed. */
  toggleOpen: () => void;
  /** Full keyboard handler for the trigger button. */
  onButtonKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Escape handler for the menu container — closes even when focus is inside
   *  custom `menuHeader` content. See this function's definition for why
   *  `onButtonKeyDown` alone is not enough. */
  onMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

