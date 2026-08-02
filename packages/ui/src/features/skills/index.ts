export { createFakeSkillsPort, type FakeSkillsPortOptions } from './dependencies.js';
export type { SkillsPort, SkillWritePayload } from './ports.js';
export {
  EMPTY_SKILL_DRAFT,
  filterSkills,
  formatSkillFileSize,
  hasAnyCategory,
  humanizeSkillCategory,
  isBuiltInSkill,
  isDeletableSkill,
  localizedSkillDescription,
  localizedSkillName,
  parseTriggers,
  skillFileLeafName,
  skillFileTreeIndent,
  type SkillFilterDimension,
  skillFilterOptions,
  skillMatchesFilters,
  skillMatchesSearch,
  summaryToDraft,
  validateSkillDraft,
} from './rules.js';
export type {
  SkillDetail,
  SkillDraft,
  SkillDraftError,
  SkillFileEntry,
  SkillFilterOption,
  SkillFilters,
  SkillSource,
  SkillSummary,
  SourceFilter,
} from './types.js';

export { useSkillsTab } from './react/hooks/useSkillsTab.js';
export type { SkillFilterRow, UseSkillsTabOptions, UseSkillsTabResult } from './react/hooks/useSkillsTab.js';
export { SkillDraftForm } from './react/components/SkillDraftForm.js';
export type { SkillDraftFormLabels, SkillDraftFormProps } from './react/components/SkillDraftForm.js';
export { SkillRow } from './react/components/SkillRow.js';
export type { SkillRowLabels, SkillRowProps } from './react/components/SkillRow.js';
export { SkillsTab } from './react/components/SkillsTab.js';
export type { SkillsTabLabels, SkillsTabProps } from './react/components/SkillsTab.js';
