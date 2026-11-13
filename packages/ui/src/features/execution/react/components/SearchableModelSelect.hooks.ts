import { useRef, useState } from 'react';
import { filterAgentModelOptions } from '../../rules.js';
import type { CustomSelectOption } from '../../../../react/components/CustomSelect.js';
import type { SearchableModelSelectProps } from './SearchableModelSelect.js';

/** Filter model choices and focus or clear the search as the menu opens and closes. */
export function useSearchableModelSelect({ models, value, additionalOptions, minSearchableOptions }: Pick<SearchableModelSelectProps, 'models' | 'value' | 'additionalOptions'> & { minSearchableOptions: number }, _options = {}) {
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

  return { query, setQuery, searchRef, shouldShowSearch, visibleOptions, handleOpenChange };
}
