import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { mentionSelectionKey } from '../../rules.js';
import { MentionResultItem } from './MentionResultItem.js';
import type { MentionResultGroup } from '../../rules.js';
import type { MentionItem } from '../../types.js';

export interface MentionResultsListProps<T extends MentionItem<ReactNode>> {
  groups: MentionResultGroup<T>[];
  hasResults: boolean;
  query: string;
  selectedIds: ReadonlySet<string>;
  onPick: (item: T) => void;
  selectedIcon?: ReactNode | undefined;
  /** Plain-English placeholder shown while the query is empty. Defaults to
   *  a generic prompt naming every category. */
  emptyPlaceholder?: string | undefined;
}

/** The grouped, tabbed result sections (or an empty-state message). */
export function MentionResultsList<T extends MentionItem<ReactNode>>({
  groups,
  hasResults,
  query,
  selectedIds,
  onPick,
  selectedIcon,
  emptyPlaceholder = 'Start typing to search.',
  useTHook = useT,
}: MentionResultsListProps<T> & { useTHook?: typeof useT }) {
  const t = useTHook();

  return (
    <div className="jini-mention-results">
      {!hasResults ? (
        <div className="jini-mention-empty">
          {query ? t('No results for "{query}".', { query }) : t(emptyPlaceholder)}
        </div>
      ) : null}
      {groups.map((group) => (
        <div className="jini-mention-section" key={group.category.id}>
          <div className="jini-mention-section__label">{t(group.category.label)}</div>
          <div className="jini-mention-section__items">
            {group.items.map((item) => (
              <MentionResultItem
                key={mentionSelectionKey(group.category.id, item.id)}
                item={item}
                selected={selectedIds.has(mentionSelectionKey(group.category.id, item.id))}
                onPick={() => onPick(item)}
                selectedIcon={selectedIcon}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
