import { useFormFieldsView } from "../hooks/forms-view.hooks.js";
import type { AdminFormField } from '../../models.js';
import { agentHandle } from '@jini-ai/agentic';
import { FIELD_TYPES } from '../../rules.js';
import { useFormFieldsEditor } from '../hooks/use-form-fields-editor.hooks.js';
import { FieldAttributesDialog } from "./FieldAttributesDialog.js";
export interface FormFieldsEditorProps {
  fields: AdminFormField[];
  existingFieldIds?: string[];
  onChange: (fields: AdminFormField[]) => void;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useFormFieldsEditorHook?: typeof useFormFieldsEditor;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
}

export function FormFieldsEditor({
  fields,
  existingFieldIds = [],
  onChange,
  useFormFieldsEditorHook = useFormFieldsEditor,
  t,
}: FormFieldsEditorProps, _optional: Record<string, never> = {}) {
  const controller = useFormFieldsEditorHook({ fields, onChange });
  const { editingAttrsIndex, closeAttrsDialog, addField } = controller;
  // Field ids are the form's own field vocabulary and are unique once saved, but a freshly-added
  // row starts with an empty id (see `rules.ts`'s `blankField`) — `buildAgentListHandles`'s
  // position fallback covers that case the same way it covers any other unsluggable id. Not
  // `useMemo`d: one form's own field list is small and this is an O(n) pass, cheap enough that
  // memoizing it was not judged worth the added indirection.
  const { rows, editingField, saveAttributes } = useFormFieldsView({ fields, existingFieldIds, controller });

  return (
    <>
      <table
        className="list-table form-fields-table"
        {...agentHandle({ handle: "form-fields-table" }, {
          role: "region",
          label: "This form's field definitions — one row per field, in the order they render on the live form",
        })}
      >
        {/* Fixed proportional column widths (`forms.css`'s `table-layout: fixed`) rather than the
            browser's default content-driven auto layout — every cell here holds a live, unstyled-
            width `<input>`/`<select>`, so auto layout let six of them each claim their own
            intrinsic ~180px, pushing the table to ~925px wide at a 640px viewport (measured before
            this fix) with no visible cue that "Max length"/Remove were still reachable by scrolling
            `.table-scroll`. Percentages sized to what each column actually holds: ID/Label get the
            most room since they're the fields an operator actually reads, Required/Max length the
            least since a checkbox and a short number never need more.

            A seventh "MORE" column (this pass) holds the vertical-kebab trigger for
            `FieldAttributesDialog` — sized the same 8% as Req, since it holds nothing but one
            30px round icon button and never needs more. Taken entirely out of the Remove column's
            own share (26% -> 18%) rather than shrinking any of the five text/control columns, so
            ID/Label/Type/Req/Max length keep the exact widths the 640px fix already measured and
            fixed. */}
        <colgroup>
          <col style={{ width: "14%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>{t("ID")}</th>
            <th>{t("Label")}</th>
            <th>{t("Type")}</th>
            {/* "Required" is one unbreakable word — at this column's necessarily checkbox-sized
                width it has nowhere to wrap to and was visibly overflowing into "Max length"'s own
                header. "Req" reads fine sitting directly above the checkbox it labels; the row
                cell's own `aria-label` ("Field N required", unchanged below) still says the full
                word for anyone not reading the visual header at all. */}
            <th>{t("Req")}</th>
            <th>{t("Max length")}</th>
            {/* "More" — the exact literal string `FormsList.tsx`'s own `RowMenu` column header
                uses (confirmed by reading that file, not just the rendered DOM); `.list-table th`
                (`styles.css`) uppercases it visually to "MORE", same as every other header in this
                table (e.g. "Max length" above renders as "MAX LENGTH"). */}
            <th>{t("More")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ field, index, isExisting, base, displayName, onId, onLabel, onType, onRequired, onMaxLength, ref, onAttributes, onRemove }) => (
              <tr key={index}>
                <td>
                  <input
                    aria-label={`Field ${index + 1} id`}
                    value={field.id}
                    disabled={isExisting}
                    onChange={onId}
                    {...agentHandle({ handle: `${base}-id` }, {
                      role: "field",
                      label: "This field's unique id — the key its value is submitted under. Locked once saved.",
                    })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Field ${index + 1} label`}
                    value={field.label}
                    onChange={onLabel}
                    {...agentHandle({ handle: `${base}-label` }, { role: "field", label: "This field's on-page label" })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Field ${index + 1} type`}
                    value={field.type}
                    onChange={onType}
                    {...agentHandle({ handle: `${base}-type` }, {
                      role: "field",
                      label: "This field's input type — set with page.select_option, not click",
                    })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Field ${index + 1} required`}
                    checked={field.required}
                    onChange={onRequired}
                    {...agentHandle({ handle: `${base}-required` }, {
                      role: "checkbox",
                      label: "Whether this field must be filled in before the form can be submitted",
                    })}
                  />
                </td>
                <td>
                  {field.type === "checkbox" ? (
                    <span aria-hidden="true">—</span>
                  ) : (
                    <input
                      type="number"
                      aria-label={`Field ${index + 1} max length`}
                      value={field.maxLength ?? ""}
                      onChange={onMaxLength}
                      {...agentHandle({ handle: `${base}-max-length` }, {
                        role: "field",
                        label: "The maximum number of characters this field accepts — blank means no limit",
                      })}
                    />
                  )}
                </td>
                <td>
                  {/* Reuses `RowMenu`'s (`@jini-ai/admin/react`) own kebab glyph and
                      `.row-menu-trigger` class (`styles.css`) rather than drawing a second kebab —
                      see this file's header comment for why this is a plain button (single action)
                      instead of a `RowMenu` instance (which models a dropdown of several). */}
                  <button
                    ref={ref}
                    type="button"
                    className="row-menu-trigger"
                    aria-label={`Attributes for field "${displayName}"`}
                    onClick={onAttributes}
                    {...agentHandle({ handle: `${base}-attributes` }, {
                      role: "button",
                      label: "Open this field's CSS classes and HTML attributes dialog",
                    })}
                  >
                    <svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
                      <circle cx="9" cy="4.5" r="1.5" />
                      <circle cx="9" cy="9" r="1.5" />
                      <circle cx="9" cy="13.5" r="1.5" />
                    </svg>
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    disabled={isExisting}
                    title={isExisting ? t("Existing fields cannot be removed once created") : undefined}
                    onClick={onRemove}
                    {...agentHandle({ handle: `${base}-remove` }, {
                      role: "button",
                      label: "Remove this field from the form. Refused once the field has been saved.",
                    })}
                  >
                    {t("Remove")}
                  </button>
                </td>
              </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={7}>
              <button
                type="button"
                className="btn-secondary"
                onClick={addField}
                {...agentHandle({ handle: "form-fields-add" }, { role: "button", label: "Add a new field to this form" })}
              >
                {t("Add field")}
              </button>
            </td>
          </tr>
        </tfoot>
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

