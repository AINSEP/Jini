import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useDismissOnOutsideOrEscape } from '../../../../browser/index.js';
import { DEFAULT_MAX_RESULTS_PER_CATEGORY, DEFAULT_TRIGGER_CHAR } from '../../constants.js';
import {
  buildMentionToken,
  filterMentionItems,
  groupItemsByCategory,
  hasAnyResults,
  insertMentionToken,
  mentionSelectionKey,
  readMentionTrigger,
} from '../../rules.js';
import type {
  MentionCategory,
  MentionCategoryFilter,
  MentionItem,
  MentionTriggerMatch,
} from '../../types.js';
import type { MentionResultGroup } from '../../rules.js';

export interface UseMentionAutocompleteParams<T extends MentionItem> {
  value: string;
  onValueChange: (next: string) => void;
  items: T[];
  categories: MentionCategory[];
  /** Called whenever the selected-item set changes (a pick or a chip
   *  removal) — the full next selection, in insertion order. Optional; the
   *  hook tracks selection internally regardless. */
  onSelectionChange?: ((selected: T[]) => void) | undefined;
  triggerChar?: string | undefined;
  getSearchText?: ((item: T) => string) | undefined;
  maxResultsPerCategory?: number | undefined;
}

export interface UseMentionAutocompleteResult<T extends MentionItem> {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  mention: MentionTriggerMatch | null;
  isOpen: boolean;
  /** The trimmed active query (`''` when no mention is active) — exposed
   *  directly so callers don't need to re-derive it from `mention?.query`. */
  query: string;
  activeCategory: MentionCategoryFilter;
  setActiveCategory: (filter: MentionCategoryFilter) => void;
  groups: MentionResultGroup<T>[];
  hasResults: boolean;
  selectedItems: T[];
  selectedKeys: ReadonlySet<string>;
  onTextareaChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: () => void;
  onTextareaKeyUp: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaFocus: () => void;
  onTextareaKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  pickItem: (item: T) => void;
  removeItem: (item: T) => void;
  closeMention: () => void;
}

/** Re-focus the textarea and place the cursor after a pick (the picker never takes focus). */
function restoreTextareaCursor({ textarea, cursor }: {
  textarea: HTMLTextAreaElement | null;
  cursor: number;
}) {
  requestAnimationFrame(() => {
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  });
}

type MentionSetter = (next: MentionTriggerMatch | null) => void;

interface TextareaHandlersParams {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  mention: MentionTriggerMatch | null;
  setMention: MentionSetter;
  triggerChar: string;
  onValueChange: (next: string) => void;
}

/** Trigger-detection handlers for the mention-enabled textarea. */
function useMentionTextareaHandlers({
  textareaRef,
  mention,
  setMention,
  triggerChar,
  onValueChange,
}: TextareaHandlersParams) {
  const refreshFromTextarea = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setMention(readMentionTrigger({ value: textarea.value, cursor: textarea.selectionStart ?? textarea.value.length }, { triggerChar }));
  };

  const onTextareaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    onValueChange(nextValue);
    setMention(readMentionTrigger({ value: nextValue, cursor: event.target.selectionStart ?? nextValue.length }, { triggerChar }));
  };

  const onTextareaKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && mention) {
      event.preventDefault();
      setMention(null);
    }
  };

  // The textarea content/cursor are unchanged by an Escape press, so a
  // same-key `keyup`-driven re-read of the trigger (see `onTextareaKeyUp`
  // below) would otherwise immediately re-detect the still-live `@token`
  // and reopen the mention that `onTextareaKeyDown` just closed. Skip the
  // refresh specifically for the key that just closed it.
  const onTextareaKeyUp = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') return;
    refreshFromTextarea();
  };

  return { refreshFromTextarea, onTextareaChange, onTextareaKeyDown, onTextareaKeyUp };
}

/** The multi-select "context chips" set: add on pick, remove on chip click. */
function useMentionSelection<T extends MentionItem>(
  onSelectionChange: ((selected: T[]) => void) | undefined,
) {
  const [selectedItems, setSelectedItems] = useState<T[]>([]);

  const addItem = (item: T) => {
    setSelectedItems((current) => {
      if (current.some((existing) => mentionSelectionKey({ categoryId: existing.category, itemId: existing.id }) === mentionSelectionKey({ categoryId: item.category, itemId: item.id }))) {
        return current;
      }
      const next = [...current, item];
      onSelectionChange?.(next);
      return next;
    });
  };

  const removeItem = (item: T) => {
    setSelectedItems((current) => {
      const key = mentionSelectionKey({ categoryId: item.category, itemId: item.id });
      const next = current.filter((existing) => mentionSelectionKey({ categoryId: existing.category, itemId: existing.id }) !== key);
      onSelectionChange?.(next);
      return next;
    });
  };

  const selectedKeys = useMemo(
    () => new Set(selectedItems.map((item) => mentionSelectionKey({ categoryId: item.category, itemId: item.id }))),
    [selectedItems],
  );

  return { selectedItems, selectedKeys, addItem, removeItem };
}

interface MentionResultsParams<T extends MentionItem> {
  items: T[];
  categories: MentionCategory[];
  activeCategory: MentionCategoryFilter;
  query: string;
  getSearchText: ((item: T) => string) | undefined;
  maxResultsPerCategory: number;
}

/** Filtered + per-category-grouped results for the active query. */
function useMentionResults<T extends MentionItem>({
  items,
  categories,
  activeCategory,
  query,
  getSearchText,
  maxResultsPerCategory,
}: MentionResultsParams<T>) {
  // Filter the full candidate set first (uncapped — `items.length` as the
  // cap is a no-op ceiling), then let `groupItemsByCategory` apply the
  // per-category cap independently, matching the vendored picker's
  // per-kind `.slice(0, 10)` rather than one shared cap across every
  // category combined.
  const filteredItems = useMemo(
    () => filterMentionItems({ items, query }, { getSearchText, maxResults: items.length }),
    [items, query, getSearchText],
  );
  return useMemo(
    () => groupItemsByCategory({ items: filteredItems, categories }, { activeFilter: activeCategory, maxItemsPerCategory: maxResultsPerCategory }),
    [filteredItems, categories, activeCategory, maxResultsPerCategory],
  );
}

/**
 * Owns a mention-enabled textarea's trigger-detection state (which `@token`
 * is currently in progress), the active category tab, the filtered/grouped
 * results, the multi-select "context chips" set (add on pick, remove on
 * chip click — the vendored picker's `selectedSkillIds`/`selectedPluginIds`/
 * etc. arrays, generalized to one `T[]` list keyed by `category:id`), and
 * the splice-in-a-token pick flow (including restoring focus+cursor to the
 * textarea after a pick, since the picker itself never takes focus — it's
 * driven by `onMouseDown`/`preventDefault` the same way the vendored picker
 * was).
 *
 * Deliberately i18n-free (returns plain data only) — see this package's
 * i18n policy on why a hook shouldn't thread `useT()` through effect/callback
 * dependencies. The presentational layer translates category labels itself.
 */
export function useMentionAutocomplete<T extends MentionItem>({
  value,
  onValueChange,
  items,
  categories,
  onSelectionChange,
  triggerChar = DEFAULT_TRIGGER_CHAR,
  getSearchText,
  maxResultsPerCategory = DEFAULT_MAX_RESULTS_PER_CATEGORY,
}: UseMentionAutocompleteParams<T>): UseMentionAutocompleteResult<T> {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mention, setMention] = useState<MentionTriggerMatch | null>(null);
  const [activeCategory, setActiveCategory] = useState<MentionCategoryFilter>('all');
  const { selectedItems, selectedKeys, addItem, removeItem } = useMentionSelection(onSelectionChange);
  const handlers = useMentionTextareaHandlers({ textareaRef, mention, setMention, triggerChar, onValueChange });

  const closeMention = () => setMention(null);

  useDismissOnOutsideOrEscape({ onDismiss: closeMention }, { enabled: mention !== null, containerRef });

  const pickItem = (item: T) => {
    const { nextValue, cursor } = insertMentionToken({ value, match: mention, token: buildMentionToken({ label: item.label }, { triggerChar }) });
    onValueChange(nextValue);
    setMention(null);
    addItem(item);
    restoreTextareaCursor({ textarea: textareaRef.current, cursor });
  };

  const query = (mention?.query ?? '').trim();
  const groups = useMentionResults({ items, categories, activeCategory, query, getSearchText, maxResultsPerCategory });

  return {
    textareaRef,
    containerRef,
    mention,
    isOpen: mention !== null,
    query,
    activeCategory,
    setActiveCategory,
    groups,
    hasResults: hasAnyResults({ groups }),
    selectedItems,
    selectedKeys,
    onTextareaChange: handlers.onTextareaChange,
    onTextareaClick: handlers.refreshFromTextarea,
    onTextareaKeyUp: handlers.onTextareaKeyUp,
    onTextareaFocus: closeMention,
    onTextareaKeyDown: handlers.onTextareaKeyDown,
    pickItem,
    removeItem,
    closeMention,
  };
}
