import type { SecurityApiPort, CredentialStorePort, SecurityTransportPort, OtherCredentialsPort, RootKeyPort } from '../ports.js';
import type { CredentialKind, CredentialSummary, CredentialProvider, CredentialField, RequestOptions, CredentialCategory, RootKeyStatus, RootKeyResult, RootKeyPreview } from '../models.js';
type RawRow = Omit<CredentialSummary, 'kind' | 'providerId'> & { providerId?: string };
/** Explicit projection strips accidental server extras, including token/ciphertext/hex. */
function summary(row: RawRow, kind: CredentialKind): CredentialSummary {
  return Object.freeze({ kind, id: row.id, providerId: row.providerId ?? '', label: row.label, configured: row.configured, isDefault: row.isDefault ?? false, createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...(row.accountLabel !== undefined ? { accountLabel: row.accountLabel } : {}), ...(kind === 'custom' ? { category: row.category ?? 'general', baseUrl: row.baseUrl ?? '', additionalHosts: Object.freeze([...(row.additionalHosts ?? [])]), ...(row.username ? { username: row.username } : {}) } : {}) });
}
interface Descriptor { id: string; label: string; credential?: { vendorLabel?: string; tokenField: string; fields?: readonly CredentialField[]; tokenPageUrl?: string; help?: string; userHelp?: string } }
export function createHttpSecurityApi({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, _optional = {}): SecurityApiPort {
  const base = workspacePath.replace(/\/$/, '');
  function store(kind: CredentialKind, suffix: string): CredentialStorePort {
    const path = `${base}/system/${suffix}/credentials`;
    async function mutate(method: 'POST' | 'PUT', target: string, body: unknown, options: RequestOptions) { options.signal?.throwIfAborted(); const r = await transport.request<{ credential: RawRow }>({ method, path: target, body }, options); return summary(r.credential, kind); }
    return {
      async list(_r, options = {}) { options.signal?.throwIfAborted(); const r = await transport.request<{ credentials: readonly RawRow[] }>({ method: 'GET', path }, options); return Object.freeze(r.credentials.map(row => summary(row, kind))); },
      create(input, options = {}) { return mutate('POST', path, input, options); },
      update({ id, patch }, options = {}) { return mutate('PUT', `${path}/${encodeURIComponent(id)}`, patch, options); },
      async remove({ id }, options = {}) { options.signal?.throwIfAborted(); await transport.request<void>({ method: 'DELETE', path: `${path}/${encodeURIComponent(id)}` }, options); },
    };
  }
  return {
    async providers(_r, options = {}) {
      options.signal?.throwIfAborted();
      const [publish, source] = await Promise.all([
        transport.request<{ targets: readonly Descriptor[] }>({ method: 'GET', path: `${base}/system/publish-targets` }, options),
        transport.request<{ providers: readonly Descriptor[] }>({ method: 'GET', path: `${base}/system/source-control/providers` }, options),
      ]);
      const map = (kind: 'publish' | 'source-control', d: Descriptor): CredentialProvider => ({ kind, id: d.id, label: d.label, vendorLabel: d.credential?.vendorLabel ?? d.label, category: kind === 'publish' ? 'hosting' : 'source-control', tokenField: d.credential?.tokenField ?? 'token', fields: d.credential?.fields ?? [], ...(d.credential?.tokenPageUrl ? { tokenPageUrl: d.credential.tokenPageUrl } : {}), ...((d.credential?.userHelp ?? d.credential?.help) ? { help: d.credential!.userHelp ?? d.credential!.help! } : {}) });
      return [...publish.targets.filter(d => d.credential).map(d => map('publish', d)), ...source.providers.map(d => map('source-control', d))];
    },
    publish: store('publish', 'publish'), sourceControl: store('source-control', 'source-control'), custom: store('custom', 'custom'),
  };
}
interface MediaSettings { baseUrl?: string; model?: string; apiKeyConfigured?: boolean; apiKeyTail?: string; apiKey?: string }
type MediaMap = Readonly<Record<string, MediaSettings>>;
/** Replacing the ENTIRE map requires sibling settings unchanged. Blank apiKey preserves their stored keys. */
function rebuildMedia(current: MediaMap, id: string, token?: string) {
  const next: Record<string, MediaSettings> = {};
  for (const [key, entry] of Object.entries(current)) { if (key === id && token === undefined) continue; next[key] = { ...(entry.baseUrl !== undefined ? { baseUrl: entry.baseUrl } : {}), ...(entry.model !== undefined ? { model: entry.model } : {}), ...(key === id && token !== undefined ? { apiKey: token } : {}) }; }
  return next;
}
export function createHttpOtherCredentials({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, { mediaLabels = {} }: { mediaLabels?: Readonly<Record<string, string>> } = {}): OtherCredentialsPort {
  const base = workspacePath.replace(/\/$/, '');
  const singles = { 'site-assistant': { path: '/assistant/site-credential', label: 'Assistant model key' }, 'admin-byok': { path: '/assistant/execution-credential', label: 'Admin model key' } };
  async function request<T>(path: string, method: 'GET' | 'PUT' | 'DELETE', options: RequestOptions, body?: unknown) { options.signal?.throwIfAborted(); return transport.request<T>({ path: `${base}${path}`, method, ...(body !== undefined ? { body } : {}) }, options); }
  return {
    async list({ store }, options = {}) {
      if (store === 'site-assistant' || store === 'admin-byok') { const r = await request<{ data: { isSet: boolean; updatedAt: string | null } }>(singles[store].path, 'GET', options); return r.data.isSet ? [{ store, id: store, label: singles[store].label, category: 'ai', configured: true, supportsReplace: true, updatedAt: r.data.updatedAt }] : []; }
      if (store === 'media-provider') { const map = await request<MediaMap>('/media/providers', 'GET', options); return Object.entries(map).filter(([, entry]) => entry.apiKeyConfigured).map(([id]) => ({ store, id, label: mediaLabels[id] ?? id, category: 'media' as CredentialCategory, configured: true, supportsReplace: true })); }
      const { servers } = await request<{ servers: readonly { serverId: string; label: string; envNames: readonly string[] }[] }>('/mcp-servers', 'GET', options); return servers.map(s => ({ store, id: s.serverId, label: s.label, category: 'ai', configured: true, supportsReplace: false, envNames: Object.freeze([...s.envNames]) }));
    },
    async replace({ store, id, token }, options = {}) {
      if (!token.trim()) throw new Error('Enter a credential');
      if (store === 'external-mcp') throw new Error('Edit the full server configuration on its own screen');
      if (store === 'media-provider') { const current = await request<MediaMap>('/media/providers', 'GET', options); await request('/media/providers', 'PUT', options, rebuildMedia(current, id, token)); }
      else await request(singles[store].path, 'PUT', options, { apiKey: token });
    },
    async remove({ store, id }, options = {}) {
      if (store === 'media-provider') { const current = await request<MediaMap>('/media/providers', 'GET', options); await request('/media/providers', 'PUT', options, rebuildMedia(current, id)); }
      else if (store === 'external-mcp') await request(`/mcp-servers/${encodeURIComponent(id)}`, 'DELETE', options);
      else await request(singles[store].path, 'DELETE', options);
    },
  };
}
export function createHttpRootKey({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, _optional = {}): RootKeyPort {
  const path = `${workspacePath.replace(/\/$/, '')}/system/site-token`;
  async function request<T>(suffix: string, method: 'GET' | 'POST', options: RequestOptions, body?: unknown) { options.signal?.throwIfAborted(); return transport.request<T>({ path: `${path}${suffix}`, method, ...(body !== undefined ? { body } : {}) }, options); }
  function result(r: RootKeyResult): RootKeyResult { return { outcome: r.outcome, fingerprint: r.fingerprint, keyFilePath: r.keyFilePath, runtimeMode: r.runtimeMode, ...(r.resealed !== undefined ? { resealed: r.resealed } : {}), ...(r.discarded !== undefined ? { discarded: r.discarded } : {}), ...(r.kept !== undefined ? { kept: r.kept } : {}), ...(r.restorePointId ? { restorePointId: r.restorePointId } : {}), ...(r.affectedWebhooks ? { affectedWebhooks: r.affectedWebhooks.map(w => ({ label: w.label, targetUrl: w.targetUrl })) } : {}) }; }
  return {
    async status(_r, o = {}) { const r = await request<RootKeyStatus>('', 'GET', o); return { active: r.active, source: r.source, state: r.state, keyFilePath: r.keyFilePath, runtimeMode: r.runtimeMode, ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}), ...(r.invalid !== undefined ? { invalid: r.invalid } : {}) }; },
    async generate(_r, o = {}) { return result(await request('/generate', 'POST', o)); },
    async importToken({ token }, o = {}) { return result(await request('/import', 'POST', o, { token })); },
    async previewStartFresh(_r, o = {}) { const r = await request<RootKeyPreview>('/start-fresh', 'GET', o); return { removes: r.removes, detail: r.detail, runtimeMode: r.runtimeMode, affectedWebhooks: r.affectedWebhooks.map(w => ({ label: w.label, targetUrl: w.targetUrl })) }; },
    async startFresh({ confirm }, o = {}) { return result(await request('/start-fresh', 'POST', o, { confirm })); },
  };
}
