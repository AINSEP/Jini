import { useRef, useState } from 'react';
import { filterAgentModelOptions } from '@jini-ai/ui-core';
import type { AgentModelOption } from '@jini-ai/ui-core';
import { CustomSelect } from '../../../../react/components/CustomSelect.js';
import type { CustomSelectOption } from '../../../../react/components/CustomSelect.js';

export interface SearchableModelSelectAdditionalOption {
  value: string;
  label: string;
}

export interface SearchableModelSelectProps {
  models: readonly AgentModelOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  searchPlaceholder: string;
  /** Extra entries appended after `models` — this tab uses it for the
   *  "Custom" sentinel (`CUSTOM_MODEL_SENTINEL`) so typing a free-form model
   *  id is one more option in the same list rather than a separate control. */
  additionalOptions?: readonly SearchableModelSelectAdditionalOption[] | undefined;
  /** The search box only renders once the combined option count reaches this
   *  floor — a 3-model agent doesn't need a search box to page through 3
   *  options. Origin: `SearchableModelSelect`'s `minSearchableOptions`. */
  minSearchableOptions?: number;
  className?: string | undefined;
  testId?: string | undefined;
  searchInputTestId?: string | undefined;
}

/**
 * A `CustomSelect` with a search box inside its popover, for model lists long
 * enough that scrolling a plain dropdown stops being usable. Origin: OD's
 * `SearchableModelSelect` (`components/modelOptions.tsx`) — ported as a thin
 * wrapper around `packages/ui`'s existing `CustomSelect` primitive rather
 * than reimplementing its own portal/positioning/keyboard-nav logic, since
 * `CustomSelect` already owns all of that (and, per its own header comment,
 * had zero consumers yet — this is its first).
 *
 * Deliberately NOT ported: capability-tag badges, cost-tier labels, and the
 * disabled-option "upgrade lock" affordance. All three read OD's own
 * monetization/plan-catalog concepts (AMR's paid tiers) directly off the
 * model option — genuinely product-bound, not a generic model-select
 * capability, and this package ships no such vocabulary for a host to hook
 * into. A host that needs per-option badges can compose them into `label`.
 */
export function SearchableModelSelect({
  models,
  value,
  onChange,
  ariaLabel,
  searchPlaceholder,
  additionalOptions,
  minSearchableOptions = 8,
  className,
  testId,
  searchInputTestId,
}: SearchableModelSelectProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  const allOptions: CustomSelectOption[] = [
    ...models.map((model) => ({ value: model.id, label: model.label })),
    ...(additionalOptions ?? []),
  ];
  const shouldShowSearch = allOptions.length >= minSearchableOptions;
  const filteredModels = filterAgentModelOptions(models, query, value);
  const filteredIds = new Set(filteredModels.map((model) => model.id));
  // `additionalOptions` (the "Custom" sentinel, chiefly) are never
  // search-filtered out — they are not a model to search FOR, they are the
  // escape hatch that must stay reachable regardless of query.
  const visibleOptions: CustomSelectOption[] = shouldShowSearch
    ? allOptions.filter((option) => filteredIds.has(option.value) || (additionalOptions ?? []).some((extra) => extra.value === option.value))
    : allOptions;

  const handleOpenChange = (open: boolean) => {
    if (open) {
      // Deferred a tick: the search input is not yet in the DOM (the portal
      // menu mounts as part of this same open transition) when `open` first
      // flips true.
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setQuery('');
    }
  };

  return (
    <div className="jini-searchable-select" data-testid={testId}>
      <CustomSelect
        value={value}
        options={visibleOptions}
        onChange={onChange}
        ariaLabel={ariaLabel}
        className={className}
        onOpenChange={handleOpenChange}
        menuHeader={
          shouldShowSearch ? (
            <div className="jini-searchable-select-search-row">
              <input
                ref={searchRef}
                type="search"
                className="jini-input jini-searchable-select-search"
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                data-testid={searchInputTestId}
                // The popover's own outside-pointerdown/keydown listeners are
                // scoped to the menu element, so typing here never closes it
                // — but stopping propagation keeps that explicit rather than
                // incidental.
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
