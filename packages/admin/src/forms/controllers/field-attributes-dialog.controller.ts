import { createFormsDraftStore } from "./draft-store.js";
import type { AdminFormField } from "../models.js";
import { attrRowsFromField, updateAttrRow, removeAttrRow, addAttrRow, buildFieldAttributesPatch, type AttrRow } from "../rules.js";
export interface FieldAttributesDialogState {
  className: string;
  rows: AttrRow[];
  error: string | null;
}
export function initialFieldAttributesDialogState({ field }: { field: AdminFormField }, _optional = {}): FieldAttributesDialogState {
  return { className: field.className ?? "", rows: attrRowsFromField({ field }), error: null };
}
/** A headless section store. React owns subscriptions/effects, never this state. */
export function createFieldAttributesDialogController({ field }: { field: AdminFormField }, _optional = {}) {
  const store = createFormsDraftStore({ initial: initialFieldAttributesDialogState({ field }) });
  return {
    ...store,
    updateRow({ rowId, patch }: { rowId: number; patch: Partial<AttrRow> }, _options = {}) {
      store.update({ key: 'rows', value: rows => updateAttrRow({ rows, rowId, patch }) });
    },
    removeRow({ rowId }: { rowId: number }, _options = {}) {
      store.update({ key: 'rows', value: rows => removeAttrRow({ rows, rowId }) });
    },
    addRow(_required: Record<string, never>, _options = {}) {
      store.update({ key: 'rows', value: rows => addAttrRow({ rows }) });
    },
    submit(_required: Record<string, never>, _options = {}) {
      const result = buildFieldAttributesPatch(store.getSnapshot());
      store.update({ key: 'error', value: result.ok ? null : result.error });
      return result;
    },
  };
}
