// NOTE: verified zero real consumers in the vendored source snapshot before
// porting (see packages/ui/source-map.md) — shipped anyway since it's small,
// self-contained, and correct; a host may still find it useful as a select
// primitive with grouped options and optional portal-rendered menu.
//
// Shape: this file follows the "dumb component + co-located testable hook(s)"
// pattern (see TooltipLayer.tsx). Every seam is exported: pure helpers, the
// `useCustomSelect` hook that owns all state/refs/effects/handlers, the
// `CustomSelectOptionButton` leaf, and the dumb `CustomSelect` render.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MutableRefObject, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface CustomSelectGroup {
  label: string;
  options: CustomSelectOption[];
}

export type CustomSelectItem = CustomSelectOption | CustomSelectGroup;

export interface CustomSelectProps {
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

/** A single option after grouped items are flattened; `group` records the
 * originating group label (absent for top-level options). */
export interface CustomSelectFlatOption extends CustomSelectOption {
  group?: string;
}

/** Portal-menu geometry, in viewport pixels. */
export interface CustomSelectMenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/** Space between the trigger and the menu. */
export const CUSTOM_SELECT_MENU_GAP = 4;
/** Minimum distance the menu keeps from any viewport edge. */
export const CUSTOM_SELECT_VIEWPORT_PAD = 12;
/** Floor for the menu's computed max-height. */
export const CUSTOM_SELECT_MIN_MENU_HEIGHT = 160;
/** Ceiling for the menu's computed max-height. */
export const CUSTOM_SELECT_MAX_MENU_HEIGHT = 300;
/** When the space below the trigger is under this, the menu may flip above. */
export const CUSTOM_SELECT_FLIP_THRESHOLD = 180;

/** Type guard: is this item a group (has nested `options`) rather than a leaf? */
export function isCustomSelectGroup(item: CustomSelectItem): item is CustomSelectGroup {
  return 'options' in item;
}

/** Flatten grouped/ungrouped items into a single ordered list, tagging each
 * option that came from a group with its group label. */
export function flattenCustomSelectOptions(items: CustomSelectItem[]): CustomSelectFlatOption[] {
  return items.flatMap((item) =>
    isCustomSelectGroup(item)
      ? item.options.map((option) => ({ ...option, group: item.label }))
      : [item],
  );
}

/** Pure geometry: given the trigger's rect and the viewport, compute where the
 * portal menu should sit (flipping above the trigger when space below is
 * tight). Extracted from the hook so the branching math is unit-testable. */
export function computeCustomSelectMenuPosition(
  rect: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number },
): CustomSelectMenuPosition {
  const gap = CUSTOM_SELECT_MENU_GAP;
  const viewportPad = CUSTOM_SELECT_VIEWPORT_PAD;
  const below = viewport.height - rect.bottom - viewportPad;
  const above = rect.top - viewportPad;
  const maxHeight = Math.max(
    CUSTOM_SELECT_MIN_MENU_HEIGHT,
    Math.min(CUSTOM_SELECT_MAX_MENU_HEIGHT, Math.max(below, above) - gap),
  );
  const openAbove = below < CUSTOM_SELECT_FLIP_THRESHOLD && above > below;
  return {
    top: openAbove ? Math.max(viewportPad, rect.top - maxHeight - gap) : rect.bottom + gap,
    left: Math.min(
      Math.max(viewportPad, rect.left),
      Math.max(viewportPad, viewport.width - rect.width - viewportPad),
    ),
    width: rect.width,
    maxHeight,
  };
}

/** Pure keyboard-nav math: the value the active option should move to when the
 * user presses Down (`1`) or Up (`-1`), wrapping around the enabled options.
 * Returns `null` when there is nothing enabled to move to. */
export function nextCustomSelectActiveValue(
  enabledOptions: CustomSelectFlatOption[],
  activeValue: string,
  direction: 1 | -1,
): string | null {
  if (!enabledOptions.length) return null;
  const currentIndex = enabledOptions.findIndex((option) => option.value === activeValue);
  const nextIndex =
    currentIndex < 0
      ? 0
      : (currentIndex + direction + enabledOptions.length) % enabledOptions.length;
  return enabledOptions[nextIndex]!.value;
}

/** Pure: which option should be active when the menu opens — the current value
 * if it maps to an enabled option, else the first enabled option, else none. */
export function resolveInitialCustomSelectActiveValue(
  flatOptions: CustomSelectFlatOption[],
  enabledOptions: CustomSelectFlatOption[],
  value: string,
): string {
  const selectedOption = flatOptions.find((option) => option.value === value && !option.disabled);
  return selectedOption?.value ?? enabledOptions[0]?.value ?? '';
}

export interface CustomSelectActiveReconcileInput {
  open: boolean;
  value: string;
  wasOpen: boolean;
  activeSourceValue: string;
  flatOptions: CustomSelectFlatOption[];
  enabledOptions: CustomSelectFlatOption[];
}

export interface CustomSelectActiveReconcileResult {
  /** New value for the `wasOpen` ref. */
  wasOpen: boolean;
  /** New value for the `activeSourceValue` ref. */
  activeSourceValue: string;
  /** When defined, the active value should be set to this; when `undefined`,
   * the active value is left untouched. */
  nextActiveValue?: string;
}

/** Pure decision for the open/value effect: how to reconcile the active option
 * (and the two tracking refs) when `open` or `value` changes. Kept out of the
 * effect so its "already reconciled" guard is directly unit-testable — that
 * branch is unreachable through the effect's `[open, value]` dependency flow. */
export function reconcileCustomSelectActiveValue(
  input: CustomSelectActiveReconcileInput,
): CustomSelectActiveReconcileResult {
  const { open, value, wasOpen, activeSourceValue, flatOptions, enabledOptions } = input;
  if (!open) {
    return { wasOpen: false, activeSourceValue: value };
  }
  if (wasOpen && activeSourceValue === value) {
    return { wasOpen, activeSourceValue };
  }
  return {
    wasOpen: true,
    activeSourceValue: value,
    nextActiveValue: resolveInitialCustomSelectActiveValue(flatOptions, enabledOptions, value),
  };
}

/** Pure: is a pointerdown target inside the trigger or the (possibly absent)
 * menu? Used to decide whether an outside click should close the menu. */
export function isCustomSelectEventInside(
  target: Node,
  button: HTMLElement | null,
  menu: HTMLElement | null,
): boolean {
  return Boolean(button?.contains(target)) || Boolean(menu?.contains(target));
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

/**
 * All of CustomSelect's behavior — ids, refs, open/active/position state, the
 * portal-positioning effect, the open/value active-option reconciliation
 * effect, the outside-click + scroll/resize effect, and the choose/keyboard
 * handlers — with no rendering. Exported (with the pure helpers above) so the
 * logic is testable in isolation from the DOM; `CustomSelect` is the dumb
 * consumer.
 */
export function useCustomSelect({
  value,
  options,
  onChange,
  portal,
  placeholder,
  onOpenChange,
}: UseCustomSelectParams): UseCustomSelectResult {
  const reactId = useId();
  const idBase = reactId.replace(/:/g, '');
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const activeSourceValueRef = useRef(value);
  const [open, setOpen] = useState(false);
  // Stored in a ref (not a `useEffect` dependency) so an unmemoized caller
  // passing a fresh function identity every render never re-fires this for
  // any reason OTHER than `open` actually changing.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const [activeValue, setActiveValue] = useState(value);
  const [position, setPosition] = useState<CustomSelectMenuPosition | null>(null);

  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);

  const flatOptions = useMemo(() => flattenCustomSelectOptions(options), [options]);
  const selected = flatOptions.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? placeholder ?? value;
  const enabledOptions = useMemo(
    () => flatOptions.filter((option) => !option.disabled),
    [flatOptions],
  );
  const flatOptionsRef = useRef(flatOptions);
  const enabledOptionsRef = useRef(enabledOptions);
  flatOptionsRef.current = flatOptions;
  enabledOptionsRef.current = enabledOptions;
  const optionIdByValue = useMemo(
    () => new Map(flatOptions.map((option, index) => [option.value, `${idBase}-option-${index}`])),
    [flatOptions, idBase],
  );
  const activeOptionId = open && activeValue ? optionIdByValue.get(activeValue) : undefined;

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition(
      computeCustomSelectMenuPosition(rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, []);

  useEffect(() => {
    if (!portal) return;
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open, portal, updatePosition]);

  useEffect(() => {
    const result = reconcileCustomSelectActiveValue({
      open,
      value,
      wasOpen: wasOpenRef.current,
      activeSourceValue: activeSourceValueRef.current,
      flatOptions: flatOptionsRef.current,
      enabledOptions: enabledOptionsRef.current,
    });
    wasOpenRef.current = result.wasOpen;
    activeSourceValueRef.current = result.activeSourceValue;
    if (result.nextActiveValue !== undefined) setActiveValue(result.nextActiveValue);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (isCustomSelectEventInside(target, buttonRef.current, menuRef.current)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => {
      if (portal) updatePosition();
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, portal, updatePosition]);

  const choose = (nextValue: string) => {
    const next = flatOptions.find((option) => option.value === nextValue);
    if (!next || next.disabled) return;
    onChange(next.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    const next = nextCustomSelectActiveValue(enabledOptions, activeValue, direction);
    if (next !== null) setActiveValue(next);
  };

  const toggleOpen = () => setOpen((current) => !current);

  const closeAndRefocusTrigger = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) {
        choose(activeValue || value);
      } else {
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeAndRefocusTrigger();
    }
  };

  // Escape closes even when focus has moved into custom `menuHeader` content
  // (e.g. `SearchableModelSelect`'s search input) — `onButtonKeyDown` alone
  // only fires while the TRIGGER itself has focus, which no longer holds once
  // the operator tabs or clicks into menu content that can actually receive
  // focus (unlike the option buttons, which are `tabIndex={-1}` and never
  // take real focus). Attached to the menu container, not the document, so it
  // never fires for an unrelated Escape press elsewhere on the page.
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeAndRefocusTrigger();
  };

  return {
    idBase,
    buttonRef,
    menuRef,
    open,
    activeValue,
    position,
    selectedLabel,
    optionIdByValue,
    activeOptionId,
    updatePosition,
    choose,
    setActiveValue,
    toggleOpen,
    onButtonKeyDown,
    onMenuKeyDown,
  };
}

/**
 * Accessible custom `<select>` replacement with grouped options, full keyboard
 * navigation, and an optional portal-rendered menu. All behavior lives in
 * {@link useCustomSelect}; this component only wires the hook's state to the
 * trigger button and the listbox menu.
 */
export function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  labelledBy,
  className,
  triggerClassName,
  menuClassName,
  disabled = false,
  placeholder,
  portal = true,
  title,
  onFocus,
  menuHeader,
  onOpenChange,
  useCustomSelect: useCustomSelectHook = useCustomSelect,
}: CustomSelectProps) {
  const {
    idBase,
    buttonRef,
    menuRef,
    open,
    activeValue,
    position,
    selectedLabel,
    optionIdByValue,
    activeOptionId,
    choose,
    setActiveValue,
    toggleOpen,
    onButtonKeyDown,
    onMenuKeyDown,
  } = useCustomSelectHook({ value, options, onChange, portal, placeholder, onOpenChange });

  const menu = (
    <div
      ref={menuRef}
      id={`${idBase}-menu`}
      onKeyDown={onMenuKeyDown}
      className={[
        'jini-select-menu',
        portal ? 'portal' : 'inline',
        menuClassName,
      ].filter(Boolean).join(' ')}
      role="listbox"
      aria-label={ariaLabel}
      style={
        portal && position
          ? {
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }
          : undefined
      }
    >
      {menuHeader}
      {options.map((item) => {
        if (isCustomSelectGroup(item)) {
          return (
            <div className="jini-select-group" key={`group:${item.label}`}>
              <div className="jini-select-group-label">{item.label}</div>
              {item.options.map((option) => (
                <CustomSelectOptionButton
                  key={option.value}
                  option={option}
                  selected={option.value === value}
                  active={option.value === activeValue}
                  id={optionIdByValue.get(option.value)}
                  onChoose={choose}
                  onActive={setActiveValue}
                />
              ))}
            </div>
          );
        }
        return (
          <CustomSelectOptionButton
            key={item.value}
            option={item}
            selected={item.value === value}
            active={item.value === activeValue}
            id={optionIdByValue.get(item.value)}
            onChoose={choose}
            onActive={setActiveValue}
          />
        );
      })}
    </div>
  );

  return (
    <div className={['jini-select', className].filter(Boolean).join(' ')}>
      <button
        ref={buttonRef}
        type="button"
        className={['jini-select-trigger', triggerClassName].filter(Boolean).join(' ')}
        role="combobox"
        value={value}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${idBase}-menu`}
        aria-activedescendant={activeOptionId}
        aria-describedby={labelledBy}
        aria-label={`${ariaLabel}: ${selectedLabel}`}
        disabled={disabled}
        title={title}
        onClick={toggleOpen}
        onKeyDown={onButtonKeyDown}
        onFocus={onFocus}
      >
        <span id={`${idBase}-value`} className="jini-select-value">
          {selectedLabel}
        </span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open ? (portal ? (position ? createPortal(menu, document.body) : null) : menu) : null}
    </div>
  );
}

/** One row in the listbox: a selectable option button that reports hover
 * (activation) and click (choice) back to {@link CustomSelect}. */
export function CustomSelectOptionButton({
  option,
  selected,
  active,
  id,
  onChoose,
  onActive,
}: {
  option: CustomSelectOption;
  selected: boolean;
  active: boolean;
  id: string | undefined;
  onChoose: (value: string) => void;
  onActive: (value: string) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      className={[
        'jini-select-option',
        selected ? 'selected' : '',
        active ? 'active' : '',
      ].filter(Boolean).join(' ')}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      disabled={option.disabled}
      onMouseEnter={() => onActive(option.value)}
      onClick={() => onChoose(option.value)}
    >
      <span className="jini-select-option-label">{option.label}</span>
      <span className="jini-select-option-check" aria-hidden>
        <Icon name="check" size={13} />
      </span>
    </button>
  );
}
