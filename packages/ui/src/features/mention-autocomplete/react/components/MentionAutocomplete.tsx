import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { useMentionAutocomplete } from '../hooks/useMentionAutocomplete.js';
import { MentionCategoryTabs } from './MentionCategoryTabs.js';
import { MentionResultsList } from './MentionResultsList.js';
import { SelectedMentionChips } from './SelectedMentionChips.js';
import type { MentionCategory, MentionItem } from '../../types.js';

export interface MentionAutocompleteProps<T extends MentionItem<ReactNode>> {
  value: string;
  onValueChange: (next: string) => void;
  items: T[];
  categories: MentionCategory[];
  onSelectionChange?: ((selected: T[]) => void) | undefined;
  triggerChar?: string | undefined;
  getSearchText?: ((item: T) => string) | undefined;
  maxResultsPerCategory?: number | undefined;
  placeholder?: string | undefined;
  rows?: number | undefined;
  disabled?: boolean | undefined;
  /** Rendered instead of an item's own icon while it's selected in the
   *  results list (typically a check icon). */
  selectedIcon?: ReactNode | undefined;
  /** Rendered at the end of every removable chip (typically a close icon). */
  chipRemoveIcon?: ReactNode | undefined;
  /** Plain-English placeholder shown in the results panel while the query
   *  is empty (before the "no results" state can apply). */
  emptyResultsPlaceholder?: string | undefined;
  /** Accessible label for the results listbox. */
  resultsAriaLabel?: string | undefined;
  /** Custom hook override for dependency injection / testing. */
  useMentionAutocomplete?: typeof useMentionAutocomplete;
}

/**
 * A self-contained "type a trigger character, get a filtered picker" mention
 * autocomplete: a textarea that detects an in-progress `@token`, expanding
 * into a tabbed, multi-category filtered result list, plus a row of
 * removable chips for everything already picked.
 *
 * Origin: the inline `@`-mention/capability-picker from the vendored
 * schedule/mention god-component (recon r6 §1.19) — "directly analogous to
 * the `QuickSwitcher.tsx` precedent." OD-specific only via the capability
 * data types (`SkillSummary`/`InstalledPluginRecord`/`McpServerConfig`/
 * `ConnectorDetail`), replaced here by the generic `MentionItem` shape (see
 * `types.ts`). The form/REST-submission wiring the original component sat
 * inside stays behind in the host, per r6 §1.19's own "OD-specific" list.
 */
export function MentionAutocomplete<T extends MentionItem<ReactNode>>({
  value,
  onValueChange,
  items,
  categories,
  onSelectionChange,
  triggerChar,
  getSearchText,
  maxResultsPerCategory,
  placeholder,
  rows = 8,
  disabled = false,
  selectedIcon,
  chipRemoveIcon,
  emptyResultsPlaceholder,
  resultsAriaLabel,
  useMentionAutocomplete: useMentionAutocompleteHook = useMentionAutocomplete,
}: MentionAutocompleteProps<T>) {
  const t = useT();
  const mention = useMentionAutocompleteHook<T>({
    value,
    onValueChange,
    items,
    categories,
    onSelectionChange,
    triggerChar,
    getSearchText,
    maxResultsPerCategory,
  });

  return (
    <div ref={mention.containerRef} className="jini-mention-autocomplete">
      <div className={`jini-mention-autocomplete__field${mention.isOpen ? ' is-mentioning' : ''}`}>
        <textarea
          ref={mention.textareaRef}
          className="jini-mention-autocomplete__textarea"
          placeholder={placeholder ? t(placeholder) : undefined}
          value={value}
          onChange={mention.onTextareaChange}
          onClick={mention.onTextareaClick}
          onFocus={mention.onTextareaFocus}
          onKeyDown={mention.onTextareaKeyDown}
          onKeyUp={mention.onTextareaKeyUp}
          rows={rows}
          disabled={disabled}
          aria-controls={mention.isOpen ? 'jini-mention-autocomplete-results' : undefined}
          aria-expanded={mention.isOpen}
        />
      </div>

      {mention.isOpen ? (
        <div
          id="jini-mention-autocomplete-results"
          className="jini-mention-autocomplete__popover"
          role="listbox"
          aria-label={resultsAriaLabel ? t(resultsAriaLabel) : t('Autocomplete results')}
          onMouseDown={(e) => e.preventDefault()}
        >
          <MentionCategoryTabs categories={categories} active={mention.activeCategory} onChange={mention.setActiveCategory} />
          <MentionResultsList<T>
            groups={mention.groups}
            hasResults={mention.hasResults}
            query={mention.query}
            selectedIds={mention.selectedKeys}
            onPick={mention.pickItem}
            selectedIcon={selectedIcon}
            emptyPlaceholder={emptyResultsPlaceholder}
          />
        </div>
      ) : null}

      <SelectedMentionChips<T> items={mention.selectedItems} onRemove={mention.removeItem} removeIcon={chipRemoveIcon} />
    </div>
  );
}
