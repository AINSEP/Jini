import { createFormsDraftStore } from "./draft-store.js";

export interface FormFieldsEditorState {
  editingAttrsIndex: number | null;
}
export function initialFormFieldsEditorState(_required: Record<string, never>, _optional = {}): FormFieldsEditorState {
  return { editingAttrsIndex: null };
}
/** A headless section store. React owns subscriptions/effects, never this state. */
export function createFormFieldsEditorController(_required: Record<string, never>, _optional = {}) {
  const store = createFormsDraftStore({ initial: initialFormFieldsEditorState({}) });
  return store;
}
