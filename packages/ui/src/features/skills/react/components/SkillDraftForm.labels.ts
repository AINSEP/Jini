import type { SkillDraftError } from '../../types.js';
import type { SkillDraftFormLabels } from './SkillDraftForm.js';

/** Every `SkillDraftFormLabels` key with its untranslated default. A host
 *  label wins; otherwise the default is passed through `t` (lazily, only
 *  when the host left that label out). */
const DEFAULT_SKILL_DRAFT_FORM_LABELS: Required<SkillDraftFormLabels> = {
  nameLabel: 'Name',
  namePlaceholder: 'my-skill',
  triggersLabel: 'Triggers',
  triggersPlaceholder: 'search the web, summarize',
  descriptionLabel: 'Description',
  descriptionPlaceholder: 'What does this skill do? When should it be used?',
  bodyLabel: 'Body',
  bodyPlaceholder: '# My skill\n\n1. Explain the workflow.\n2. Describe the inputs and outputs.',
  cancelLabel: 'Cancel',
  createLabel: 'Create',
  saveLabel: 'Save',
  overrideSaveLabel: 'Save as override',
  savingLabel: 'Saving…',
  nameRequiredError: 'Name is required.',
  bodyRequiredError: 'Body is required.',
};

/** The form's labels with every gap filled from the translated defaults. */
export function resolveSkillDraftFormLabels(
  { t }: { t: (key: string) => string },
  { labels }: { labels?: SkillDraftFormLabels | undefined },
): Required<SkillDraftFormLabels> {
  const resolved = { ...DEFAULT_SKILL_DRAFT_FORM_LABELS };
  for (const key of Object.keys(resolved) as (keyof SkillDraftFormLabels)[]) {
    resolved[key] = labels?.[key] ?? t(DEFAULT_SKILL_DRAFT_FORM_LABELS[key]);
  }
  return resolved;
}

/** Saving wins over everything; then edit (override vs. plain save) vs. create. */
export function skillDraftSubmitLabel({
  labels,
  saving,
  isEdit,
  isBuiltInOverride,
}: {
  labels: Required<SkillDraftFormLabels>;
  saving: boolean;
  isEdit: boolean;
  isBuiltInOverride: boolean;
}): string {
  if (saving) return labels.savingLabel;
  if (!isEdit) return labels.createLabel;
  return isBuiltInOverride ? labels.overrideSaveLabel : labels.saveLabel;
}

/** The alert text for `error`: the two validation kinds use their labels, a
 *  submit failure shows the host's own message; `null` means no alert. */
export function skillDraftErrorText({
  labels,
  error,
}: {
  labels: Required<SkillDraftFormLabels>;
  error: SkillDraftError | null;
}): string | null {
  if (error === null) return null;
  if (error.kind === 'name-required') return labels.nameRequiredError;
  if (error.kind === 'body-required') return labels.bodyRequiredError;
  return error.message;
}
