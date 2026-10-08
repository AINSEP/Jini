import { useFormFieldsBodyView } from "../hooks/forms-view.hooks.js";
import type { AdminFormDefinition, AdminFormField } from '../../models.js';
import { agentHandle } from '@jini-ai/agentic';
import { FormFieldsEditor } from "./FormFieldsEditor.js";
export interface FormEditorFieldsBodyProps {
  name: string;
  onNameChange: (value: string) => void;
  slug: string;
  onSlugChange: (value: string) => void;
  isNew: boolean;
  fields: AdminFormField[];
  existingFieldIds: string[];
  onFieldsChange: (fields: AdminFormField[]) => void;
  form: AdminFormDefinition | null;
  saving: boolean;
  onStatusToggle: () => void;
  onSave: () => void;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
  mode: "builder" | "html";
  onModeChange: (mode: "builder" | "html") => void;
  html: string;
  onHtmlChange: (html: string) => void;
  onCopyEmbed: () => void;
  copyFeedback: string | null;
}

export function FormEditorFieldsBody(props: FormEditorFieldsBodyProps, _optional = {}) {
  const handlers = useFormFieldsBodyView(props);
  const {
    name,
    onNameChange,
    slug,
    onSlugChange,
    isNew,
    fields,
    existingFieldIds,
    onFieldsChange,
    form,
    saving,
    onStatusToggle,
    onSave,
    t,
    mode, onModeChange, html, onHtmlChange, onCopyEmbed, copyFeedback,
  } = props;

  return (
    <>
      <div className="field-group">
        <div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor="form-name">
              {t("Name")}
            </label>
            <input
              id="form-name"
              value={name}
              onChange={handlers.onName}
              {...agentHandle({ handle: "form-editor-name" }, { role: "field", label: "This form's display name" })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="form-slug">
              {t("Slug")}
            </label>
            <input
              id="form-slug"
              value={slug}
              disabled={!isNew}
              onChange={handlers.onSlug}
              {...agentHandle({ handle: "form-editor-slug" }, {
                role: "field",
                label: "This form's URL slug — only editable while creating a new form",
              })}
            />
          </div>
        </div>
      </div>

      <div className="field-group">
        <div className="segmented" role="group" aria-label={t("Form authoring mode")}>
          <button type="button" className={mode === "builder" ? "is-active" : ""} aria-pressed={mode === "builder"} onClick={handlers.onBuilder}>{t("Builder")}</button>
          <button type="button" className={mode === "html" ? "is-active" : ""} aria-pressed={mode === "html"} onClick={handlers.onHtmlMode}>{t("HTML")}</button>
        </div>
        {mode === "html" ? (
          <textarea className="page-html-source" value={html} onChange={handlers.onHtml} spellCheck={false} aria-label={t("Form HTML")} />
        ) : (
          <div className="table-scroll">
            <FormFieldsEditor fields={fields} existingFieldIds={existingFieldIds} onChange={onFieldsChange} t={t} />
          </div>
        )}
      </div>

      {/* `form-actions` is a spacing-only hook layered on top of the shared `.editor-actions`
          flex row. `.editor-actions` sets direction/gap/alignment but no top margin, and this row
          is not a `.field-group`, so the `.field-group + .field-group` rhythm that separates every
          other block on this screen skips it — leaving Disable/Save flush against the Recipients
          input. Fixed here rather than by adding a margin to `.editor-actions` itself, because that
          class is shared with the other editor screens and a global change would shift spacing on
          screens nobody has looked at yet. */}
      <div className="editor-actions form-actions">
        {form ? <button type="button" className="btn-secondary" onClick={onCopyEmbed}>{t("Copy HTML embed")}</button> : null}
        {copyFeedback ? <span role="status">{copyFeedback}</span> : null}
        {!isNew && form ? (
          // Reversible-but-access-affecting (turns off the live site's ability to accept
          // submissions through this form) — `.btn-warning`, not `.btn-danger`: nothing is
          // deleted, and the same control flips right back to "Enable". Re-enabling is the safe
          // direction, so it stays `.btn-secondary` rather than inheriting the warning look.
          <button
            type="button"
            className={form.status === "active" ? "btn-warning" : "btn-secondary"}
            disabled={saving}
            onClick={onStatusToggle}
            {...agentHandle({ handle: "form-editor-status-toggle" }, {
              role: "button",
              label:
                "Disable or re-enable this form — disabling stops it accepting new submissions without deleting it",
            })}
          >
            {form.status === "active" ? t("Disable") : t("Enable")}
          </button>
        ) : null}
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          {...agentHandle({ handle: "form-editor-save" }, {
            role: "button",
            label: "Save this form's name, slug, fields and notification settings",
          })}
        >
          {isNew ? t("Create form") : t("Save")}
        </button>
      </div>
    </>
  );
}

/** The page-header title/description text — split out because `FormEditor`'s isNew-dependent copy
 * (two ternaries, one with a `||` fallback) is otherwise indistinguishable, in the complexity
 * count, from the branches that actually decide what's on screen. */
