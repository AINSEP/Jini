import type { CredentialStorePort, SecurityApiPort, OtherCredentialsPort, RootKeyPort } from '../ports.js';
import type { CredentialSummary, CredentialProvider, CredentialKind, CredentialPatch, OtherCredentialSummary, RootKeyStatus, RootKeyResult, RootKeyPreview } from '../models.js';
import { START_FRESH_CONFIRMATION } from '../rules.js';
/** Fake backend: retains only read models, never credential material. */
export function createMemorySecurityApi({ providers = [], rows = [] }: { providers?: readonly CredentialProvider[]; rows?: readonly CredentialSummary[] }, _optional = {}): SecurityApiPort {
  let items = rows.map(r => Object.freeze({ ...r })); let sequence = 0;
  function store(kind: CredentialKind): CredentialStorePort {
    function project(id: string, patch: CredentialPatch, providerId: string, initial?: CredentialSummary): CredentialSummary {
      const now = new Date().toISOString();
      return Object.freeze({ kind, id, providerId, label: patch.label ?? initial?.label ?? '', configured: true, isDefault: kind === 'custom' ? false : patch.isDefault ?? initial?.isDefault ?? !items.some(r => r.kind === kind && r.providerId === providerId), createdAt: initial?.createdAt ?? now, updatedAt: now,
        ...(kind === 'custom' ? { category: patch.category ?? initial?.category ?? 'general', baseUrl: patch.baseUrl ?? initial?.baseUrl ?? '', additionalHosts: Object.freeze([...(patch.additionalHosts ?? initial?.additionalHosts ?? [])]), ...((patch.username !== undefined ? patch.username : patch.connection?.username ?? initial?.username) ? { username: (patch.username !== undefined ? patch.username : patch.connection?.username ?? initial?.username)! } : {}) } : {}),
      });
    }
    function check(label: string, providerId: string, id?: string) { if (items.some(r => r.kind === kind && r.id !== id && (kind === 'custom' || r.providerId === providerId) && r.label.toLowerCase() === label.toLowerCase())) throw new Error('Duplicate label'); }
    function insert(row: CredentialSummary) {
      if (row.isDefault) items = items.map(r => r.kind === kind && r.providerId === row.providerId ? Object.freeze({ ...r, isDefault: false }) : r);
      items = [...items.filter(r => !(r.kind === kind && r.id === row.id)), row]; return row;
    }
    return {
      async list(_r, o = {}) { o.signal?.throwIfAborted(); return Object.freeze(items.filter(r => r.kind === kind)); },
      async create(input, o = {}) { o.signal?.throwIfAborted(); if (!Object.values(input.connection).some(v => v.trim()) || !input.label.trim()) throw new Error('Incomplete credential'); const providerId = kind === 'custom' ? '' : input.connection.providerId ?? ''; check(input.label, providerId); return insert(project(`credential-${++sequence}`, input, providerId)); },
      async update({ id, patch }, o = {}) { o.signal?.throwIfAborted(); const old = items.find(r => r.id === id && r.kind === kind); if (!old) throw new Error('Credential not found'); check(patch.label ?? old.label, old.providerId, id); return insert(project(id, patch, old.providerId, old)); },
      async remove({ id }, o = {}) { o.signal?.throwIfAborted(); const old = items.find(r => r.id === id && r.kind === kind); items = items.filter(r => !(r.id === id && r.kind === kind)); if (old?.isDefault) { const next = items.filter(r => r.kind === kind && r.providerId === old.providerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; if (next) insert(Object.freeze({ ...next, isDefault: true })); } },
    };
  }
  return { async providers(_r, o = {}) { o.signal?.throwIfAborted(); return providers; }, publish: store('publish'), sourceControl: store('source-control'), custom: store('custom') };
}
export function createMemoryOtherCredentials({ rows = [] }: { rows?: readonly OtherCredentialSummary[] }, _optional = {}): OtherCredentialsPort {
  let items = rows.map(row => Object.freeze({ ...row }));
  return {
    async list({ store }, o = {}) { o.signal?.throwIfAborted(); return items.filter(r => r.store === store); },
    async replace({ store, id, token }, o = {}) { o.signal?.throwIfAborted(); const row = items.find(r => r.store === store && r.id === id); if (!row?.supportsReplace || !token.trim()) throw new Error('Replacement unavailable'); items = items.map(r => r === row ? Object.freeze({ ...r, configured: true, updatedAt: new Date().toISOString() }) : r); },
    async remove({ store, id }, o = {}) { o.signal?.throwIfAborted(); items = items.filter(r => r.store !== store || r.id !== id); },
  };
}
export function createMemoryRootKey({ status = { active: false, source: 'none', state: 'missing', keyFilePath: '/memory/key', runtimeMode: 'local' }, preview = { removes: 0, affectedWebhooks: [], detail: 'Remove saved credentials and create a new root key.', runtimeMode: 'local' } }: { status?: RootKeyStatus; preview?: RootKeyPreview }, _optional = {}): RootKeyPort {
  let current = Object.freeze({ ...status });
  function activate(outcome: string): RootKeyResult { current = Object.freeze({ ...current, active: true, state: 'active', source: 'file', fingerprint: 'memory-fingerprint' }); return { outcome, fingerprint: 'memory-fingerprint', keyFilePath: current.keyFilePath, runtimeMode: current.runtimeMode }; }
  return {
    async status(_r, o = {}) { o.signal?.throwIfAborted(); return current; },
    async generate(_r, o = {}) { o.signal?.throwIfAborted(); if (current.active) return { ...activate('already-active') }; if (current.state !== 'missing') throw new Error('Key dependent data'); return activate('created'); },
    async importToken({ token }, o = {}) { o.signal?.throwIfAborted(); if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('Invalid token'); return { ...activate('unlocked'), resealed: 0 }; },
    async previewStartFresh(_r, o = {}) { o.signal?.throwIfAborted(); return preview; },
    async startFresh({ confirm }, o = {}) { o.signal?.throwIfAborted(); if (confirm !== START_FRESH_CONFIRMATION) throw new Error('Confirmation required'); return { ...activate('started-fresh'), discarded: preview.removes, kept: 0, affectedWebhooks: preview.affectedWebhooks, restorePointId: 'memory-restore-point' }; },
  };
}
