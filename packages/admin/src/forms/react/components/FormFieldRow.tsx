import { agentHandle } from '@jini-ai/core/agent-handles';
import type { useFormFieldsView } from '../hooks/forms-view.hooks.js';

type Row = ReturnType<typeof useFormFieldsView>["rows"][number];
type Cell = { row: Row; t: (key: string) => string };

/** Field id, locked once saved. */
function FieldIdCell({ row: { field, index, isExisting, base, onId }, t }: Cell, _optional: Record<string, never> = {}) {
  return (
      <td data-label={t("ID")}>
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
  );
}

/** Field label. */
function FieldLabelCell({ row: { field, index, base, onLabel }, t }: Cell, _optional: Record<string, never> = {}) {
  return (
      <td data-label={t("Label")}>
        <input
          aria-label={`Field ${index + 1} label`}
          value={field.label}
          onChange={onLabel}
          {...agentHandle({ handle: `${base}-label` }, { role: "field", label: "This field's on-page label" })}
        />
      </td>
  );
}

/** The type picker, grouped by the registry. */
function FieldTypeCell({ row: { field, index, base, typeGroups, onType }, t }: Cell, _optional: Record<string, never> = {}) {
  return (
      <td data-label={t("Type")}>
        <select
          aria-label={`Field ${index + 1} type`}
          value={field.type}
          onChange={onType}
          {...agentHandle({ handle: `${base}-type` }, {
            role: "field",
            label: "This field's input type — set with page.select_option, not click",
          })}
        >
          {typeGroups.map(({ group, types }) => (
            <optgroup key={group} label={t(group)}>
              {types.map((type) => (
                <option key={type.type} value={type.type}>
                  {t(type.label)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </td>
  );
}

/** Required checkbox. */
function FieldRequiredCell({ row: { field, index, base, onRequired }, t }: Cell, _optional: Record<string, never> = {}) {
  return (
      <td data-label={t("Required")}>
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
  );
}

/** Max length, or a dash for types without one. */
function FieldMaxLengthCell({ row: { field, index, base, hasLength, onMaxLength }, t }: Cell, _optional: Record<string, never> = {}) {
  return (
      <td data-label={t("Max length")}>
        {!hasLength ? (
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
  );
}

/** The kebab that opens the field settings dialog. */
function FieldSettingsCell({ row: { base, displayName, ref, onAttributes }, t }: Cell, _optional: Record<string, never> = {}) {
  return (
      <td data-label={t("Settings")}>
        {/* Reuses `RowMenu`'s (`@jini-ai/admin/react`) own kebab glyph and
            `.row-menu-trigger` class (`styles.css`) rather than drawing a second kebab —
            see this file's header comment for why this is a plain button (single action)
            instead of a `RowMenu` instance (which models a dropdown of several). */}
        <button
          ref={ref}
          type="button"
          className="row-menu-trigger"
          aria-label={t('Settings for field "{name}"').replace("{name}", () => displayName)}
          onClick={onAttributes}
          {...agentHandle({ handle: `${base}-attributes` }, {
            role: "button",
            label: "Open this field's settings dialog: placeholder, help text, default, options, limits, CSS classes and HTML attributes",
          })}
        >
          <svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="4.5" r="1.5" />
            <circle cx="9" cy="9" r="1.5" />
            <circle cx="9" cy="13.5" r="1.5" />
          </svg>
        </button>
      </td>
  );
}

/** Remove, refused once the field is saved. */
function FieldRemoveCell({ row: { base, isExisting, onRemove }, t }: Cell, _optional: Record<string, never> = {}) {
  return (
      <td className="form-field-remove-cell">
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
  );
}

/** One field of the form as a table row. */
export function FormFieldRow({ row, t }: Cell, _optional: Record<string, never> = {}) {
  return (
    <tr>
      <FieldIdCell row={row} t={t} />
      <FieldLabelCell row={row} t={t} />
      <FieldTypeCell row={row} t={t} />
      <FieldRequiredCell row={row} t={t} />
      <FieldMaxLengthCell row={row} t={t} />
      <FieldSettingsCell row={row} t={t} />
      <FieldRemoveCell row={row} t={t} />
    </tr>
  );
}
