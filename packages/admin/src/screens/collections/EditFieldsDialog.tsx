import { type AdminContentType } from "./api/collections-api.types.js";
import { Dialog } from "../../react/kit.js";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { EditFieldsDialogController } from "./hooks/use-edit-fields-dialog.hooks.js";
import { ContentTypeFieldsSection } from "./ContentTypeFieldsSection.js";


// ---------------------------------------------------------------------------
// Edit fields dialog (REQ-05 — post-creation field-schema editing)
// ---------------------------------------------------------------------------

export interface EditFieldsDialogProps {
  contentType: AdminContentType;
  onSaved: () => void;
  onCancel: () => void;
  /** The dialog's state/submit hook. The host binds `useEditFieldsDialog` to its port, translator
   *  and collections kit (a test passes a fake); see `PostsProps.usePostsHook` for the convention. */
  useEditFieldsDialogHook: (props: { contentType: AdminContentType; onSaved: () => void; onCancel: () => void }) => EditFieldsDialogController;
  /** Translator closure — see `Collections()`'s own `t`. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

/**
 * Edits an existing content type's field schema. The host imports its native-dialog stylesheet at
 * the screen mount; this component emits only `jini-*` classes (see `NewContentTypeDialog`).
 */
export function EditFieldsDialog(props: EditFieldsDialogProps) {
  const { contentType, onSaved, onCancel, t } = props;
  const { fields, updateField, removeField, addField, error, saving, submit, cancel } = props.useEditFieldsDialogHook({
    contentType,
    onSaved,
    onCancel,
  });
  const fieldHandles = buildAgentListHandles({ prefix: "edit-fields-field", ids: fields.map((f) => String(f._rowId)) }
  );

  return (
    <Dialog open title={`${t({ key: "Edit fields —" })} ${contentType.label}`} onClose={() => cancel()} pending={saving}
      className="jini-collections-dialog jini-domain-dialog jini-collections-type-dialog">
      <form
        onSubmit={submit}
        {...agentHandle({ handle: "edit-fields-dialog" }, {
          role: "region",
          label: "Edit fields dialog — this content type's full field schema",
        })}
      >
        <div className="jini-dialog-body">
        <ContentTypeFieldsSection
          fields={fields}
          fieldHandles={fieldHandles}
          idPrefix="ct-edit-field"
          handlePrefix="edit-fields"
          showRemoveButton={true}
          removeButtonLabel={t({ key: "Remove this field from this content type" })}
          updateField={updateField}
          removeField={removeField}
          addField={addField}
          error={error}
          t={t}
        />

        </div>
        <div className="jini-dialog-footer jini-editor-actions">
          <button
            type="button"
            className="jini-btn-secondary"
            onClick={cancel}
            disabled={saving}
            data-jini-autofocus=""
            {...agentHandle({ handle: "edit-fields-cancel" }, { role: "button", label: "Close this dialog without saving field changes" })}
          >
            {t({ key: "Cancel" })}
          </button>
          <button
            type="submit"
            disabled={saving}
            {...agentHandle({ handle: "edit-fields-submit" }, { role: "button", label: "Save this content type's field schema" })}
          >
            {saving ? t({ key: "Saving…" }) : t({ key: "Save fields" })}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
