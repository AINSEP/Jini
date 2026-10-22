import type { AdminFormDefinition as Definition, AdminFormField as Field, AdminFormSubmission as Submission } from '../core/ports/forms.js';
/** Mutable editor drafts project the core contract; they never define another API. */
export type AdminFormField = { -readonly [K in keyof Field]: Field[K] } & { attributes?: Record<string, string> | undefined };
export type AdminFormNotify = { enabled: boolean; recipients: string[] };
export type AdminFormDefinition = Omit<Definition, 'fields' | 'notify'> & { workspaceId?: string; fields: AdminFormField[]; notify: AdminFormNotify };
export type AdminFormSubmission = Omit<Submission, 'data'> & { workspaceId?: string; data: Record<string, string | boolean> };
export type FormsTranslator = (key: string, vars?: Record<string, string | number>) => string;
/** Copy drafts at the API boundary so editing cannot mutate a repository/cache snapshot. */
export function formView({ form }: { form: Definition }, _optional = {}): AdminFormDefinition {
  return { ...form, fields: form.fields.map(field => ({ ...field, ...(field.attributes ? { attributes: { ...field.attributes } } : {}) })), notify: { ...form.notify, recipients: [...form.notify.recipients] } };
}
export function submissionView({ submission }: { submission: Submission }, _optional = {}): AdminFormSubmission {
  return { ...submission, data: { ...submission.data } };
}
