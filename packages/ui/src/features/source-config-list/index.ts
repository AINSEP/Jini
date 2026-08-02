export {
  MASK_CHAR,
  MASKED_VALUE_MIN_MASK_LENGTH,
  MASKED_VALUE_VISIBLE_SUFFIX_LENGTH,
} from './constants.js';
export {
  createFakeSourceConfigDependencies,
  createFakeSourceConfigPort,
  type FakeSourceConfigPortOptions,
} from './dependencies.js';
export type { SourceConfigDependencies, SourceConfigPort } from './ports.js';
export {
  emptySourceDraft,
  isActionPending,
  issueForField,
  maskFieldValue,
  pendingActionKey,
  removeSourceById,
  sourceDisplayLabel,
  updateSourceById,
  upsertSourceById,
  validateSourceDraft,
  withoutPendingAction,
  withPendingAction,
} from './rules.js';
export type {
  AddSourceInput,
  AddSourceResult,
  SourceActionKind,
  SourceConfigItem,
  SourceConnectionStatus,
  SourceDraftIssue,
  SourceDraftValidation,
  SourceFieldKind,
  SourceFieldOption,
  SourceFieldSpec,
  SourceFieldValues,
  SourceTestResult,
  SourceTrustOption,
} from './types.js';

export { useSourceConfigList, useWiredSourceConfigList } from './react/hooks/useSourceConfigList.js';
export type {
  SourceConfigListCapabilities,
  SourceConfigListController,
  UseSourceConfigListParams,
  UseWiredSourceConfigListParams,
} from './react/hooks/useSourceConfigList.js';
export { useSourceConfigAddForm, useWiredSourceConfigAddForm } from './react/hooks/useSourceConfigAddForm.js';
export type {
  SourceConfigAddFormController,
  UseSourceConfigAddFormParams,
  UseWiredSourceConfigAddFormParams,
} from './react/hooks/useSourceConfigAddForm.js';
export { SourceConfigField } from './react/components/SourceConfigField.js';
export type { SourceConfigFieldProps } from './react/components/SourceConfigField.js';
export { SourceConfigTestControl } from './react/components/SourceConfigTestControl.js';
export type { SourceConfigTestControlProps } from './react/components/SourceConfigTestControl.js';
export { SourceConfigAddForm } from './react/components/SourceConfigAddForm.js';
export type { SourceConfigAddFormProps } from './react/components/SourceConfigAddForm.js';
export { SourceConfigItemCard } from './react/components/SourceConfigItemCard.js';
export type { SourceConfigItemCardProps } from './react/components/SourceConfigItemCard.js';
export { SourceConfigListView } from './react/components/SourceConfigListView.js';
export type { SourceConfigListViewProps } from './react/components/SourceConfigListView.js';
export { SourceConfigList } from './react/components/SourceConfigList.js';
export type { SourceConfigListProps } from './react/components/SourceConfigList.js';
