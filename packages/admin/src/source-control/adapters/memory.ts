import type { SourceControlApiPort } from '../ports.js';
import type { SourceControlCredential, SourceControlCredentialInput, SourceControlCredentialPatch, SourceControlProvider } from '../models.js';
import { sourceControlProviders, sourceControlReady, sourceControlSummary, blankSourceControlDraft } from '../rules.js';
export function createMemorySourceControlApi({ providers = [], credentials = [] }: { providers?: readonly SourceControlProvider[]; credentials?: readonly SourceControlCredential[] }, { now = () => new Date().toISOString() }: { now?: () => string } = {}): SourceControlApiPort {
  const catalog: readonly SourceControlProvider[] = Object.freeze(providers.map(p => Object.freeze({ ...p, ...(p.credential ? { credential: Object.freeze({ ...p.credential, fields: Object.freeze(p.credential.fields.map(f => Object.freeze({ ...f }))) }) } : {}) })));
  const rows = new Map(credentials.map(row => [row.id, sourceControlSummary({ row })])); let sequence = 0;
  function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
  function checkLabel(providerId: string, label: string, id?: string) { if (!label.trim()) fail('VALIDATION'); if ([...rows.values()].some(r => r.providerId === providerId && r.label === label.trim() && r.id !== id)) fail('DUPLICATE_LABEL'); }
  function validate(input: SourceControlCredentialInput['connection']) { const info = sourceControlProviders({ providers: catalog, credentials: [] }).find(p => p.id === input.providerId); if (!info || !sourceControlReady({ info, draft: { ...blankSourceControlDraft({}), token: input.token, values: input } })) fail('VALIDATION'); }
  function setDefault(row: SourceControlCredential) { if (row.isDefault) for (const old of rows.values()) if (old.providerId === row.providerId && old.id !== row.id && old.isDefault) rows.set(old.id, sourceControlSummary({ row: { ...old, isDefault: false } })); rows.set(row.id, sourceControlSummary({ row })); return rows.get(row.id)!; }
  return {
    async providers(_r, o = {}) { o.signal?.throwIfAborted(); return catalog; },
    async list(_r, o = {}) { o.signal?.throwIfAborted(); return Object.freeze([...rows.values()]); },
    async create(input, o = {}) { o.signal?.throwIfAborted(); validate(input.connection); const providerId = input.connection.providerId, label = input.label.trim(); checkLabel(providerId, label); let id: string; do { id = `memory-source-${++sequence}`; } while (rows.has(id)); const timestamp = now(); return setDefault({ id, providerId, label, configured: true, isDefault: input.isDefault ?? ![...rows.values()].some(r => r.providerId === providerId), createdAt: timestamp, updatedAt: timestamp }); },
    async update({ id, patch }, o = {}) { o.signal?.throwIfAborted(); const old = rows.get(id); if (!old) fail('NOT_FOUND'); if (patch.connection) { validate(patch.connection); if (patch.connection.providerId !== old.providerId) fail('VALIDATION'); } const label = (patch.label ?? old.label).trim(); checkLabel(old.providerId, label, id); return setDefault({ ...old, label, isDefault: patch.isDefault ?? old.isDefault, updatedAt: now() }); },
    async remove({ id }, o = {}) { o.signal?.throwIfAborted(); const old = rows.get(id); rows.delete(id); if (old?.isDefault) { const next = [...rows.values()].find(r => r.providerId === old.providerId); if (next) setDefault({ ...next, isDefault: true }); } },
  };
}
