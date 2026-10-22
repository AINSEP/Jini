import type { AdminFormDefinition, AdminFormField, AdminFormNotify, AdminFormSubmission } from '../../models.js';
import type { AdminFormsPort } from '../../../core/ports/forms.js';
import type { FormsTrashPort, FormsEventsPort } from '../../ports.js';
import { createMemoryFormsApi } from '../../adapters/memory.js';
import { formView, submissionView } from '../../models.js';
import { useFormEditor as useCoreEditor } from '../hooks/use-form-editor.hooks.js';
import { useFormsList as useCoreList } from '../hooks/use-forms-list.hooks.js';
import { useFormSubmissions as useCoreSubmissions } from '../hooks/use-form-submissions.hooks.js';
import { useFormSubmissionDetail as useCoreDetail } from '../hooks/use-form-submission-detail.hooks.js';
export interface FormsPort {
  listForms(): Promise<{ data: AdminFormDefinition[] }>;
  getForm(id: string): Promise<{ data: AdminFormDefinition }>;
  createForm(input: { name: string; slug: string; fields: AdminFormField[]; mode?: 'builder' | 'html'; html?: string }, options?: { notify?: AdminFormNotify }): Promise<{ data: AdminFormDefinition }>;
  updateForm(target: { id: string }, options?: { name?: string; fields?: AdminFormField[]; notify?: AdminFormNotify; status?: 'active' | 'disabled'; mode?: 'builder' | 'html'; html?: string }): Promise<{ data: AdminFormDefinition }>;
  trashForm(id: string): Promise<{ ok: true; version: number | null }>;
  getMailStatus(): Promise<{ mailDeliveryAvailable: boolean }>;
}
export interface FormSubmissionsPort {
  listFormSubmissions(target: { formId: string }, options?: { cursor?: string; limit?: number }): Promise<{ data: AdminFormSubmission[]; nextCursor: string | null }>;
  getFormSubmission(target: { formId: string; submissionId: string }): Promise<{ data: AdminFormSubmission }>;
  deleteFormSubmission(target: { formId: string; submissionId: string }): Promise<void>;
}
/** These legacy interfaces exist only in the copied render harness, never production. */
function adapt(forms?: FormsPort, submissions?: FormSubmissionsPort): AdminFormsPort {
  const unused = (): never => { throw new Error('operation not supplied by this fixture'); };
  return {
    listFormDefinitions: async () => (await forms!.listForms()).data,
    getFormDefinition: async ({ id }) => (await forms!.getForm(id)).data,
    createFormDefinition: async (input, options = {}) => (await forms!.createForm(input as Parameters<FormsPort['createForm']>[0], options as Parameters<FormsPort['createForm']>[1])).data,
    updateFormDefinition: async (target, patch = {}) => (await forms!.updateForm(target, patch as Parameters<FormsPort['updateForm']>[1])).data,
    listFormSubmissions: async (target, options) => { const page = await submissions!.listFormSubmissions(target, options); return { items: page.data, nextCursor: page.nextCursor }; },
    getFormSubmission: async target => (await submissions!.getFormSubmission(target)).data,
    deleteFormSubmission: target => submissions ? submissions.deleteFormSubmission(target) : unused(),
  };
}
export function createFakeFormsPort({ forms = [], mailDeliveryAvailable = true }: { forms?: AdminFormDefinition[]; mailDeliveryAvailable?: boolean } = {}): FormsPort & { forms: AdminFormDefinition[] } {
  const api = createMemoryFormsApi({}, { forms });
  return {
    forms: api.forms as AdminFormDefinition[],
    listForms: async () => ({ data: (await api.listFormDefinitions({})).map(form => formView({ form })) }),
    getForm: async id => ({ data: formView({ form: await api.getFormDefinition({ id }) }) }),
    createForm: async (input, options = {}) => ({ data: formView({ form: await api.createFormDefinition(input, options) }) }),
    updateForm: async (target, patch = {}) => ({ data: formView({ form: await api.updateFormDefinition(target, patch) }) }),
    trashForm: id => api.trash.trash({ type: 'form', id }),
    getMailStatus: async () => ({ mailDeliveryAvailable }),
  };
}
export function createFakeFormSubmissionsPort({ submissions = [] }: { submissions?: AdminFormSubmission[] } = {}): FormSubmissionsPort & { submissions: AdminFormSubmission[] } {
  const api = createMemoryFormsApi({}, { submissions });
  return {
    // The old fixture exposed its active rows. Retain that test ABI while the memory owner
    // preserves trashed payloads separately from active list/detail reads.
    get submissions() { return api.submissions.filter(item => item.status !== 'trash') as AdminFormSubmission[]; },
    listFormSubmissions: async target => { const page = await api.listFormSubmissions(target, { limit: Math.max(1, api.submissions.length) }); return { data: page.items.map(submission => submissionView({ submission })), nextCursor: page.nextCursor }; },
    getFormSubmission: async target => ({ data: submissionView({ submission: await api.getFormSubmission(target) }) }),
    deleteFormSubmission: target => api.deleteFormSubmission(target),
  };
}
const listeners = new Set<() => void>();
const events: FormsEventsPort = { subscribe: ({ onRefresh }) => { listeners.add(onRefresh); return () => { listeners.delete(onRefresh); }; } };
export function publishContentRefresh(resources?: readonly string[]) { if (!resources || resources.includes('forms')) for (const listener of listeners) listener(); }
export function resetContentRefreshBus() { listeners.clear(); }
export function useFormsList({ port, t }: { port: FormsPort; t: (key: string) => string }, optional?: { locale?: string }) {
  const trash: FormsTrashPort = { trash: ({ id }) => port.trashForm(id) };
  return useCoreList({ port: adapt(port), trash, t, events }, optional);
}
export function useFormEditor(props: { formId: string; tab: 'fields' | 'submissions' }, deps: { port: FormsPort; navigate: (path: string) => void; t: (key: string) => string; clipboard?: { writeText(text: string): Promise<void> } }) {
  return useCoreEditor({ ...props, port: adapt(deps.port), navigate: deps.navigate, t: deps.t }, deps.clipboard ? { clipboard: deps.clipboard } : {});
}
export function useFormSubmissions(props: { formId: string }, port: FormSubmissionsPort) {
  return useCoreSubmissions({ ...props, port: adapt(undefined, port) });
}
export function useFormSubmissionDetail(props: Omit<Parameters<typeof useCoreDetail>[0], 'port' | 'trash'>, port: FormSubmissionsPort) {
  const trash: FormsTrashPort = { trash: async ({ id }) => { await port.deleteFormSubmission({ formId: props.formId, submissionId: id }); return { ok: true, version: null }; } };
  return useCoreDetail({ ...props, port: adapt(undefined, port), trash });
}
