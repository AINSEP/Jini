import { useT } from '../../../i18n/index.js';
import { ALL_CATEGORY_FILTER } from '../../constants.js';
import type { MentionCategory, MentionCategoryFilter } from '../../types.js';

export interface MentionCategoryTabsProps {
  categories: MentionCategory[];
  active: MentionCategoryFilter;
  onChange: (filter: MentionCategoryFilter) => void;
  /** Label for the built-in "show every category" tab. Plain English,
   *  passed through `useT()`. Defaults to `'All'`. */
  allLabel?: string;
  useTHook?: typeof useT;
}

/** The `'All' | <category>...` tab row above the grouped result list. */
export function MentionCategoryTabs({ categories, active, onChange, allLabel = 'All', useTHook = useT }: MentionCategoryTabsProps) {
  const t = useTHook();
  return (
    <div className="jini-mention-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={active === ALL_CATEGORY_FILTER}
        className={`jini-mention-tab${active === ALL_CATEGORY_FILTER ? ' is-active' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
          onChange(ALL_CATEGORY_FILTER);
        }}
      >
        {t(allLabel)}
      </button>
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          role="tab"
          aria-selected={active === category.id}
          className={`jini-mention-tab${active === category.id ? ' is-active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onChange(category.id);
          }}
        >
          {t(category.label)}
        </button>
      ))}
    </div>
  );
}
