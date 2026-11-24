import type { CredentialStorePort, SecurityApiPort, OtherCredentialsPort, RootKeyPort, PublishCredentialsPort } from '../ports.js';
import type { AdminPublishCredentialSummary, AdminPublishExecutionMode } from '@jini-ai/core/contracts/site/api-security-api-types';
import type { AdminCredentialCopySource } from '@jini-ai/core/contracts/site/api-security-api-types';
import type { CredentialInput } from '../models.js';
import type { CredentialSummary, CredentialProvider, CredentialKind, CredentialPatch, OtherCredentialSummary, RootKeyStatus, RootKeyResult, RootKeyPreview } from '../models.js';
import { START_FRESH_CONFIRMATION } from '../rules.js';
function customUsernameField({ patch }: { patch: CredentialPatch }, { initial }: { initial?: CredentialSummary | undefined } = {}) {
  const username = patch.username !== undefined ? patch.username : patch.connection?.username ?? initial?.username;
  return username ? { username } : {};
}
function customHosts({ patch }: { patch: CredentialPatch }, { initial }: { initial?: CredentialSummary | undefined } = {}) { return Object.freeze([...(patch.additionalHosts ?? initial?.additionalHosts ?? [])]); }
function customProjection({ patch }: { patch: CredentialPatch }, { initial }: { initial?: CredentialSummary | undefined } = {}) {
  return { category: patch.category ?? initial?.category ?? 'general', baseUrl: patch.baseUrl ?? initial?.baseUrl ?? '', additionalHosts: customHosts({ patch }, { initial }), ...customUsernameField({ patch }, { initial }) };
}
/** Where a custom key lives: a new key keeps the scope it was created with; an update keeps the saved usage facts. */
function customStorage({ patch }: { patch: CredentialPatch }, { initial, site }: { initial?: CredentialSummary | undefined; site: string }) {
  const scope = (patch as CredentialInput).scope ?? initial?.scope;
  if (initial) return savedStorage({ facts: { scope, usedBy: initial.usedBy, usedByThisSite: initial.usedByThisSite, tokenHint: initial.tokenHint } });
  return scope === 'project' ? { scope, usedBy: Object.freeze([site]), usedByThisSite: true } : scope ? { scope } : {};
}
/** The saved facts that are present; an absent one stays absent rather than becoming `undefined`. */
function savedStorage({ facts }: { facts: Readonly<Record<'scope' | 'usedBy' | 'usedByThisSite' | 'tokenHint', unknown>> }, _optional = {}) {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined && value !== null)) as Partial<CredentialSummary>;
}
/** Shared Keys fake: metadata inventory in, one `granted` result per requested id out. */
function memorySharedKeys({ sources }: { sources: readonly AdminCredentialCopySource[] }, _optional = {}): NonNullable<SecurityApiPort['sharedKeys']> {
  return {
    async list(_r, o = {}) { o.signal?.throwIfAborted(); return sources; },
    async grant({ ids }, o = {}) { o.signal?.throwIfAborted(); return ids.map(id => ({ kind: sources.flatMap(s => s.keys).find(k => k.id === id)?.kind ?? 'custom', id, status: 'granted' as const })); },
  };
}
/** Fake backend: retains only read models, never credential material. `sharedKeys` adds the Shared Keys port;
 * `projectKeysAvailable` adds project-key use and reports the flag on the custom store's snapshot. */
export function createMemorySecurityApi({ providers = [], rows = [], executionMode, sharedKeys, projectKeysAvailable, siteName = 'this-site' }: { providers?: readonly CredentialProvider[]; rows?: readonly CredentialSummary[]; executionMode?: AdminPublishExecutionMode; sharedKeys?: { sources: readonly AdminCredentialCopySource[] }; projectKeysAvailable?: boolean; siteName?: string }, _optional = {}): SecurityApiPort {
  let items = rows.map(r => Object.freeze({ ...r })); let sequence = 0;
  const nextSequence = () => { sequence += 1; return sequence; };
  function store(kind: CredentialKind): CredentialStorePort {
    function isDefaultFor({ patch, providerId }: { patch: CredentialPatch; providerId: string }, { initial }: { initial?: CredentialSummary | undefined } = {}) {
      if (kind === 'custom') return false;
      return patch.isDefault ?? initial?.isDefault ?? !items.some(r => r.kind === kind && r.providerId === providerId);
    }
    /** The caller resolves the label: create requires one, update falls back to the saved label. */
    function project({ id, patch, providerId, label }: { id: string; patch: CredentialPatch; providerId: string; label: string }, { initial }: { initial?: CredentialSummary | undefined } = {}): CredentialSummary {
      const now = new Date().toISOString();
      return Object.freeze({ kind, id, providerId, label, configured: true, isDefault: isDefaultFor({ patch, providerId }, { initial }), createdAt: initial?.createdAt ?? now, updatedAt: now,
        ...(kind === 'custom' ? { ...customProjection({ patch }, { initial }), ...customStorage({ patch }, { initial, site: siteName }) } : {}),
      });
    }
    function check(label: string, providerId: string, id?: string) {
      const sameScope = (r: CredentialSummary) => r.kind === kind && r.id !== id && (kind === 'custom' || r.providerId === providerId);
      if (items.some(r => sameScope(r) && r.label.toLowerCase() === label.toLowerCase())) throw new Error('Duplicate label');
    }
    function insert(row: CredentialSummary) {
      if (row.isDefault) items = items.map(r => r.kind === kind && r.providerId === row.providerId ? Object.freeze({ ...r, isDefault: false }) : r);
      items = [...items.filter(r => !(r.kind === kind && r.id === row.id)), row]; return row;
    }
    return {
      async list(_r, o = {}) { o.signal?.throwIfAborted(); return Object.freeze(items.filter(r => r.kind === kind)); },
      /** Reads through this port's own `list`, so a replaced `list` (a failing store in a test) also governs the snapshot. */
      async snapshot(_r, o = {}) { return { rows: await this.list({}, o), ...(kind === 'publish' && executionMode ? { executionMode } : {}), ...(kind === 'custom' && projectKeysAvailable !== undefined ? { projectKeysAvailable } : {}) }; },
      ...(kind === 'publish' ? { async verify({ id }: { id: string }, o: { signal?: AbortSignal } = {}) { o.signal?.throwIfAborted(); if (!items.some(r => r.kind === kind && r.id === id)) throw new Error('Credential not found');
        return { status: 'valid' as const, message: 'Connection verified', checkedAt: new Date().toISOString() }; } } : {}),
      async create(input, o = {}) { o.signal?.throwIfAborted(); if (!Object.values(input.connection).some(v => v.trim()) || !input.label.trim()) throw new Error('Incomplete credential');
        const providerId = kind === 'custom' ? '' : input.connection.providerId ?? ''; check(input.label, providerId); return insert(project({ id: `credential-${nextSequence()}`, patch: input, providerId, label: input.label })); },
      async update({ id, patch }, o = {}) { o.signal?.throwIfAborted(); const old = items.find(r => r.id === id && r.kind === kind); if (!old) throw new Error('Credential not found');
        const label = patch.label ?? old.label; check(label, old.providerId, id); return insert(project({ id, patch, providerId: old.providerId, label }, { initial: old })); },
      async remove({ id }, o = {}) { o.signal?.throwIfAborted(); const old = items.find(r => r.id === id && r.kind === kind); items = items.filter(r => !(r.id === id && r.kind === kind)); if (old?.isDefault) { const next = items.filter(r => r.kind === kind && r.providerId === old.providerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; if (next) insert(Object.freeze({ ...next, isDefault: true })); } },
    };
  }
  /** Attaching adds this site to the key's users; detaching removes it. Other sites keep theirs. */
  async function useProjectKey({ keyId, use }: { keyId: string; use: boolean }, o: { signal?: AbortSignal } = {}) {
    o.signal?.throwIfAborted(); if (!items.some(r => r.kind === 'custom' && r.id === keyId && r.scope === 'project')) throw new Error('Project key not found');
    items = items.map(r => r.kind === 'custom' && r.id === keyId ? Object.freeze({ ...r, usedByThisSite: use, usedBy: Object.freeze([...(r.usedBy ?? []).filter(s => s !== siteName), ...(use ? [siteName] : [])]) }) : r);
  }
  return { async providers({ kind }, o = {}) { o.signal?.throwIfAborted(); return kind ? providers.filter(p => p.kind === kind) : providers; }, publish: store('publish'), sourceControl: store('source-control'), custom: store('custom'),
    ...(sharedKeys ? { sharedKeys: memorySharedKeys(sharedKeys) } : {}), ...(projectKeysAvailable !== undefined ? { useProjectKey } : {}) };
}
/** Fake publish client for Deployment and Security: keeps read models only, never the connection's secret fields. */
export function createMemoryPublishCredentials({ rows = [], executionMode = 'self-hosted-cli' }: { rows?: readonly AdminPublishCredentialSummary[]; executionMode?: AdminPublishExecutionMode }, _optional = {}): PublishCredentialsPort {
  let items = rows.map(r => ({ ...r, worksFor: [...r.worksFor] })); let sequence = 0;
  const find = (id: string) => { const row = items.find(r => r.id === id); if (!row) throw new Error('Credential not found'); return row; };
  const verification = () => ({ status: 'valid' as const, message: 'Connection verified', checkedAt: new Date().toISOString() });
  function settle(row: AdminPublishCredentialSummary) { items = [...items.filter(r => r.id !== row.id).map(r => row.isDefault && r.providerId === row.providerId ? { ...r, isDefault: false } : r), row]; return { credential: { ...row, worksFor: [...row.worksFor] }, verification: verification() }; }
  return {
    async listPublishCredentials(_r = {}, o = {}) { o.signal?.throwIfAborted(); return { credentials: items.map(r => ({ ...r, worksFor: [...r.worksFor] })), executionMode }; },
    async createPublishCredential({ label, connection, isDefault, worksFor = [] }, o = {}) { o.signal?.throwIfAborted(); const { providerId, ...secrets } = connection;
      if (!label.trim() || !Object.values(secrets).some(v => v.trim())) throw new Error('Incomplete credential');
      if (items.some(r => r.label.toLowerCase() === label.toLowerCase())) throw new Error('Duplicate label');
      const now = new Date().toISOString(); sequence += 1;
      return settle({ credentialType: 'vendor', worksFor: [...worksFor], id: `publish-${sequence}`, providerId, label, configured: true, isDefault: isDefault ?? !items.some(r => r.providerId === providerId), createdAt: now, updatedAt: now, accountLabel: null }); },
    async updatePublishCredential({ id, input }, o = {}) { o.signal?.throwIfAborted(); const old = find(id);
      return settle({ ...old, label: input.label ?? old.label, isDefault: input.isDefault ?? old.isDefault, worksFor: [...(input.worksFor ?? old.worksFor)], updatedAt: new Date().toISOString(), ...(input.connection ? { accountLabel: null } : {}) }); },
    async deletePublishCredential({ id }, o = {}) { o.signal?.throwIfAborted(); items = items.filter(r => r.id !== id); },
    async verifyPublishCredential({ id }, o = {}) { o.signal?.throwIfAborted(); find(id); return { verification: verification() }; },
  };
}
export function createMemoryOtherCredentials({ rows = [] }: { rows?: readonly OtherCredentialSummary[] }, _optional = {}): OtherCredentialsPort {
  let items = rows.map(row => Object.freeze({ ...row }));
  return {
    async list({ store }, o = {}) { o.signal?.throwIfAborted(); return items.filter(r => r.store === store); },
    async replace({ store, id, token }, o = {}) { o.signal?.throwIfAborted(); const row = items.find(r => r.store === store && r.id === id); if (!row?.supportsReplace || !token.trim()) throw new Error('Replacement unavailable');
      items = items.map(r => r === row ? Object.freeze({ ...r, configured: true, updatedAt: new Date().toISOString() }) : r); },
    async remove({ store, id }, o = {}) { o.signal?.throwIfAborted(); items = items.filter(r => r.store !== store || r.id !== id); },
  };
}
export function createMemoryRootKey({ status = { active: false, source: 'none', state: 'missing', keyFilePath: '/memory/key', runtimeMode: 'local' }, preview = { removes: 0, affectedWebhooks: [], detail: 'Remove saved credentials and create a new root key.', runtimeMode: 'local' }, revealHex }: { status?: RootKeyStatus; preview?: RootKeyPreview; revealHex?: string }, _optional = {}): RootKeyPort {
  let current = Object.freeze({ ...status });
  /** An active file-backed key has no env source or refusal: rebuild the status so a prior `envVarName`/`invalid`/`reason` is not carried over. */
  function activate(outcome: string): RootKeyResult { current = Object.freeze({ active: true, state: 'active', source: 'file', fingerprint: 'memory-fingerprint', keyFilePath: current.keyFilePath, runtimeMode: current.runtimeMode }); return { outcome, fingerprint: 'memory-fingerprint', keyFilePath: current.keyFilePath, runtimeMode: current.runtimeMode }; }
  return {
    async status(_r, o = {}) { o.signal?.throwIfAborted(); return current; },
    async generate(_r, o = {}) { o.signal?.throwIfAborted(); if (current.active) return { ...activate('already-active') };
      if (current.state !== 'missing') throw new Error('Key dependent data');
      return activate('created'); },
    async importToken({ token }, o = {}) { o.signal?.throwIfAborted(); if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('Invalid token');
      return { ...activate('unlocked'), resealed: 0 }; },
    async previewStartFresh(_r, o = {}) { o.signal?.throwIfAborted(); return preview; },
    async startFresh({ confirm }, o = {}) { o.signal?.throwIfAborted(); if (confirm !== START_FRESH_CONFIRMATION) throw new Error('Confirmation required');
      return { ...activate('started-fresh'), discarded: preview.removes, kept: 0, affectedWebhooks: preview.affectedWebhooks, restorePointId: 'memory-restore-point' }; },
    // A fixture value only; an inactive key reveals nothing, matching the server.
    async reveal(_r, o = {}) { o.signal?.throwIfAborted(); return current.active && revealHex ? { active: true, hex: revealHex } : { active: current.active }; },
  };
}
