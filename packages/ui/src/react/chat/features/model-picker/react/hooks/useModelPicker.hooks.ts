/**
 * @module useModelPicker
 *
 * Headless controller for the model-picker feature: open/query state,
 * derived provider groups + current selection, and the outside-click/
 * Escape dismissal that `InlineModelSwitcher.tsx`'s popover and
 * `modelOptions.tsx`'s `SearchableModelSelect` both hand-roll. All grouping/
 * filtering/selection logic is delegated to the pure `rules.ts` — this hook
 * only owns React state and the DOM-subscription effect.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { DEFAULT_MIN_SEARCHABLE_OPTIONS } from '../../constants.js';
import { filterModelGroups, findSelectedModel, firstAvailableModelId, groupModelsByProvider } from '../../rules.js';
import type { CredentialStatus, ModelOption, ModelPickerGroup, ModelPickerSelection, ModelProvider } from '../../types.js';

export interface UseModelPickerOptions {
  models: readonly ModelOption[];
  providers: readonly ModelProvider[];
  statusByProviderId: Readonly<Record<string, CredentialStatus>>;
  value: string;
  onChange: (modelId: string) => void;
  /** When true, auto-selects the first available model whenever `value` doesn't match any model. Defaults to false. */
  autoSelectFirst?: boolean;
  minSearchableOptions?: number;
}

export interface ModelPickerController {
  open: boolean;
  query: string;
  groups: ModelPickerGroup[];
  filteredGroups: ModelPickerGroup[];
  selection: ModelPickerSelection | null;
  shouldShowSearch: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  setQuery: (query: string) => void;
  toggle: () => void;
  close: () => void;
  select: (modelId: string) => void;
}

export function useModelPicker({
  models,
  providers,
  statusByProviderId,
  value,
  onChange,
  autoSelectFirst = false,
  minSearchableOptions = DEFAULT_MIN_SEARCHABLE_OPTIONS,
}: UseModelPickerOptions): ModelPickerController {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(
    () => groupModelsByProvider(models, providers, statusByProviderId),
    [models, providers, statusByProviderId],
  );
  const filteredGroups = useMemo(() => filterModelGroups(groups, query), [groups, query]);
  const selection = useMemo(() => findSelectedModel(groups, value), [groups, value]);
  const totalOptionCount = useMemo(() => groups.reduce((count, group) => count + group.models.length, 0), [groups]);
  const shouldShowSearch = totalOptionCount >= minSearchableOptions;

  useEffect(() => {
    if (!autoSelectFirst || selection) return;
    const fallbackId = firstAvailableModelId(groups);
    if (fallbackId) onChange(fallbackId);
  }, [autoSelectFirst, groups, onChange, selection]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const select = useCallback(
    (modelId: string) => {
      onChange(modelId);
      close();
    },
    [close, onChange],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return { open, query, groups, filteredGroups, selection, shouldShowSearch, containerRef, setQuery, toggle, close, select };
}
