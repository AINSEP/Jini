import type { SecurityApiPort, CredentialStorePort, SecurityTransportPort, OtherCredentialsPort, RootKeyPort, PublishCredentialsPort } from '../ports.js';
import type { AdminPublishCredentialsSnapshot, AdminPublishCredentialSummary, AdminPublishCredentialVerification, AdminPublishExecutionMode } from '@jini-ai/core/contracts/site/api-security-api-types';
import type { CredentialTokenHint } from '@jini-ai/core/contracts/site/secrets-credential-token';
import type { CredentialKind, CredentialSummary, CredentialProvider, CredentialField, RequestOptions, CredentialCategory, RootKeyStatus, RootKeyResult, RootKeyPreview, RootKeyReveal } from '../models.js';
type RawRow = Omit<CredentialSummary, 'kind' | 'providerId' | 'lastVerification'> & { providerId?: string };
/** Explicit projection: a verify result never carries more than its declared fields. */
function verificationOf({ verification: v }: { verification: AdminPublishCredentialVerification }, _optional = {}): AdminPublishCredentialVerification {
  return { status: v.status, message: v.message, checkedAt: v.checkedAt, ...(v.accountLabel !== undefined ? { accountLabel: v.accountLabel } : {}) };
}
function rowFacts({ row }: { row: RawRow }, { verification }: { verification?: AdminPublishCredentialVerification | undefined } = {}) {
  return { ...(row.credentialType ? { credentialType: row.credentialType } : {}), ...(row.worksFor ? { worksFor: Object.freeze([...row.worksFor]) } : {}), ...(verification ? { lastVerification: verificationOf({ verification }) } : {}) };
}
/** Explicit projection strips accidental server extras, including token/ciphertext/hex. */
function summary(row: RawRow, kind: CredentialKind, verification?: AdminPublishCredentialVerification): CredentialSummary {
  return Object.freeze({ ...rowFacts({ row }, { verification }), kind, id: row.id, providerId: row.providerId ?? '', label: row.label, configured: row.configured, isDefault: row.isDefault ?? false, createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...(row.accountLabel !== undefined ? { accountLabel: row.accountLabel } : {}), ...(kind === 'custom' ? { category: row.category ?? 'general', baseUrl: row.baseUrl ?? '', additionalHosts: Object.freeze([...(row.additionalHosts ?? [])]), ...(row.username ? { username: row.username } : {}) } : {}) });
}
interface Descriptor { id: string; label: string; credential?: { vendorLabel?: string; tokenField: string; fields?: readonly CredentialField[]; tokenPageUrl?: string; help?: string; userHelp?: string } }
function trimBase({ workspacePath }: { workspacePath: string }, _optional = {}) { return workspacePath.replace(/\/$/, ''); }
function descriptorExtras({ credential }: { credential: Descriptor['credential'] }, _optional = {}) {
  const help = credential?.userHelp ?? credential?.help;
  return { ...(credential?.tokenPageUrl ? { tokenPageUrl: credential.tokenPageUrl } : {}), ...(help ? { help } : {}) };
}
function providerFromDescriptor({ kind, descriptor: d }: { kind: 'publish' | 'source-control'; descriptor: Descriptor }, _optional = {}): CredentialProvider {
  const c = d.credential;
  return { kind, id: d.id, label: d.label, vendorLabel: c?.vendorLabel ?? d.label, category: kind === 'publish' ? 'hosting' : 'source-control', tokenField: c?.tokenField ?? 'token', fields: c?.fields ?? [], ...descriptorExtras({ credential: c }) };
}
export function createHttpSecurityApi({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, _optional = {}): SecurityApiPort {
  const base = trimBase({ workspacePath });
  function store(kind: CredentialKind, suffix: string): CredentialStorePort {
    const path = `${base}/system/${suffix}/credentials`;
    async function mutate(method: 'POST' | 'PUT', target: string, body: unknown, options: RequestOptions) { options.signal?.throwIfAborted(); const r = await transport.request<{ credential: RawRow; verification?: AdminPublishCredentialVerification }>({ method, path: target, body }, options); return summary(r.credential, kind, r.verification); }
    async function read(options: RequestOptions) {
      options.signal?.throwIfAborted(); const r = await transport.request<{ credentials: readonly RawRow[]; executionMode?: AdminPublishExecutionMode }>({ method: 'GET', path }, options);
      return { rows: Object.freeze(r.credentials.map(row => summary(row, kind))), ...(r.executionMode ? { executionMode: r.executionMode } : {}) };
    }
    async function verify({ id }: { id: string }, options: RequestOptions = {}) { options.signal?.throwIfAborted(); const r = await transport.request<{ verification: AdminPublishCredentialVerification }>({ method: 'POST', path: `${path}/${encodeURIComponent(id)}/verify` }, options); return verificationOf({ verification: r.verification }); }
    return {
      async list(_r, options = {}) { return (await read(options)).rows; },
      snapshot(_r, options = {}) { return read(options); },
      ...(kind === 'publish' ? { verify } : {}),
      create(input, options = {}) { return mutate('POST', path, input, options); },
      update({ id, patch }, options = {}) { return mutate('PUT', `${path}/${encodeURIComponent(id)}`, patch, options); },
      async remove({ id }, options = {}) { options.signal?.throwIfAborted(); await transport.request<void>({ method: 'DELETE', path: `${path}/${encodeURIComponent(id)}` }, options); },
    };
  }
  return {
    async providers({ kind }, options = {}) {
      options.signal?.throwIfAborted();
      const [publish, source] = await Promise.all([
        kind === 'source-control' ? { targets: [] } : transport.request<{ targets: readonly Descriptor[] }>({ method: 'GET', path: `${base}/system/publish-targets` }, options),
        kind === 'publish' ? { providers: [] } : transport.request<{ providers: readonly Descriptor[] }>({ method: 'GET', path: `${base}/system/source-control/providers` }, options),
      ]);
      return [...publish.targets.filter(d => d.credential).map(descriptor => providerFromDescriptor({ kind: 'publish', descriptor })), ...source.providers.map(descriptor => providerFromDescriptor({ kind: 'source-control', descriptor }))];
    },
    publish: store('publish', 'publish'), sourceControl: store('source-control', 'source-control'), custom: store('custom', 'custom'),
  };
}
function tokenHintOf({ hint }: { hint: CredentialTokenHint | null | undefined }, _optional = {}) { return hint ? { tokenHint: { length: hint.length, last4: hint.last4 } } : hint === null ? { tokenHint: null } : {}; }
/** Explicit projection for the shared publish client: no token, ciphertext or connection ever leaves it. */
function publishSummary({ row }: { row: AdminPublishCredentialSummary }, _optional = {}): AdminPublishCredentialSummary {
  return { credentialType: row.credentialType, worksFor: [...row.worksFor], ...tokenHintOf({ hint: row.tokenHint }), id: row.id, providerId: row.providerId, label: row.label, configured: true, isDefault: row.isDefault, createdAt: row.createdAt, updatedAt: row.updatedAt, accountLabel: row.accountLabel ?? null };
}
function publishWrite({ reply: r }: { reply: { credential: AdminPublishCredentialSummary; verification?: AdminPublishCredentialVerification } }, _optional = {}) {
  return { credential: publishSummary({ row: r.credential }), ...(r.verification ? { verification: verificationOf({ verification: r.verification }) } : {}) };
}
/** The publish credential client Deployment and Security share (W1–W5); bodies go out exactly as given. */
export function createHttpPublishCredentials({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, _optional = {}): PublishCredentialsPort {
  const path = `${trimBase({ workspacePath })}/system/publish/credentials`; const item = (id: string) => `${path}/${encodeURIComponent(id)}`;
  async function call<T>(required: Parameters<SecurityTransportPort['request']>[0], options: RequestOptions) { options.signal?.throwIfAborted(); return transport.request<T>(required, options); }
  return {
    async listPublishCredentials(_r = {}, o = {}) { const r = await call<AdminPublishCredentialsSnapshot>({ method: 'GET', path }, o); return { credentials: r.credentials.map(row => publishSummary({ row })), executionMode: r.executionMode }; },
    async createPublishCredential(input, o = {}) { return publishWrite({ reply: await call({ method: 'POST', path, body: input }, o) }); },
    async updatePublishCredential({ id, input }, o = {}) { return publishWrite({ reply: await call({ method: 'PUT', path: item(id), body: input }, o) }); },
    async deletePublishCredential({ id }, o = {}) { await call<void>({ method: 'DELETE', path: item(id) }, o); },
    async verifyPublishCredential({ id }, o = {}) { const r = await call<{ verification: AdminPublishCredentialVerification }>({ method: 'POST', path: `${item(id)}/verify` }, o); return { verification: verificationOf({ verification: r.verification }) }; },
  };
}
interface MediaSettings { baseUrl?: string; model?: string; apiKeyConfigured?: boolean; apiKeyTail?: string; apiKey?: string }
type MediaMap = Readonly<Record<string, MediaSettings>>;
/** Only non-secret settings are echoed back; apiKey is sent solely for the entry being replaced. */
function mediaEntry({ entry }: { entry: MediaSettings }, { apiKey }: { apiKey?: string } = {}): MediaSettings {
  return { ...(entry.baseUrl !== undefined ? { baseUrl: entry.baseUrl } : {}), ...(entry.model !== undefined ? { model: entry.model } : {}), ...(apiKey !== undefined ? { apiKey } : {}) };
}
const MEDIA_PROVIDERS_PATH = '/media/providers';
/** Replacing the ENTIRE map requires sibling settings unchanged. Blank apiKey preserves their stored keys. */
function rebuildMedia(current: MediaMap, id: string, token?: string) {
  const next: Record<string, MediaSettings> = {};
  // The replaced entry is dropped when no token is given; every sibling is echoed unchanged.
  const kept = Object.entries(current).filter(([key]) => key !== id || token !== undefined);
  for (const [key, entry] of kept) next[key] = mediaEntry({ entry }, key === id && token !== undefined ? { apiKey: token } : {});
  return next;
}
export function createHttpOtherCredentials({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, { mediaLabels = {} }: { mediaLabels?: Readonly<Record<string, string>> } = {}): OtherCredentialsPort {
  const base = trimBase({ workspacePath });
  const singles = { 'site-assistant': { path: '/assistant/site-credential', label: 'Assistant model key' }, 'admin-byok': { path: '/assistant/execution-credential', label: 'Admin model key' } };
  async function request<T>(path: string, method: 'GET' | 'PUT' | 'DELETE', options: RequestOptions, body?: unknown) { options.signal?.throwIfAborted(); return transport.request<T>({ path: `${base}${path}`, method, ...(body !== undefined ? { body } : {}) }, options); }
  return {
    async list({ store }, options = {}) {
      if (store === 'site-assistant' || store === 'admin-byok') { const r = await request<{ data: { isSet: boolean; updatedAt: string | null } }>(singles[store].path, 'GET', options); return r.data.isSet ? [{ store, id: store, label: singles[store].label, category: 'ai', configured: true, supportsReplace: true, updatedAt: r.data.updatedAt }] : []; }
      if (store === 'media-provider') { const map = await request<MediaMap>(MEDIA_PROVIDERS_PATH, 'GET', options); return Object.entries(map).filter(([, entry]) => entry.apiKeyConfigured).map(([id]) => ({ store, id, label: mediaLabels[id] ?? id, category: 'media' as CredentialCategory, configured: true, supportsReplace: true })); }
      const { servers } = await request<{ servers: readonly { serverId: string; label: string; envNames: readonly string[] }[] }>('/mcp-servers', 'GET', options); return servers.map(s => ({ store, id: s.serverId, label: s.label, category: 'ai', configured: true, supportsReplace: false, envNames: Object.freeze([...s.envNames]) }));
    },
    async replace({ store, id, token }, options = {}) {
      if (!token.trim()) throw new Error('Enter a credential');
      if (store === 'external-mcp') throw new Error('Edit the full server configuration on its own screen');
      if (store === 'media-provider') { const current = await request<MediaMap>(MEDIA_PROVIDERS_PATH, 'GET', options); await request(MEDIA_PROVIDERS_PATH, 'PUT', options, rebuildMedia(current, id, token)); }
      else await request(singles[store].path, 'PUT', options, { apiKey: token });
    },
    async remove({ store, id }, options = {}) {
      if (store === 'media-provider') { const current = await request<MediaMap>(MEDIA_PROVIDERS_PATH, 'GET', options); await request(MEDIA_PROVIDERS_PATH, 'PUT', options, rebuildMedia(current, id)); }
      else if (store === 'external-mcp') await request(`/mcp-servers/${encodeURIComponent(id)}`, 'DELETE', options);
      else await request(singles[store].path, 'DELETE', options);
    },
  };
}
/** Explicit projection: receivers carry signing secrets the UI must never hold. */
function webhookTargets({ webhooks }: { webhooks: RootKeyPreview['affectedWebhooks'] }, _optional = {}) { return webhooks.map(w => ({ label: w.label, targetUrl: w.targetUrl })); }
/** Explicit projection: a status read never carries key material (`hex`, `token`, a pasted value), even if a server adds it. `envVarName` is kept whenever present, even empty, as the host's client preserves it. */
function rootKeyStatus({ status: r }: { status: RootKeyStatus }, _optional = {}): RootKeyStatus {
  return { active: r.active, source: r.source, state: r.state, keyFilePath: r.keyFilePath, runtimeMode: r.runtimeMode, ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}), ...(r.invalid !== undefined ? { invalid: r.invalid } : {}), ...(r.envVarName !== undefined ? { envVarName: r.envVarName } : {}), ...(r.reason ? { reason: r.reason } : {}) };
}
/** `path` and `importField` let a host keep an existing server wire (e.g. `/system/site-key` with `{ siteKey }`) byte for byte; the defaults are the stock Jini wire. */
export function createHttpRootKey({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, { path: routePath = '/system/site-token', importField = 'token', reveal = false }: { path?: string; importField?: string; reveal?: boolean } = {}): RootKeyPort {
  const path = `${trimBase({ workspacePath })}${routePath}`;
  async function request<T>(suffix: string, method: 'GET' | 'POST', options: RequestOptions, body?: unknown) { options.signal?.throwIfAborted(); return transport.request<T>({ path: `${path}${suffix}`, method, ...(body !== undefined ? { body } : {}) }, options); }
  function result(r: RootKeyResult): RootKeyResult { return { outcome: r.outcome, fingerprint: r.fingerprint, keyFilePath: r.keyFilePath, runtimeMode: r.runtimeMode, ...(r.resealed !== undefined ? { resealed: r.resealed } : {}), ...(r.discarded !== undefined ? { discarded: r.discarded } : {}), ...(r.kept !== undefined ? { kept: r.kept } : {}), ...(r.restorePointId ? { restorePointId: r.restorePointId } : {}), ...(r.affectedWebhooks ? { affectedWebhooks: webhookTargets({ webhooks: r.affectedWebhooks }) } : {}) }; }
  return {
    async status(_r, o = {}) { return rootKeyStatus({ status: await request<RootKeyStatus>('', 'GET', o) }); },
    async generate(_r, o = {}) { return result(await request('/generate', 'POST', o)); },
    async importToken({ token }, o = {}) { return result(await request('/import', 'POST', o, { [importField]: token })); },
    async previewStartFresh(_r, o = {}) { const r = await request<RootKeyPreview>('/start-fresh', 'GET', o); return { removes: r.removes, detail: r.detail, runtimeMode: r.runtimeMode, affectedWebhooks: webhookTargets({ webhooks: r.affectedWebhooks }) }; },
    async startFresh({ confirm }, o = {}) { return result(await request('/start-fresh', 'POST', o, { confirm })); },
    ...(reveal ? { async reveal(_r: Record<string, never>, o: RequestOptions = {}) { return revealReply({ reply: await request<RootKeyReveal>('/reveal', 'POST', o) }); } } : {}),
  };
}
/** Only `active` and a non-empty `hex` leave the adapter; every other status field in the reply is dropped. */
function revealReply({ reply: r }: { reply: RootKeyReveal }, _optional = {}): RootKeyReveal {
  return { active: r.active === true, ...(r.active === true && typeof r.hex === 'string' && r.hex ? { hex: r.hex } : {}) };
}
