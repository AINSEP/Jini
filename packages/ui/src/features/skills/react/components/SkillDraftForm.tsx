import { agentHandleProps } from '@jini-ai/agentic';
import type { SkillDraft, SkillDraftError } from '../../types.js';
import { useT } from '../../../i18n/index.js';
import { resolveSkillDraftFormLabels, skillDraftErrorText, skillDraftSubmitLabel } from './SkillDraftForm.labels.js';

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
  /** This form's own agent handle — see `SkillsTab`'s `agentHandle` doc. */
  agentHandle?: string;
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
  agentHandle,
}: SkillDraftFormProps) {
  const l = resolveSkillDraftFormLabels({ t: useT() }, { labels });
  const submitLabel = skillDraftSubmitLabel({ labels: l, saving, isEdit, isBuiltInOverride });
  const errorText = skillDraftErrorText({ labels: l, error });
  const fieldProps = { draft, onDraftChange, agentHandle };

  return (
    <div className="jini-settings-subsection jini-skills-draft" data-testid={isEdit ? 'skills-edit-form' : 'skills-create-form'}>
      <div className="jini-section-head">
        <div>
          <h4>{heading}</h4>
          {subheading ? <p className="jini-hint">{subheading}</p> : null}
        </div>
      </div>

      <SkillDraftField {...fieldProps} field="name" label={l.nameLabel} placeholder={l.namePlaceholder} disabled={isEdit} />
      <SkillDraftField {...fieldProps} field="triggers" label={l.triggersLabel} placeholder={l.triggersPlaceholder} />
      <SkillDraftField
        {...fieldProps}
        field="description"
        label={l.descriptionLabel}
        placeholder={l.descriptionPlaceholder}
        rows={2}
      />
      <SkillDraftField {...fieldProps} field="body" label={l.bodyLabel} placeholder={l.bodyPlaceholder} rows={14} />

      {errorText ? (
        <p className="jini-hint jini-hint-error" role="alert">
          {errorText}
        </p>
      ) : null}

      <div className="jini-skills-draft-actions">
        <button
          type="button"
          className="jini-button jini-button-ghost"
          onClick={onCancel}
          disabled={saving}
          {...agentHandleProps({}, { base: agentHandle, action: 'cancel', role: 'button', label: l.cancelLabel })}
        >
          {l.cancelLabel}
        </button>
        <button
          type="button"
          className="jini-button jini-button-primary"
          onClick={onSubmit}
          disabled={saving}
          data-testid="skills-save"
          {...agentHandleProps({}, { base: agentHandle, action: 'submit', role: 'button', label: submitLabel })}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface SkillDraftFieldProps {
  draft: SkillDraft;
  onDraftChange: SkillDraftFormProps['onDraftChange'];
  agentHandle: string | undefined;
  field: keyof SkillDraft;
  label: string;
  placeholder: string;
  /** Only the Name input is ever disabled (while editing — a skill's name is its id). */
  disabled?: boolean;
  /** Set for the multi-line fields: renders a `<textarea>` instead of an `<input>`. */
  rows?: number;
}

/** One labelled draft field. Attribute order matches the original inline
 *  markup exactly so the rendered HTML is unchanged. */
function SkillDraftField({ draft, onDraftChange, agentHandle, field, label, placeholder, disabled, rows }: SkillDraftFieldProps) {
  const onChange = (event: { target: { value: string } }) =>
    onDraftChange((current) => ({ ...current, [field]: event.target.value }));
  const handle = agentHandleProps({}, { base: agentHandle, action: field, role: 'field', label });
  return (
    <div className="jini-settings-field">
      <label>
        <span>{label}</span>
        {rows === undefined ? (
          <input type="text" value={draft[field]} onChange={onChange} placeholder={placeholder} disabled={disabled} {...handle} />
        ) : (
          <textarea rows={rows} value={draft[field]} onChange={onChange} placeholder={placeholder} {...handle} />
        )}
      </label>
    </div>
  );
}
