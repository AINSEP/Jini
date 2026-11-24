import { CONTENT_TYPE_FIELD_KINDS, type ContentTypeFieldKind } from "./api/collections-api.types.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { type DraftField } from "./rules.js";




// ---------------------------------------------------------------------------
// One draft field's fieldset — shared by the New content type modal and the Edit fields modal,
// which differ only in their id/agent-handle prefix, whether the Remove button always shows (Edit)
// or only past the first field (New), and that button's own agentHandle label text.
// ---------------------------------------------------------------------------

interface ContentTypeFieldFieldsetProps {
  field: DraftField;
  index: number;
  /** e.g. "ct-field" (New) or "ct-edit-field" (Edit) — prefixes every input `id` on this row. */
  idPrefix: string;
  /** This row's own agentHandle base, from the caller's `buildAgentListHandles` list. */
  agentHandleBase: string;
  onUpdateField: (required: { rowId: number; patch: Partial<DraftField> }, optional?: Record<string, never>) => void;
  onRemoveField: (required: { rowId: number }, optional?: Record<string, never>) => void;
  showRemoveButton: boolean;
  removeButtonLabel: string;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

/** The row's two text/select controls (Name, Kind) — split out of {@link ContentTypeFieldFieldset}
 * to keep each render function short; markup and order are unchanged. */
function renderFieldNameAndKind({ field: f, idPrefix, agentHandleBase: base, onUpdateField, t }: ContentTypeFieldFieldsetProps) {
  return (
    <>
      <div className="jini-field">
        <label className="jini-field-label" htmlFor={`${idPrefix}-name-${f._rowId}`}>{t({ key: "Name" })}</label>
        <input
          id={`${idPrefix}-name-${f._rowId}`}
          value={f.name}
          onChange={(e) => onUpdateField({ rowId: f._rowId, patch: { name: e.target.value } })}
          placeholder="e.g. prep_time"
          {...agentHandle({ handle: `${base}-name` }, { role: "field", label: "This field's name" })}
        />
      </div>
      <div className="jini-field">
        <label className="jini-field-label" htmlFor={`${idPrefix}-kind-${f._rowId}`}>{t({ key: "Kind" })}</label>
        <select
          id={`${idPrefix}-kind-${f._rowId}`}
          value={f.kind}
          onChange={(e) => onUpdateField({ rowId: f._rowId, patch: { kind: e.target.value as ContentTypeFieldKind } })}
          {...agentHandle({ handle: `${base}-kind` }, {
            role: "field",
            label: "This field's data type — set with page.select_option, not click",
          })}
        >
          {CONTENT_TYPE_FIELD_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/** The row's two checkboxes (Required, Use for filtering and sorting) — see {@link renderFieldNameAndKind}. */
function renderFieldFlags({ field: f, agentHandleBase: base, onUpdateField, t }: ContentTypeFieldFieldsetProps) {
  return (
    <>
      <label className="jini-form-checkbox-field">
        <input
          type="checkbox"
          checked={f.required}
          onChange={(e) => onUpdateField({ rowId: f._rowId, patch: { required: e.target.checked } })}
          {...agentHandle({ handle: `${base}-required` }, {
            role: "checkbox",
            label: "Whether every entry of this content type must set this field",
          })}
        />
        {t({ key: "Required" })}
      </label>
      <label className="jini-form-checkbox-field" title={t({ key: "Choose only the fields you need to filter or sort by." })}>
        <input
          type="checkbox"
          checked={f.queryable}
          onChange={(e) => onUpdateField({ rowId: f._rowId, patch: { queryable: e.target.checked } })}
          {...agentHandle({ handle: `${base}-queryable` }, {
            role: "checkbox",
            label: "Whether this field gets a database index so entries can be filtered/sorted by it",
          })}
        />
        {t({ key: "Use for filtering and sorting" })}
      </label>
    </>
  );
}

function ContentTypeFieldFieldset(props: ContentTypeFieldFieldsetProps) {
  const { field: f, index, agentHandleBase: base, onRemoveField, showRemoveButton, removeButtonLabel, t } = props;
  return (
    <fieldset className="jini-collections-field-row">
      <legend>{t({ key: "Field" })} {index + 1}</legend>
      {renderFieldNameAndKind(props)}
      {renderFieldFlags(props)}
      {showRemoveButton ? (
        <button
          type="button"
          className="jini-btn-secondary"
          onClick={() => onRemoveField({ rowId: f._rowId })}
          {...agentHandle({ handle: `${base}-remove` }, { role: "button", label: removeButtonLabel })}
        >
          {t({ key: "Remove field" })}
        </button>
      ) : null}
    </fieldset>
  );
}

type Translate = ContentTypeFieldFieldsetProps["t"];

export interface ContentTypeFieldsSectionProps {
  fields: DraftField[];
  fieldHandles: string[];
  idPrefix: string;
  handlePrefix: "new-content-type" | "edit-fields";
  showRemoveButton: boolean;
  removeButtonLabel: string;
  updateField: ContentTypeFieldFieldsetProps["onUpdateField"];
  removeField: ContentTypeFieldFieldsetProps["onRemoveField"];
  addField: () => void;
  error: string | null;
  t: Translate;
}

/**
 * The draft field list shared by `NewContentTypeDialog` and `EditFieldsDialog`. Emits only `jini-*`
 * classes; the host styles `jini-collections-field-row` and the dialog-scoped `jini-field*`,
 * `jini-form-checkbox-field`, `jini-btn-secondary` and `jini-save-error` rules.
 */
export function ContentTypeFieldsSection({ fields, fieldHandles, idPrefix, handlePrefix, showRemoveButton, removeButtonLabel, updateField, removeField, addField, error, t }: ContentTypeFieldsSectionProps) {
  return (
    <>
      <div>
        <h3 className="jini-dialog-section-title">{t({ key: "Fields" })}</h3>
        {fields.map((f, index) => (
          <ContentTypeFieldFieldset
            key={f._rowId}
            field={f}
            index={index}
            idPrefix={idPrefix}
            agentHandleBase={fieldHandles[index]!}
            onUpdateField={updateField}
            onRemoveField={removeField}
            showRemoveButton={showRemoveButton}
            removeButtonLabel={removeButtonLabel}
            t={t}
          />
        ))}
        <button
          type="button"
          className="jini-btn-secondary"
          onClick={addField}
          {...agentHandle({ handle: `${handlePrefix}-add-field` }, { role: "button", label: "Add another field to this content type" })}
        >
          {t({ key: "Add field" })}
        </button>
      </div>
      {error ? <span className="jini-save-error" role="alert">{error}</span> : null}
    </>
  );
}
