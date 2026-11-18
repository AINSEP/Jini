import { useFormFieldsView } from "../hooks/forms-view.hooks.js";
import type { AdminFormField } from '../../models.js';
import { agentHandle } from '@jini-ai/core/agent-handles';
import { useFormFieldsEditor } from '../hooks/use-form-fields-editor.hooks.js';
import { FieldAttributesDialog } from "./FieldAttributesDialog.js";
import { FormFieldRow } from "./FormFieldRow.js";
import { FormFieldsTableFoot, FormFieldsTableHead } from "./FormFieldsTableParts.js";
export interface FormFieldsEditorProps {
  fields: AdminFormField[];
  existingFieldIds?: string[];
  onChange: (fields: AdminFormField[]) => void;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useFormFieldsEditorHook?: typeof useFormFieldsEditor;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
  /** Same seam for the row view-model hook. */
  useFormFieldsViewHook?: typeof useFormFieldsView;
}

export function FormFieldsEditor({
  fields,
  existingFieldIds = [],
  onChange,
  useFormFieldsEditorHook = useFormFieldsEditor,
  useFormFieldsViewHook = useFormFieldsView,
  t,
}: FormFieldsEditorProps, _optional: Record<string, never> = {}) {
  const controller = useFormFieldsEditorHook({ fields, onChange });
  const { editingAttrsIndex, closeAttrsDialog, addField } = controller;
  // Field ids are the form's own field vocabulary and are unique once saved, but a freshly-added
  // row starts with an empty id (see `rules.ts`'s `blankField`) — `buildAgentListHandles`'s
  // position fallback covers that case the same way it covers any other unsluggable id. Not
  // `useMemo`d: one form's own field list is small and this is an O(n) pass, cheap enough that
  // memoizing it was not judged worth the added indirection.
  const { rows, editingField, saveAttributes } = useFormFieldsViewHook({ fields, existingFieldIds, controller });

  return (
    <>
      <table
        className="list-table form-fields-table"
        {...agentHandle({ handle: "form-fields-table" }, {
          role: "region",
          label: "This form's field definitions — one row per field, in the order they render on the live form",
        })}
      >
        <FormFieldsTableHead t={t} />
        <tbody>
          {rows.map((row) => (
            <FormFieldRow key={row.index} row={row} t={t} />
          ))}
        </tbody>
        <FormFieldsTableFoot addField={addField} t={t} />
      </table>
      {editingAttrsIndex !== null && editingField ? (
        <FieldAttributesDialog
          field={editingField}
          fieldIndex={editingAttrsIndex}
          onSave={saveAttributes}
          onCancel={closeAttrsDialog}
          t={t}
        />
      ) : null}
    </>
  );
}

