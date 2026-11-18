import { InfoTip } from '../../../react/kit.js';
import { agentHandle } from '@jini-ai/core/agent-handles';
import { ATTRIBUTE_NAME_SUGGESTIONS } from '../../rules.js';
import type { useFieldAttributesView } from '../hooks/forms-view.hooks.js';

type ViewReturn = ReturnType<typeof useFieldAttributesView>;
type ViewRow = ViewReturn["rows"][number];

/** The allowlisted attribute names the row name inputs suggest. */
function AttributeNameSuggestions() {
  return (
    <datalist id="field-attrs-name-suggestions">
      {ATTRIBUTE_NAME_SUGGESTIONS.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}

/** One HTML attribute (name, value, remove) of the field dialog's styling section. */
export function FieldAttributeRow({ row, index, t }: { row: ViewRow; index: number; t: (key: string) => string }, _optional: Record<string, never> = {}) {
  return (
      <fieldset key={row._rowId} className="collections-field-row">
        <legend>{t("Attribute")} {index + 1}</legend>
        <div className="field">
          <label className="field-label" htmlFor={`field-attrs-name-${row._rowId}`}>
            {t("Name")}
          </label>
          <input
            id={`field-attrs-name-${row._rowId}`}
            list="field-attrs-name-suggestions"
            value={row.name}
            placeholder="e.g. aria-label"
            onChange={row.onName}
            {...agentHandle({ handle: `${row.handle}-name` }, {
              role: "field",
              label: "This attribute's name — must be on the allowlisted set (aria-*, data-*, and a few others)",
            })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`field-attrs-value-${row._rowId}`}>
            {t("Value")}
          </label>
          <input
            id={`field-attrs-value-${row._rowId}`}
            value={row.value}
            placeholder={t("e.g. Enter your work email")}
            onChange={row.onValue}
            {...agentHandle({ handle: `${row.handle}-value` }, {
              role: "field",
              label: "This attribute's value",
            })}
          />
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={row.onRemove}
          {...agentHandle({ handle: `${row.handle}-remove` }, {
            role: "button",
            label: "Remove this CSS-class/HTML-attribute row",
          })}
        >
          {t("Remove")}
        </button>
      </fieldset>
  );
}

/** The collapsed class and attribute-row half of the field dialog. */
export function FieldAttributesStyling({ hasStyling, className, onClassName, rows, addRow, t }: {
  hasStyling: boolean; className: string; onClassName: ViewReturn["onClassName"]; rows: ViewReturn["rows"]; addRow: () => void; t: (key: string) => string;
}, _optional: Record<string, never> = {}) {
  return (
    <details className="field-settings-advanced" open={hasStyling}>
      <summary>{t("CSS classes and HTML attributes")}</summary>

    <div className="field">
      {/* The section used to open with a five-line explainer paragraph; it is an ⓘ tip now so
          the two inputs lead (Chrome check, 2026-10-11). The attribute-name `<datalist>` below
          still offers only allowlisted names, so the tip is reinforcement, not the only channel. */}
      <span className="field-settings-label">
        <label className="field-label" htmlFor="field-attrs-classname">
          {t("CSS classes")}
        </label>
        <InfoTip label={t("Classes are unrestricted, e.g. Tailwind md:col-span-2. Attribute names must be aria-*, data-* or a safe layout attribute; event handlers like onclick are rejected.")} />
      </span>
      <input
        id="field-attrs-classname"
        value={className}
        placeholder="e.g. md:col-span-2 w-1/2 focus:ring-2"
        onChange={onClassName}
        {...agentHandle({ handle: "form-field-attrs-classname" }, {
          role: "field",
          label: "CSS classes to add to this form field's input",
        })}
      />
    </div>

    <div className="field-attrs-rows">
      <span className="field-label">{t("HTML attributes")}</span>
      <AttributeNameSuggestions />
      {rows.map((row, index) => (
        <FieldAttributeRow key={row._rowId} row={row} index={index} t={t} />
      ))}
      <button
        type="button"
        className="btn-secondary"
        onClick={addRow}
        {...agentHandle({ handle: "form-field-attrs-add-row" }, {
          role: "button",
          label: "Add another HTML attribute row to this field",
        })}
      >
        {t("Add attribute")}
      </button>
    </div>
    </details>
  );
}

/** Save error and the Save / Cancel buttons of the field dialog. */
export function FieldAttributesActions({ error, onCancel, t }: { error: string | null; onCancel: () => void; t: (key: string) => string }, _optional: Record<string, never> = {}) {
  return (
    <>
      {error ? (
        <span className="save-error" role="alert">
          {t(error)}
        </span>
      ) : null}

      <span className="editor-actions">
        <button
          type="submit"
          {...agentHandle({ handle: "form-field-attrs-save" }, {
            role: "button",
            label: "Save this field's CSS classes and HTML attributes",
          })}
        >
          {t("Save")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onCancel}
          {...agentHandle({ handle: "form-field-attrs-cancel" }, {
            role: "button",
            label: "Close this dialog without saving attribute changes",
          })}
        >
          {t("Cancel")}
        </button>
      </span>
    </>
  );
}
