import { agentHandle } from '@jini-ai/agentic';
import { FormFieldsEditor } from "./FormFieldsEditor.js";
import type { useFormFieldsBodyView } from "../hooks/forms-view.hooks.js";
import type { FormEditorFieldsBodyProps } from "./FormEditorFieldsBody.js";

/**
 * @file The two halves of `FormEditorFieldsBody` that branch on its props — the Builder/HTML switch
 * and the action row — split out so each one's branches are counted on their own. Markup only.
 */

type FieldsBodyHandlers = ReturnType<typeof useFormFieldsBodyView>;

/** Builder/HTML switch plus whichever editor the current mode shows. */
export function FormEditorModeSwitch(
  { props, handlers }: { props: FormEditorFieldsBodyProps; handlers: FieldsBodyHandlers },
) {
  const { fields, existingFieldIds, onFieldsChange, t, mode, html } = props;
  return (
    <>
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
    </>
  );
}

/** Copy embed, copy feedback, Disable/Enable (saved forms only) and Save/Create. */
export function FormEditorActions({ props }: { props: FormEditorFieldsBodyProps }) {
  const { isNew, form, saving, onStatusToggle, onSave, t, onCopyEmbed, copyFeedback } = props;
  /* `form-actions` is a spacing-only hook layered on top of the shared `.editor-actions`
     flex row. `.editor-actions` sets direction/gap/alignment but no top margin, and this row
     is not a `.field-group`, so the `.field-group + .field-group` rhythm that separates every
     other block on this screen skips it — leaving Disable/Save flush against the Recipients
     input. Fixed here rather than by adding a margin to `.editor-actions` itself, because that
     class is shared with the other editor screens and a global change would shift spacing on
     screens nobody has looked at yet. */
  return (
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
  );
}
