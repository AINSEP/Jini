import { createFormsDraftStore } from "./draft-store.js";

export interface FormSubmissionDetailState {
  confirmOpen: boolean;
}
export function initialFormSubmissionDetailState(_required: Record<string, never>, _optional = {}): FormSubmissionDetailState {
  return { confirmOpen: false };
}
/** A headless section store. React owns subscriptions/effects, never this state. */
export function createFormSubmissionDetailController(_required: Record<string, never>, _optional = {}) {
  const store = createFormsDraftStore({ initial: initialFormSubmissionDetailState({}) });
  return store;
}
