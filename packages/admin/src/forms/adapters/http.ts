import type { AdminFormsPort, AdminFormDefinition, AdminFormSubmission } from '../../core/ports/forms.js';
import type { FormsTrashPort } from '../ports.js';
/** The host owns auth, workspace addressing, retries, error decoding and telemetry. */
export interface FormsTransportPort {
  request<T>(required: { path: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, optional?: { signal?: AbortSignal }): Promise<T>;
  url(required: { path: string }, optional?: Record<string, never>): string;
}
/** Preserve the existing forms wire, including its data envelopes and explicit authoring route. */
export function createHttpFormsApi(
  { transport, basePath }: { transport: FormsTransportPort; basePath: string },
  _optional: Record<string, never> = {},
): AdminFormsPort {
  const base = basePath.replace(/\/$/, '');
  const formPath = (id: string) => `${base}/${encodeURIComponent(id)}`;
  const submissionPath = (formId: string, submissionId?: string) => `${formPath(formId)}/submissions${submissionId === undefined ? '' : `/${encodeURIComponent(submissionId)}`}`;
  return {
    async listFormDefinitions(_required, _optional = {}) {
      return (await transport.request<{ data: AdminFormDefinition[] }>({ path: base, method: 'GET' })).data;
    },
    async getFormDefinition({ id }, _optional = {}) {
      return (await transport.request<{ data: AdminFormDefinition }>({ path: formPath(id), method: 'GET' })).data;
    },
    async createFormDefinition(input, optional = {}) {
      return (await transport.request<{ data: AdminFormDefinition }>({ path: base, method: 'POST', body: { ...input, ...optional } })).data;
    },
    async updateFormDefinition({ id }, patch = {}) {
      const authoring = patch.mode !== undefined || patch.html !== undefined;
      return (await transport.request<{ data: AdminFormDefinition }>({ path: `${formPath(id)}${authoring ? '/authoring' : ''}`, method: 'PUT', body: patch })).data;
    },
    async listFormSubmissions({ formId }, options = {}) {
      const params = new URLSearchParams();
      if (options.cursor) params.set('cursor', options.cursor);
      if (options.limit) params.set('limit', String(options.limit));
      const qs = params.toString();
      const response = await transport.request<{ data: AdminFormSubmission[]; nextCursor: string | null }>({ path: `${submissionPath(formId)}${qs ? `?${qs}` : ''}`, method: 'GET' });
      return { items: response.data, nextCursor: response.nextCursor };
    },
    async getFormSubmission({ formId, submissionId }, _optional = {}) {
      return (await transport.request<{ data: AdminFormSubmission }>({ path: submissionPath(formId, submissionId), method: 'GET' })).data;
    },
    async deleteFormSubmission({ formId, submissionId }, _optional = {}) {
      // The server delegates DELETE to Trash; permanent deletion belongs to the Trash screen.
      await transport.request({ path: submissionPath(formId, submissionId), method: 'DELETE' });
    },
  };
}
/** The same generic POST used by both host screens; no form lifecycle is reimplemented here. */
export function createHttpFormsTrash(
  { transport, basePath }: { transport: FormsTransportPort; basePath: string },
  _optional: Record<string, never> = {},
): FormsTrashPort {
  return { trash: (body, _options = {}) => transport.request({ path: basePath, method: 'POST', body }) };
}
