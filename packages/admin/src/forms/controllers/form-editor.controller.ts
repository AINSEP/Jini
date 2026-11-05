import type { AdminFormProviderSelection } from "../../core/ports/forms.js";
import { createFormsDraftStore } from "./draft-store.js";
import type { AdminFormDefinition, AdminFormField, AdminFormNotify } from "../models.js";
import { blankField } from "../rules.js";
import { formHtmlStarter } from "../html-rules.js";
export interface FormEditorState {
  form: AdminFormDefinition | null;
  provider: AdminFormProviderSelection;
  mode: "builder" | "html";
  html: string;
  copyFeedback: string | null;
  name: string;
  slug: string;
  fields: AdminFormField[];
  notify: AdminFormNotify;
}
export function initialFormEditorState(_required: Record<string, never>, _optional = {}): FormEditorState {
  return { form: null, provider: { id: "builtin", config: {} }, mode: "builder", html: "", copyFeedback: null, name: "", slug: "", fields: [blankField()], notify: { enabled: false, recipients: [] } };
}
/** A headless section store. React owns subscriptions/effects, never this state. */
export function createFormEditorController(_required: Record<string, never>, _optional = {}) {
  const store = createFormsDraftStore({ initial: initialFormEditorState({}) });
  return {
    ...store,
    seed({ form }: { form: AdminFormDefinition }, _options = {}) {
      store.patch({ patch: { form, provider: form.provider ?? { id: "builtin", config: {} }, name: form.name, slug: form.slug, fields: form.fields, mode: form.mode ?? 'builder', html: form.html ?? '', notify: form.notify } });
    },
    changeMode({ mode }: { mode: 'builder' | 'html' }, { submitLabel = 'Send' }: { submitLabel?: string } = {}) {
      const state = store.getSnapshot();
      const html = mode === 'html' && !state.html ? formHtmlStarter({ fields: state.fields }, { submitLabel }) : state.html;
      store.patch({ patch: { mode, html } });
    },
  };
}
