import { createFormsDraftStore } from "./draft-store.js";
import type { AdminFormSubmission } from "../models.js";

export interface FormSubmissionsState {
  morePages: AdminFormSubmission[];
  moreCursor: string | null;
  moreError: string | null;
  selectedId: string | null;
  loadingMore: boolean;
}
export function initialFormSubmissionsState(_required: Record<string, never>, _optional = {}): FormSubmissionsState {
  return { morePages: [], moreCursor: null, moreError: null, selectedId: null, loadingMore: false };
}
/** A headless section store. React owns subscriptions/effects, never this state. */
export function createFormSubmissionsController(_required: Record<string, never>, _optional = {}) {
  const store = createFormsDraftStore({ initial: initialFormSubmissionsState({}) });
  return store;
}
