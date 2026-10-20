import type { SkillsTabLabels } from './SkillsTab.js';

/** The tab's own plain labels. `loadErrorLabel` is resolved separately in
 *  `SkillsTab` because its default interpolates the load error. */
export type ResolvedSkillsTabLabels = Required<
  Pick<
    SkillsTabLabels,
    'searchPlaceholder' | 'newSkillLabel' | 'sourceFilterLabel' | 'modeFilterLabel' | 'categoryFilterLabel' | 'allLabel' | 'noResultsLabel'
  >
>;

/** Untranslated defaults for the tab's own labels; see `resolveLabels`. */
export const DEFAULT_SKILLS_TAB_LABELS: ResolvedSkillsTabLabels = {
  searchPlaceholder: 'Search skills…',
  newSkillLabel: 'New skill',
  sourceFilterLabel: 'Source',
  modeFilterLabel: 'Type',
  categoryFilterLabel: 'Category',
  allLabel: 'All',
  noResultsLabel: 'No skills match these filters.',
};
