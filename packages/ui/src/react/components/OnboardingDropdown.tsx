// Searchable/multi-select dropdown with viewport-aware flip placement,
// click-outside/Escape dismiss, and single-open-at-a-time coordination
// across multiple mounted instances (via a broadcast `window` event).
// Origin: `OnboardingDropdown` in `EntryShell.tsx` (OD). Only the
// `options` shape's optional `meta`/`tag` fields were OD-flavored in the
// recon read; this port keeps the plain `{ value, label }` shape actually
// used by the component. Genericized:
//  - The peer-coordination event name was a product-identity string
//    (`'open-design:onboarding-dropdown-open'`); renamed to
//    `'jini-ui:onboarding-dropdown-open'`.
//  - The two hardcoded empty-state i18n keys
//    (`'homeHero.footer.noMatches'` / `'settings.fetchModelsEmpty'`, OD's
//    own dictionary keys) are replaced with plain-English strings routed
//    through this package's own `useT()` — `'No matches'` for a searchable
//    field with no query hits, and a new, non-model-specific `'No options
//    available'` for an empty non-searchable field (the origin's fallback
//    text talked about "text models", which was itself a leftover from the
//    one call site it happened to serve, not a generic empty state).
// See packages/ui/source-map.md.
//
// Shape: this module follows the package's "dumb component + co-located
// testable hooks" pattern (see `TooltipLayer.tsx`). All state, refs,
// effects, and DOM measurement live in exported hooks
// ({@link useOnboardingDropdown}, {@link useOnboardingDropdownPlacement});
// all branchy derivations live in exported pure helpers
// ({@link resolveOnboardingSelectedValues}, {@link resolveOnboardingTriggerLabel},
// {@link filterOnboardingOptions}, {@link resolveOnboardingMenuMetrics},
// {@link onboardingEmptyMessageKey}). `OnboardingDropdown` is the dumb
// consumer that only renders.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useT } from '../../features/i18n/index.js';
import { Icon } from './Icon.js';

export const ONBOARDING_DROPDOWN_OPEN_EVENT = 'jini-ui:onboarding-dropdown-open';

/** Vertical space (px) below the trigger under which the menu prefers to flip up. */
export const ONBOARDING_MENU_FLIP_THRESHOLD = 260;
/** Menu height (px) clamp: never taller than this. */
export const ONBOARDING_MENU_MAX_HEIGHT = 240;
/** Menu height (px) clamp: never shorter than this. */
export const ONBOARDING_MENU_MIN_HEIGHT = 48;
/** Padding (px) subtracted from the available space when sizing the menu. */
export const ONBOARDING_MENU_VIEWPORT_PADDING = 16;
/** Viewport height (px) assumed when neither `innerHeight` nor `clientHeight` is available. */
export const ONBOARDING_MENU_FALLBACK_VIEWPORT = 720;

export type OnboardingDropdownPlacement = 'bottom' | 'top';

export interface OnboardingDropdownOption {
  value: string;
  label: string;
}

interface OnboardingDropdownBaseProps {
  label: string;
  placeholder: string;
  options: OnboardingDropdownOption[];
  placement?: OnboardingDropdownPlacement;
  searchable?: boolean;
  searchPlaceholder?: string;
  sourceTone?: string;
  className?: string;
  /** Custom hook override for dependency injection / testing. */
  useOnboardingDropdown?: typeof useOnboardingDropdown;
}

export type OnboardingDropdownProps =
  | (OnboardingDropdownBaseProps & {
      value: string;
      onChange: (value: string) => void;
      multiple?: false;
    })
  | (OnboardingDropdownBaseProps & {
      value: string[];
      onChange: (value: string[]) => void;
      multiple: true;
    });

// ---------------------------------------------------------------------------
// Pure helpers (module-level, no React) — each isolates one branchy decision.
// ---------------------------------------------------------------------------

/**
 * Normalize the polymorphic `value` prop into a flat array of selected values.
 * An array passes through; a non-empty string becomes a singleton; an empty
 * string (or otherwise falsy value) becomes an empty selection.
 */
export function resolveOnboardingSelectedValues(value: string | string[]): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

/**
 * Compute the trigger's visible label. In multiple mode it joins every
 * selected option's label; in single mode it uses the first selected label.
 * Falls back to `placeholder` when nothing resolves.
 */
export function resolveOnboardingTriggerLabel(
  selectedOptions: OnboardingDropdownOption[],
  multiple: boolean,
  placeholder: string,
): string {
  const selectedLabel = multiple
    ? selectedOptions.map((option) => option.label).join(', ')
    : selectedOptions[0]?.label;
  return selectedLabel || placeholder;
}

/**
 * Filter the option list for the menu. When not searchable, or when the query
 * is blank, every option is returned. Otherwise options are matched
 * case-insensitively against their `label` and `value`.
 */
export function filterOnboardingOptions(
  options: OnboardingDropdownOption[],
  query: string,
  searchable: boolean,
): OnboardingDropdownOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!searchable || !normalizedQuery) return options;
  return options.filter((option) =>
    `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery),
  );
}

/** The (untranslated) empty-state key for the current field mode. */
export function onboardingEmptyMessageKey(searchable: boolean): string {
  return searchable ? 'No matches' : 'No options available';
}

export interface OnboardingDropdownMenuMetrics {
  placement: OnboardingDropdownPlacement;
  maxHeight: number;
}

/**
 * Decide where the menu opens and how tall it may be, given the trigger's
 * bounding rect and the viewport height. Prefers the caller's requested
 * placement, but flips to `top` when the space below the trigger is tight
 * (< {@link ONBOARDING_MENU_FLIP_THRESHOLD}) and there is more room above.
 * The height is clamped to
 * [{@link ONBOARDING_MENU_MIN_HEIGHT}, {@link ONBOARDING_MENU_MAX_HEIGHT}].
 */
export function resolveOnboardingMenuMetrics(
  rect: { top: number; bottom: number },
  viewportHeight: number,
  requestedPlacement: OnboardingDropdownPlacement,
): OnboardingDropdownMenuMetrics {
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  const placement =
    requestedPlacement === 'top' || (spaceBelow < ONBOARDING_MENU_FLIP_THRESHOLD && spaceAbove > spaceBelow)
      ? 'top'
      : 'bottom';
  const availableSpace = placement === 'top' ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(
    ONBOARDING_MENU_MIN_HEIGHT,
    Math.min(ONBOARDING_MENU_MAX_HEIGHT, availableSpace - ONBOARDING_MENU_VIEWPORT_PADDING),
  );
  return { placement, maxHeight };
}

/** Read the current viewport height with progressive fallbacks. */
export function readOnboardingViewportHeight(): number {
  return (
    window.innerHeight ||
    document.documentElement.clientHeight ||
    ONBOARDING_MENU_FALLBACK_VIEWPORT
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Measure the trigger and derive the menu's resolved placement + max height
 * whenever the menu is open, keeping it in sync with `resize`/`scroll`. All
 * arithmetic is delegated to {@link resolveOnboardingMenuMetrics}; this hook
 * only owns the DOM measurement and the listener lifecycle. Measurement is a
 * no-op until the ref is attached, so consumers that open before the field
 * mounts (or exercise the hook in isolation) never dereference a null node.
 */
export function useOnboardingDropdownPlacement(
  rootRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  placement: OnboardingDropdownPlacement,
  optionCount: number,
): OnboardingDropdownMenuMetrics {
  const [metrics, setMetrics] = useState<OnboardingDropdownMenuMetrics>({
    placement,
    maxHeight: ONBOARDING_MENU_MAX_HEIGHT,
  });

  useLayoutEffect(() => {
    if (!open) return;

    function measureMenu() {
      const node = rootRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setMetrics(resolveOnboardingMenuMetrics(rect, readOnboardingViewportHeight(), placement));
    }

    measureMenu();
    window.addEventListener('resize', measureMenu);
    window.addEventListener('scroll', measureMenu, true);
    return () => {
      window.removeEventListener('resize', measureMenu);
      window.removeEventListener('scroll', measureMenu, true);
    };
  }, [open, placement, optionCount, rootRef]);

  return metrics;
}

export interface UseOnboardingDropdownResult {
  /** Whether the menu is currently open. */
  open: boolean;
  /** Current search query (only meaningful when `searchable`). */
  query: string;
  /** Update the search query. */
  setQuery: (value: string) => void;
  /** Toggle the menu; opening broadcasts the single-open peer event. */
  toggleOpen: () => void;
  /** Attach to the field root; used for click-outside detection + measurement. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** Placement after viewport-aware flip. */
  resolvedPlacement: OnboardingDropdownPlacement;
  /** Menu max height (px) after clamping to available space. */
  menuMaxHeight: number;
  /** Flat list of currently selected values. */
  selectedValues: string[];
  /** Whether any option is selected. */
  hasValue: boolean;
  /** The label shown on the trigger button. */
  triggerLabel: string;
  /** Options to render in the menu (query-filtered when searchable). */
  visibleOptions: OnboardingDropdownOption[];
  /** Translated empty-state copy for the current mode. */
  emptyMessage: string;
  /**
   * Apply an option click: in multiple mode this toggles the value (staying
   * open); in single mode it selects and closes.
   */
  selectOption: (option: OnboardingDropdownOption, selected: boolean) => void;
}

/**
 * All of the dropdown's behavior — open/query state, the field ref, the
 * viewport-aware placement, the click-outside/Escape dismissal, the query
 * reset on close, the single-open-at-a-time peer coordination, and the
 * select/toggle logic — with no rendering. Exported (with the pure helpers
 * above) so the logic is testable in isolation; `OnboardingDropdown` is the
 * dumb consumer.
 */
export function useOnboardingDropdown(props: OnboardingDropdownProps): UseOnboardingDropdownResult {
  const t = useT();
  const {
    placeholder,
    value,
    options,
    placement = 'bottom',
    multiple = false,
    searchable = false,
  } = props;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dropdownIdRef = useRef(`onboarding-dropdown-${Math.random().toString(36).slice(2)}`);

  const { placement: resolvedPlacement, maxHeight: menuMaxHeight } = useOnboardingDropdownPlacement(
    rootRef,
    open,
    placement,
    options.length,
  );

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    function handlePeerOpen(event: Event) {
      if ((event as CustomEvent<string>).detail !== dropdownIdRef.current) {
        setOpen(false);
      }
    }

    window.addEventListener(ONBOARDING_DROPDOWN_OPEN_EVENT, handlePeerOpen);
    return () => {
      window.removeEventListener(ONBOARDING_DROPDOWN_OPEN_EVENT, handlePeerOpen);
    };
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        window.dispatchEvent(
          new CustomEvent(ONBOARDING_DROPDOWN_OPEN_EVENT, {
            detail: dropdownIdRef.current,
          }),
        );
      }
      return nextOpen;
    });
  }, []);

  const selectedValues = resolveOnboardingSelectedValues(value);
  const selectedOptions = options.filter((option) => selectedValues.includes(option.value));
  const hasValue = selectedOptions.length > 0;
  const triggerLabel = resolveOnboardingTriggerLabel(selectedOptions, multiple, placeholder);
  const visibleOptions = filterOnboardingOptions(options, query, searchable);
  const emptyMessage = t(onboardingEmptyMessageKey(searchable));

  function selectOption(option: OnboardingDropdownOption, selected: boolean) {
    if (props.multiple) {
      props.onChange(
        selected
          ? selectedValues.filter((selectedValue) => selectedValue !== option.value)
          : [...selectedValues, option.value],
      );
      return;
    }
    props.onChange(option.value);
    setOpen(false);
  }

  return {
    open,
    query,
    setQuery,
    toggleOpen,
    rootRef,
    resolvedPlacement,
    menuMaxHeight,
    selectedValues,
    hasValue,
    triggerLabel,
    visibleOptions,
    emptyMessage,
    selectOption,
  };
}

// ---------------------------------------------------------------------------
// Dumb component
// ---------------------------------------------------------------------------

function OnboardingDropdownSearch({ query, setQuery, placeholder, label }: {
  query: string;
  setQuery: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label
      className="onboarding-view__select-search"
      onClick={(event) => event.stopPropagation()}
    >
      <Icon name="search" size={14} />
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        aria-label={label}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') {
            event.stopPropagation();
          }
        }}
      />
    </label>
  );
}

function OnboardingDropdownOptionButton({ option, selected, selectOption }: {
  option: OnboardingDropdownOption;
  selected: boolean;
  selectOption: UseOnboardingDropdownResult['selectOption'];
}) {
  return (
    <button
      type="button"
      className={`onboarding-view__select-option${selected ? ' is-selected' : ''}`}
      role="option"
      aria-selected={selected}
      onClick={() => selectOption(option, selected)}
    >
      <span>{option.label}</span>
      {selected ? <Icon name="check" size={15} /> : null}
    </button>
  );
}

function OnboardingDropdownOptions({ label, multiple, visibleOptions, selectedValues, emptyMessage, selectOption }: {
  label: string;
  multiple: boolean;
} & Pick<UseOnboardingDropdownResult, 'visibleOptions' | 'selectedValues' | 'emptyMessage' | 'selectOption'>) {
  return (
    <div
      className="onboarding-view__select-options"
      role="listbox"
      aria-label={label}
      aria-multiselectable={multiple || undefined}
    >
      {visibleOptions.map((option) => (
        <OnboardingDropdownOptionButton
          key={option.value}
          option={option}
          selected={selectedValues.includes(option.value)}
          selectOption={selectOption}
        />
      ))}
      {visibleOptions.length === 0 ? (
        <div className="onboarding-view__select-empty">{emptyMessage}</div>
      ) : null}
    </div>
  );
}

function OnboardingDropdownTrigger({ open, hasValue, triggerLabel, toggleOpen }: Pick<UseOnboardingDropdownResult, 'open' | 'hasValue' | 'triggerLabel' | 'toggleOpen'>) {
  return (
    <button
      type="button"
      className={`onboarding-view__select-trigger${open ? ' is-open' : ''}${
        hasValue ? ' has-value' : ''
      }`}
      aria-haspopup="listbox"
      aria-expanded={open}
      title={triggerLabel}
      onClick={toggleOpen}
    >
      <span>{triggerLabel}</span>
      <Icon name="chevron-down" size={16} />
    </button>
  );
}

function OnboardingDropdownMenu({ label, placeholder, multiple, searchable, searchPlaceholder, query, setQuery, menuMaxHeight, ...listProps }: {
  label: string;
  placeholder: string;
  multiple: boolean;
  searchable: boolean;
  searchPlaceholder: string | undefined;
} & Pick<UseOnboardingDropdownResult, 'query' | 'setQuery' | 'menuMaxHeight' | 'visibleOptions' | 'selectedValues' | 'emptyMessage' | 'selectOption'>) {
  return (
    <div
      className="onboarding-view__select-menu"
      data-searchable={searchable || undefined}
      style={{ '--onboarding-select-menu-max-height': `${menuMaxHeight}px` } as CSSProperties}
    >
      {searchable ? (
        <OnboardingDropdownSearch
          query={query}
          setQuery={setQuery}
          placeholder={searchPlaceholder || placeholder}
          label={searchPlaceholder || label}
        />
      ) : null}
      <OnboardingDropdownOptions label={label} multiple={multiple} {...listProps} />
    </div>
  );
}

/**
 * Searchable/multi-select onboarding dropdown. All behavior lives in
 * {@link useOnboardingDropdown}; this component only renders the field,
 * trigger, and (when open) the menu.
 */
export function OnboardingDropdown(props: OnboardingDropdownProps) {
  const {
    label,
    placeholder,
    multiple = false,
    searchable = false,
    searchPlaceholder,
    sourceTone,
    className,
    useOnboardingDropdown: useOnboardingDropdownHook = useOnboardingDropdown,
  } = props;

  const {
    open,
    query,
    setQuery,
    toggleOpen,
    rootRef,
    resolvedPlacement,
    menuMaxHeight,
    selectedValues,
    hasValue,
    triggerLabel,
    visibleOptions,
    emptyMessage,
    selectOption,
  } = useOnboardingDropdownHook(props);

  return (
    <div
      className={['onboarding-view__select-field', className].filter(Boolean).join(' ')}
      data-placement={resolvedPlacement}
      data-open={open || undefined}
      ref={rootRef}
    >
      <span
        className="onboarding-view__select-label"
        data-source-tone={sourceTone || undefined}
      >
        {label}
      </span>
      <OnboardingDropdownTrigger open={open} hasValue={hasValue} triggerLabel={triggerLabel} toggleOpen={toggleOpen} />
      {open ? (
        <OnboardingDropdownMenu
          label={label}
          placeholder={placeholder}
          multiple={multiple}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          query={query}
          setQuery={setQuery}
          menuMaxHeight={menuMaxHeight}
          visibleOptions={visibleOptions}
          selectedValues={selectedValues}
          emptyMessage={emptyMessage}
          selectOption={selectOption}
        />
      ) : null}
    </div>
  );
}
