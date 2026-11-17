import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { mentionSelectionKey } from '../../rules.js';
import type { MentionItem } from '../../types.js';

export interface SelectedMentionChipsProps<T extends MentionItem<ReactNode>> {
  items: T[];
  onRemove: (item: T) => void;
  /** Rendered at the end of every chip, after the label — typically a
   *  small "x" close icon. */
  removeIcon?: ReactNode | undefined;
}

/** The row of removable chips for every currently-selected mention item. */
export function SelectedMentionChips<T extends MentionItem<ReactNode>>({
  items,
  onRemove,
  removeIcon,
  useTHook = useT,
}: SelectedMentionChipsProps<T> & { useTHook?: typeof useT }) {
  const t = useTHook();
  if (items.length === 0) return null;

  return (
    <div className="jini-mention-selected" aria-label={t('Selected context')}>
      {items.map((item) => (
        <button
          key={mentionSelectionKey(item.category, item.id)}
          type="button"
          className={`jini-mention-selected__chip is-${item.category}`}
          onClick={() => onRemove(item)}
          title={t('Remove {label}', { label: item.label })}
        >
          {item.icon}
          <span>{item.label}</span>
          {removeIcon}
        </button>
      ))}
    </div>
  );
}
