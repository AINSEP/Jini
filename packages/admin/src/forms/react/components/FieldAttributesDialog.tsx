import { useFieldAttributesView } from "../hooks/forms-view.hooks.js";
import type { AdminFormField } from '../../models.js';
import { Dialog } from '@jini-ai/ui-kit/react';
import { InfoTip } from '@jini-ai/ui/admin-widgets';
import { agentHandle } from '@jini-ai/agentic';
import { ATTRIBUTE_NAME_SUGGESTIONS } from '../../rules.js';
import { useFieldAttributesDialog } from '../hooks/use-field-attributes-dialog.hooks.js';
import { FieldSettingsSection } from './FieldSettingsSection.js';

export interface FieldAttributesDialogProps {
  field: AdminFormField;
  fieldIndex: number;
  onSave: (patch: Partial<AdminFormField>) => void;
  onCancel: () => void;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useFieldAttributesDialogHook?: typeof useFieldAttributesDialog;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
}

export function FieldAttributesDialog({
  field,
  fieldIndex,
  onSave,
  onCancel,
  useFieldAttributesDialogHook = useFieldAttributesDialog,
  t,
}: FieldAttributesDialogProps, _optional: Record<string, never> = {}) {
  const controller = useFieldAttributesDialogHook({
    field,
    onSave,
    onCancel,
  });
  // One dialog is ever open at a time (`editingAttrsIndex` gates a single instance below), so this
  // needs no per-instance disambiguation — unlike the attribute rows inside it, which are a real
  // repeated list and do need `buildAgentListHandles`'s uniqueness search. Not `useMemo`d: `rows` is
  // one field's own CSS-class/HTML-attribute rows (a handful at most), cheap enough that memoizing
  // it was not judged worth the added indirection.
  const { className, addRow, error, submit } = controller;
  const { rows, displayName, onClose, onClassName, hasStyling } = useFieldAttributesView({ field, fieldIndex, controller, onCancel });

  return (
    <Dialog open title={`${t("Field settings —")} ${displayName}`}
      onClose={onClose} className="settings-dialog tovu-domain-dialog field-attrs-dialog">
      <form
        onSubmit={submit}
        {...agentHandle({ handle: "form-field-attrs-dialog" }, {
          role: "region",
          label: "Field settings dialog — type-specific settings, CSS classes and HTML attributes for one form field",
        })}
      >
        <FieldSettingsSection field={field} controller={controller} t={t} />

        {/* Styling hooks are rarely needed, so they fold away below the field's own settings; a
            field that already has classes or attributes opens with them showing. */}
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
          <datalist id="field-attrs-name-suggestions">
            {ATTRIBUTE_NAME_SUGGESTIONS.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {rows.map((row, index) => (
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
      </form>
    </Dialog>
  );
}
