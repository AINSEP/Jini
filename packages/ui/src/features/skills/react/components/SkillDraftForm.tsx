import type { SkillDraft, SkillDraftError } from '../../types.js';
import { useT } from '../../../i18n/index.js';

export interface SkillDraftFormLabels {
  nameLabel?: string;
  namePlaceholder?: string;
  triggersLabel?: string;
  triggersPlaceholder?: string;
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
  bodyLabel?: string;
  bodyPlaceholder?: string;
  cancelLabel?: string;
  createLabel?: string;
  saveLabel?: string;
  overrideSaveLabel?: string;
  savingLabel?: string;
  nameRequiredError?: string;
  bodyRequiredError?: string;
}

export interface SkillDraftFormProps {
  heading: string;
  subheading?: string | null;
  draft: SkillDraft;
  onDraftChange: (updater: (draft: SkillDraft) => SkillDraft) => void;
  error: SkillDraftError | null;
  saving: boolean;
  isEdit: boolean;
  /** Editing a built-in skill: the submit button reads "Save as override". */
  isBuiltInOverride?: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  labels?: SkillDraftFormLabels | undefined;
}

/**
 * The create/edit form for one skill — shared between the top-of-list
 * "New skill" panel and an expanded row's inline edit. Origin:
 * `SkillDraftForm` in `SkillsSection.tsx`.
 */
export function SkillDraftForm({
  heading,
  subheading,
  draft,
  onDraftChange,
  error,
  saving,
  isEdit,
  isBuiltInOverride = false,
  onCancel,
  onSubmit,
  labels,
}: SkillDraftFormProps) {
  const t = useT();
  const nameLabel = labels?.nameLabel ?? t('Name');
  const namePlaceholder = labels?.namePlaceholder ?? t('my-skill');
  const triggersLabel = labels?.triggersLabel ?? t('Triggers');
  const triggersPlaceholder = labels?.triggersPlaceholder ?? t('search the web, summarize');
  const descriptionLabel = labels?.descriptionLabel ?? t('Description');
  const descriptionPlaceholder = labels?.descriptionPlaceholder ?? t('What does this skill do? When should it be used?');
  const bodyLabel = labels?.bodyLabel ?? t('Body');
  const bodyPlaceholder = labels?.bodyPlaceholder ?? t('# My skill\n\n1. Explain the workflow.\n2. Describe the inputs and outputs.');
  const cancelLabel = labels?.cancelLabel ?? t('Cancel');
  const createLabel = labels?.createLabel ?? t('Create');
  const saveLabel = labels?.saveLabel ?? t('Save');
  const overrideSaveLabel = labels?.overrideSaveLabel ?? t('Save as override');
  const savingLabel = labels?.savingLabel ?? t('Saving…');
  const nameRequiredError = labels?.nameRequiredError ?? t('Name is required.');
  const bodyRequiredError = labels?.bodyRequiredError ?? t('Body is required.');

  const submitLabel = saving ? savingLabel : isEdit ? (isBuiltInOverride ? overrideSaveLabel : saveLabel) : createLabel;
  const errorText =
    error?.kind === 'name-required' ? nameRequiredError : error?.kind === 'body-required' ? bodyRequiredError : (error?.message ?? null);

  return (
    <div className="jini-settings-subsection jini-skills-draft" data-testid={isEdit ? 'skills-edit-form' : 'skills-create-form'}>
      <div className="jini-section-head">
        <div>
          <h4>{heading}</h4>
          {subheading ? <p className="jini-hint">{subheading}</p> : null}
        </div>
      </div>

      <div className="jini-settings-field">
        <label>
          <span>{nameLabel}</span>
          <input
            type="text"
            value={draft.name}
            onChange={(event) => onDraftChange((current) => ({ ...current, name: event.target.value }))}
            placeholder={namePlaceholder}
            disabled={isEdit}
          />
        </label>
      </div>

      <div className="jini-settings-field">
        <label>
          <span>{triggersLabel}</span>
          <input
            type="text"
            value={draft.triggers}
            onChange={(event) => onDraftChange((current) => ({ ...current, triggers: event.target.value }))}
            placeholder={triggersPlaceholder}
          />
        </label>
      </div>

      <div className="jini-settings-field">
        <label>
          <span>{descriptionLabel}</span>
          <textarea
            rows={2}
            value={draft.description}
            onChange={(event) => onDraftChange((current) => ({ ...current, description: event.target.value }))}
            placeholder={descriptionPlaceholder}
          />
        </label>
      </div>

      <div className="jini-settings-field">
        <label>
          <span>{bodyLabel}</span>
          <textarea
            rows={14}
            value={draft.body}
            onChange={(event) => onDraftChange((current) => ({ ...current, body: event.target.value }))}
            placeholder={bodyPlaceholder}
          />
        </label>
      </div>

      {errorText ? (
        <p className="jini-hint jini-hint-error" role="alert">
          {errorText}
        </p>
      ) : null}

      <div className="jini-skills-draft-actions">
        <button type="button" className="jini-button jini-button-ghost" onClick={onCancel} disabled={saving}>
          {cancelLabel}
        </button>
        <button type="button" className="jini-button jini-button-primary" onClick={onSubmit} disabled={saving} data-testid="skills-save">
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
