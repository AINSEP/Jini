import { createFormsDraftStore } from "./draft-store.js";
import type { AdminFormDefinition } from "../models.js";

export interface FormsListState {
  rowSavingId: string | null;
  pendingDelete: AdminFormDefinition | null;
}
export function initialFormsListState(_required: Record<string, never>, _optional = {}): FormsListState {
  return { rowSavingId: null, pendingDelete: null };
}
/** A headless section store. React owns subscriptions/effects, never this state. */
export function createFormsListController(_required: Record<string, never>, _optional = {}) {
  const store = createFormsDraftStore({ initial: initialFormsListState({}) });
  return store;
}
