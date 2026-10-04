import type { SourceControlApiPort, SourceControlTransportPort } from '../ports.js';
import type { SourceControlCredential, SourceControlProvider, SourceControlRequestOptions } from '../models.js';
import { sourceControlSummary } from '../rules.js';
export function createHttpSourceControlApi({ transport, workspacePath }: { transport: SourceControlTransportPort; workspacePath: string }, _optional = {}): SourceControlApiPort {
  const base = `${workspacePath.replace(/\/$/, '')}/system/source-control`, path = `${base}/credentials`;
  async function request<T>(suffix: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', options: SourceControlRequestOptions, body?: unknown) { options.signal?.throwIfAborted(); return transport.request<T>({ path: `${base}${suffix}`, method, ...(body !== undefined ? { body } : {}) }, options); }
  return {
    async providers(_required, options = {}) { const r = await request<{ providers: readonly SourceControlProvider[] }>('/providers', 'GET', options); return Object.freeze(r.providers.map(p => Object.freeze({ id: p.id, label: p.label, ...(p.credential ? { credential: Object.freeze({ tokenField: p.credential.tokenField, fields: Object.freeze(p.credential.fields.map(f => Object.freeze({ ...f }))), ...(p.credential.help ? { help: p.credential.help } : {}), ...(p.credential.tokenPageUrl ? { tokenPageUrl: p.credential.tokenPageUrl } : {}) }) } : {}) }))); },
    async list(_required, options = {}) { const r = await request<{ credentials: readonly SourceControlCredential[] }>('/credentials', 'GET', options); return Object.freeze(r.credentials.map(row => sourceControlSummary({ row }))); },
    async create(input, options = {}) { const r = await request<{ credential: SourceControlCredential }>('/credentials', 'POST', options, input); return sourceControlSummary({ row: r.credential }); },
    async update({ id, patch }, options = {}) { const r = await request<{ credential: SourceControlCredential }>(`/credentials/${encodeURIComponent(id)}`, 'PUT', options, patch); return sourceControlSummary({ row: r.credential }); },
    async remove({ id }, options = {}) { options.signal?.throwIfAborted(); await transport.request<void>({ path: `${path}/${encodeURIComponent(id)}`, method: 'DELETE' }, options); },
  };
}
