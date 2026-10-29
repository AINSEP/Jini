import { createFormsDraftStore } from "./draft-store.js";
import type { AdminFormField } from "../models.js";
import { attrRowsFromField, updateAttrRow, removeAttrRow, addAttrRow, buildFieldAttributesPatch, type AttrRow } from "../rules.js";
import { addOptionRow, buildFieldSettingsPatch, moveOptionRow, removeOptionRow, settingsFormFromField, updateOptionRow, type FieldSettingsForm, type OptionRow } from "../field-settings.js";
export interface FieldAttributesDialogState {
  className: string;
  rows: AttrRow[];
  /** The type's builder settings (field-settings.ts), edited as text until Save. */
  settings: FieldSettingsForm;
  error: string | null;
}
export function initialFieldAttributesDialogState({ field }: { field: AdminFormField }, _optional = {}): FieldAttributesDialogState {
  return { className: field.className ?? "", rows: attrRowsFromField({ field }), settings: settingsFormFromField({ field }), error: null };
}
/** Add or remove one value from a list setting (accepted uploads, default choices). */
const toggled = (values: string[], value: string, on: boolean): string[] => {
  if (!on) return values.filter((item) => item !== value);
  return values.includes(value) ? values : [...values, value];
};
/** A single-select default holds at most the one chosen (non-empty) value. */
const singleChoice = (value: string, on: boolean): string[] => (on && value ? [value] : []);
/** The first failure wins (settings before attributes); otherwise both patches merge. */
function mergeSubmitPatches(settings: ReturnType<typeof buildFieldSettingsPatch>, attributes: ReturnType<typeof buildFieldAttributesPatch>) {
  if (!settings.ok) return settings;
  if (!attributes.ok) return attributes;
  return { ok: true as const, patch: { ...settings.patch, ...attributes.patch } };
}
/** A headless section store. React owns subscriptions/effects, never this state. */
export function createFieldAttributesDialogController({ field }: { field: AdminFormField }, _optional = {}) {
  const store = createFormsDraftStore({ initial: initialFieldAttributesDialogState({ field }) });
  const editSettings = (change: (settings: FieldSettingsForm) => FieldSettingsForm) => store.update({ key: 'settings', value: change });
  const editOptions = (change: (rows: OptionRow[]) => OptionRow[]) => editSettings(settings => ({ ...settings, options: change(settings.options) }));
  return {
    ...store,
    setSettings({ patch }: { patch: Partial<FieldSettingsForm> }, _options = {}) {
      editSettings(settings => ({ ...settings, ...patch }));
    },
    /** `single` replaces the selection: a dropdown or radio group has one default. */
    toggleDefaultChoice({ value, on, single }: { value: string; on: boolean; single: boolean }, _options = {}) {
      editSettings(settings => ({ ...settings, defaultChoices: single ? singleChoice(value, on) : toggled(settings.defaultChoices, value, on) }));
    },
    toggleAccept({ value, on }: { value: string; on: boolean }, _options = {}) {
      editSettings(settings => ({ ...settings, accept: toggled(settings.accept, value, on) }));
    },
    updateOption({ rowId, patch }: { rowId: number; patch: Partial<Pick<OptionRow, 'value' | 'label'>> }, _options = {}) {
      editOptions(rows => updateOptionRow({ rows, rowId, patch }));
    },
    addOption(_required: Record<string, never>, _options = {}) { editOptions(rows => addOptionRow({ rows })); },
    removeOption({ rowId }: { rowId: number }, _options = {}) { editOptions(rows => removeOptionRow({ rows, rowId })); },
    moveOption({ rowId, offset }: { rowId: number; offset: -1 | 1 }, _options = {}) { editOptions(rows => moveOptionRow({ rows, rowId, offset })); },
    updateRow({ rowId, patch }: { rowId: number; patch: Partial<AttrRow> }, _options = {}) {
      store.update({ key: 'rows', value: rows => updateAttrRow({ rows, rowId, patch }) });
    },
    removeRow({ rowId }: { rowId: number }, _options = {}) {
      store.update({ key: 'rows', value: rows => removeAttrRow({ rows, rowId }) });
    },
    addRow(_required: Record<string, never>, _options = {}) {
      store.update({ key: 'rows', value: rows => addAttrRow({ rows }) });
    },
    /** Settings are checked first: they sit above the attribute rows in the dialog. */
    submit(_required: Record<string, never>, _options = {}) {
      const snapshot = store.getSnapshot();
      const settings = buildFieldSettingsPatch({ form: snapshot.settings, field });
      const attributes = buildFieldAttributesPatch(snapshot);
      const result = mergeSubmitPatches(settings, attributes);
      store.update({ key: 'error', value: result.ok ? null : result.error });
      return result;
    },
  };
}
