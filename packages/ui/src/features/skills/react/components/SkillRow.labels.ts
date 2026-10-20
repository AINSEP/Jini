import type { SkillRowLabels } from './SkillRow.js';

/** The row's own label keys (the inline edit form resolves its own). */
export type SkillRowOwnLabelKey =
  | 'expandLabel'
  | 'collapseLabel'
  | 'editLabel'
  | 'overrideCreateLabel'
  | 'deleteLabel'
  | 'deleteConfirmLabel'
  | 'cancelLabel'
  | 'enableToggleLabel'
  | 'loadingLabel'
  | 'filesHeading'
  | 'noFilesLabel'
  | 'bodyHeading'
  | 'userBadge'
  | 'overrideWarning';

export type ResolvedSkillRowLabels = Required<Pick<SkillRowLabels, SkillRowOwnLabelKey>>;

/** Untranslated defaults for every row label; see `resolveLabels`. */
export const DEFAULT_SKILL_ROW_LABELS: ResolvedSkillRowLabels = {
  expandLabel: 'Expand',
  collapseLabel: 'Collapse',
  editLabel: 'Edit',
  overrideCreateLabel: 'Create override',
  deleteLabel: 'Delete',
  deleteConfirmLabel: 'Confirm delete',
  cancelLabel: 'Cancel',
  enableToggleLabel: 'Enabled',
  loadingLabel: 'Loading…',
  filesHeading: 'Files',
  noFilesLabel: 'No files.',
  bodyHeading: 'SKILL.md',
  userBadge: 'user',
  overrideWarning: 'This skill ships with the host. Editing it creates your own copy — the original is unaffected.',
};
