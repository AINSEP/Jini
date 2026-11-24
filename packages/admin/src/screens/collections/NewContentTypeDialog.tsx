import { Dialog } from "../../react/kit.js";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { NewContentTypeDialogController } from "./hooks/use-new-content-type-dialog.hooks.js";
import { ContentTypeFieldsSection } from "./ContentTypeFieldsSection.js";


// ---------------------------------------------------------------------------
// New content type modal (design-spec.md §1.3 — recommended modal, applied here per §6)
// ---------------------------------------------------------------------------

export interface NewContentTypeDialogProps {
  onCreated: () => void;
  onCancel: () => void;
  /** The dialog's state/submit hook. The host binds `useNewContentTypeDialog` to its port, locale
   *  and collections kit (a test passes a fake); see `PostsProps.usePostsHook` for the convention. */
  useNewContentTypeDialogHook: (props: { onCreated: () => void; onCancel: () => void }) => NewContentTypeDialogController;
  /** Translator closure — see `Collections()`'s own `t`. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

function renderNewContentTypeFields(
  { label, t, setLabel, key, setKey, fields, fieldHandles, updateField, removeField, addField, error }:
    Pick<NewContentTypeDialogController, "label" | "setLabel" | "key" | "setKey" | "fields" | "updateField"
    | "removeField" | "addField" | "error"> &
    Pick<NewContentTypeDialogProps, "t"> &
    { fieldHandles: ReturnType<typeof buildAgentListHandles> }
) {
  return (
    <div className="jini-dialog-body">
    <div className="jini-field">
      <label className="jini-field-label" htmlFor="ct-label">{t({ key: "Label" })}</label>
      <input
        id="ct-label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t({ key: "e.g. Recipe" })}
        data-jini-autofocus=""
        {...agentHandle({ handle: "new-content-type-label" }, { role: "field", label: "This content type's display name" })}
      />
    </div>

    <div className="jini-field">
      <label className="jini-field-label" htmlFor="ct-key">{t({ key: "Key" })}</label>
      <input
        id="ct-key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="e.g. recipe"
        {...agentHandle({ handle: "new-content-type-key" }, {
          role: "field",
          label: "This content type's machine key — used in its entries' URLs",
        })}
      />
    </div>

    <ContentTypeFieldsSection
      fields={fields}
      fieldHandles={fieldHandles}
      idPrefix="ct-field"
      handlePrefix="new-content-type"
      showRemoveButton={fields.length > 1}
      removeButtonLabel={t({ key: "Remove this field from the new content type" })}
      updateField={updateField}
      removeField={removeField}
      addField={addField}
      error={error}
      t={t}
    />

    </div>
  );
}

/**
 * Creates a content type. The host imports its native-dialog stylesheet at the screen mount; this
 * component emits only `jini-*` classes (`jini-collections-dialog` is the host-styled dialog shell,
 * `jini-collections-type-dialog` its wider variant).
 */
export function NewContentTypeDialog(props: NewContentTypeDialogProps) {
  const { onCreated, onCancel, t } = props;
  const { label, setLabel, key, setKey, fields, updateField, removeField, addField, error, saving, submit, cancel } =
    props.useNewContentTypeDialogHook({ onCreated, onCancel });
  const fieldHandles = buildAgentListHandles({ prefix: "new-content-type-field", ids: fields.map((f) => String(f._rowId)) }
  );

  return (
    <Dialog open title={t({ key: "New content type" })} onClose={() => cancel()} pending={saving}
      className="jini-collections-dialog jini-domain-dialog jini-collections-type-dialog">
      <form
        onSubmit={submit}
        {...agentHandle({ handle: "new-content-type-dialog" }, {
          role: "region",
          label: "New content type dialog — its label, key, and field schema",
        })}
      >
        {renderNewContentTypeFields({ label, t, setLabel, key, setKey, fields, fieldHandles, updateField, removeField, addField, error })}
        <div className="jini-dialog-footer jini-editor-actions">
          <button
            type="button"
            className="jini-btn-secondary"
            onClick={cancel}
            disabled={saving}
            {...agentHandle({ handle: "new-content-type-cancel" }, { role: "button", label: "Close this dialog without creating a content type" })}
          >
            {t({ key: "Cancel" })}
          </button>
          <button
            type="submit"
            disabled={saving}
            {...agentHandle({ handle: "new-content-type-submit" }, { role: "button", label: "Create this content type" })}
          >
            {saving ? t({ key: "Saving…" }) : t({ key: "Create content type" })}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
