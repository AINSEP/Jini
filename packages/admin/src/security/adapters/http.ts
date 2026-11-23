import type { SecurityApiPort, CredentialStorePort, SecurityTransportPort, OtherCredentialsPort, RootKeyPort, PublishCredentialsPort } from '../ports.js';
import type { AdminPublishCredentialsSnapshot, AdminPublishCredentialSummary, AdminPublishCredentialVerification, AdminPublishExecutionMode } from '@jini-ai/core/contracts/site/api-security-api-types';
import type { CredentialTokenHint } from '@jini-ai/core/contracts/site/secrets-credential-token';
import type { AdminCredentialCopyResult, AdminCredentialCopySource } from '@jini-ai/core/contracts/site/api-security-api-types';
import type { CredentialKind, CredentialSummary, CredentialProvider, CredentialField, RequestOptions, CredentialCategory, RootKeyStatus, RootKeyResult, RootKeyPreview, RootKeyReveal } from '../models.js';
type RawRow = Omit<CredentialSummary, 'kind' | 'providerId' | 'lastVerification'> & { providerId?: string };
/** Explicit projection: a verify result never carries more than its declared fields. */
function verificationOf({ verification: v }: { verification: AdminPublishCredentialVerification }, _optional = {}): AdminPublishCredentialVerification {
  return { status: v.status, message: v.message, checkedAt: v.checkedAt, ...(v.accountLabel !== undefined ? { accountLabel: v.accountLabel } : {}) };
}
function rowFacts({ row }: { row: RawRow }, { verification }: { verification?: AdminPublishCredentialVerification | undefined } = {}) {
  return { ...(row.credentialType ? { credentialType: row.credentialType } : {}), ...(row.worksFor ? { worksFor: Object.freeze([...row.worksFor]) } : {}), ...(verification ? { lastVerification: verificationOf({ verification }) } : {}), ...tokenHintOf({ hint: row.tokenHint }) };
}
/** Custom storage facts (OD-3 c), copied field by field: where the key lives and which sites use it. */
function storageFacts({ row }: { row: RawRow }, _optional = {}) {
  return { ...(row.scope === 'project' || row.scope === 'site' ? { scope: row.scope } : {}), ...(Array.isArray(row.usedBy) ? { usedBy: Object.freeze(row.usedBy.map(String)) } : {}), ...(typeof row.usedByThisSite === 'boolean' ? { usedByThisSite: row.usedByThisSite } : {}) };
}
/** Explicit projection strips accidental server extras, including token/ciphertext/hex. */
function summary(row: RawRow, kind: CredentialKind, verification?: AdminPublishCredentialVerification): CredentialSummary {
  return Object.freeze({ ...rowFacts({ row }, { verification }), kind, id: row.id, providerId: row.providerId ?? '', label: row.label, configured: row.configured, isDefault: row.isDefault ?? false, createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...(row.accountLabel !== undefined ? { accountLabel: row.accountLabel } : {}), ...(kind === 'custom' ? { ...storageFacts({ row }), category: row.category ?? 'general', baseUrl: row.baseUrl ?? '', additionalHosts: Object.freeze([...(row.additionalHosts ?? [])]), ...(row.username ? { username: row.username } : {}) } : {}) });
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
/** `sharedKeys: true` adds Shared Keys (W9) and project-key use (W10); a host without those endpoints leaves it off and no control renders. */
export function createHttpSecurityApi({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, { sharedKeys = false }: { sharedKeys?: boolean } = {}): SecurityApiPort {
  const base = trimBase({ workspacePath });
  function store(kind: CredentialKind, suffix: string): CredentialStorePort {
    const path = `${base}/system/${suffix}/credentials`;
    async function mutate(method: 'POST' | 'PUT', target: string, body: unknown, options: RequestOptions) { options.signal?.throwIfAborted(); const r = await transport.request<{ credential: RawRow; verification?: AdminPublishCredentialVerification }>({ method, path: target, body }, options); return summary(r.credential, kind, r.verification); }
    async function read(options: RequestOptions) {
      options.signal?.throwIfAborted(); const r = await transport.request<{ credentials: readonly RawRow[]; executionMode?: AdminPublishExecutionMode; projectKeysAvailable?: boolean }>({ method: 'GET', path }, options);
      return { rows: Object.freeze(r.credentials.map(row => summary(row, kind))), ...(r.executionMode ? { executionMode: r.executionMode } : {}), ...(typeof r.projectKeysAvailable === 'boolean' ? { projectKeysAvailable: r.projectKeysAvailable } : {}) };
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
    ...(sharedKeys ? sharedKeysMembers({ transport, base }) : {}),
  };
}
function sharedKeysMembers({ transport, base }: { transport: SecurityTransportPort; base: string }, _optional = {}): Pick<SecurityApiPort, 'sharedKeys' | 'useProjectKey'> {
  const copy = createHttpCredentialCopy({ transport, workspacePath: base });
  return {
    sharedKeys: { async list(_r, o = {}) { return (await copy.listCredentialCopySources({}, o)).sources; }, async grant(input, o = {}) { return (await copy.copyCredentials(input, o)).results; } },
    async useProjectKey({ keyId, use }, o = {}) { o.signal?.throwIfAborted(); await transport.request<unknown>({ method: 'PUT', path: `${base}/project-keys/${encodeURIComponent(keyId)}/use`, body: { use } }, o); },
  };
}
type CopyKey = AdminCredentialCopySource['keys'][number];
/** Copies only the named scalar (or string-list) fields; anything else a server adds is dropped. */
function scalarFields<K extends string>({ from, names }: { from: Partial<Record<K, unknown>>; names: readonly K[] }, _optional = {}) {
  const out: Partial<Record<K, unknown>> = {};
  for (const name of names) { const v = from[name]; if (typeof v === 'string' || typeof v === 'number') out[name] = v; else if (Array.isArray(v)) out[name] = v.map(String); }
  return out;
}
/** Explicit projection: an inventory row is metadata only. Nested connection, secret or ciphertext never leave the adapter. */
function copyKey({ key }: { key: CopyKey }, _optional = {}): CopyKey {
  return { kind: key.kind, id: key.id, label: key.label, provider: typeof key.provider === 'string' ? key.provider : null, ...scalarFields({ from: key, names: ['worksFor', 'publishHosts', 'last4', 'siteName', 'locked', 'omittedCount'] }) } as CopyKey;
}
function copySource({ source: s }: { source: AdminCredentialCopySource }, _optional = {}): AdminCredentialCopySource {
  const hint = s.actionHint ? { actionHint: { action: s.actionHint.action, siteId: s.actionHint.siteId, desktopSiteId: s.actionHint.desktopSiteId } } : {};
  return { siteId: s.siteId, name: s.name, keys: s.keys.map(key => copyKey({ key })), ...scalarFields({ from: s, names: ['reasonCode', 'message'] }), ...hint } as AdminCredentialCopySource;
}
/** A grant result keeps its status, the server's four-character hint and reason code; nothing else. */
function copyResult({ result: r }: { result: AdminCredentialCopyResult }, _optional = {}): AdminCredentialCopyResult {
  return { kind: r.kind, id: r.id, status: r.status, ...scalarFields({ from: r, names: ['last4', 'reasonCode'] }) } as AdminCredentialCopyResult;
}
/** The Shared Keys client under the host's names (W9). The grant body keeps the host wire byte for byte. */
export function createHttpCredentialCopy({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, _optional = {}) {
  const path = `${trimBase({ workspacePath })}/system/credential-copy`;
  return {
    async listCredentialCopySources(_r: Record<string, never> = {}, o: RequestOptions = {}) {
      o.signal?.throwIfAborted(); const r = await transport.request<{ sources: readonly AdminCredentialCopySource[] }>({ method: 'GET', path }, o);
      return { sources: r.sources.map(source => copySource({ source })) };
    },
    async copyCredentials(input: { sourceSiteId: string; ids: readonly string[]; overwrite: boolean }, o: RequestOptions = {}) {
      o.signal?.throwIfAborted(); const r = await transport.request<{ results: readonly AdminCredentialCopyResult[] }>({ method: 'POST', path, body: { sourceSiteId: input.sourceSiteId, ids: [...input.ids], overwrite: input.overwrite } }, o);
      return { results: r.results.map(result => copyResult({ result })) };
    },
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
interface MediaSettings { baseUrl?: string; model?: string; apiKeyConfigured?: boolean; apiKeyTail?: string; apiKey?: string; apiKeyHint?: CredentialTokenHint | null }
type MediaMap = Readonly<Record<string, MediaSettings>>;
/** W12 order. `'in-place'` (the default) keeps a replaced entry where it was; `'replaced-last'` moves it
 * last as `{ apiKey, ...kept }`, the order a host's existing client writes. */
export type MediaWriteOrder = 'in-place' | 'replaced-last';
/** Only non-secret settings are echoed back; apiKey is sent solely for the entry being replaced. */
function mediaEntry({ entry }: { entry: MediaSettings }, { apiKey }: { apiKey?: string } = {}): MediaSettings {
  return { ...(entry.baseUrl !== undefined ? { baseUrl: entry.baseUrl } : {}), ...(entry.model !== undefined ? { model: entry.model } : {}), ...(apiKey !== undefined ? { apiKey } : {}) };
}
const MEDIA_PROVIDERS_PATH = '/media/providers';
/** Replacing the ENTIRE map requires sibling settings unchanged. Blank apiKey preserves their stored keys. */
function rebuildMedia({ current, id, token }: { current: MediaMap; id: string; token?: string | undefined }, { order = 'in-place' }: { order?: MediaWriteOrder } = {}) {
  const next: Record<string, MediaSettings> = {};
  // The replaced entry is dropped when no token is given; every sibling is echoed unchanged.
  const kept = Object.entries(current).filter(([key]) => key !== id || (token !== undefined && order === 'in-place'));
  for (const [key, entry] of kept) next[key] = mediaEntry({ entry }, key === id && token !== undefined ? { apiKey: token } : {});
  // A provider not in the map yet, or one moved last, is written last as `{ apiKey, ...kept }`.
  if (token !== undefined && !Object.hasOwn(next, id)) next[id] = { apiKey: token, ...mediaEntry({ entry: Object.hasOwn(current, id) ? current[id]! : {} }) };
  return next;
}
/** A server-approved hint. At most four characters leave, whatever the server sends: a longer tail
 * (or a pre-masked `••••tail`) is cut to its last four, and the hint's `length` is kept only as a number. */
function maskedHint({ hint, tail }: { hint?: CredentialTokenHint | null | undefined; tail?: string | null | undefined }, _optional = {}) {
  if (hint?.last4) return { tokenHint: { last4: hint.last4.slice(-4), ...(typeof hint.length === 'number' ? { length: hint.length } : {}) } };
  const bare = tail?.replace(/^•+/, '');
  return bare ? { tokenHint: { last4: bare.slice(-4) } } : {};
}
type SingleReply = { data: { isSet: boolean; updatedAt: string | null; tokenHint?: CredentialTokenHint | null; masked?: string | null } };
type McpServerReply = { serverId: string; label: string; envNames: readonly string[]; builtIn?: boolean; accessTokenHint?: CredentialTokenHint | null };
/** `tokenHints: true` projects the server's masked hints (P46 policy flag); off, no hint is read at all. */
export function createHttpOtherCredentials({ transport, workspacePath }: { transport: SecurityTransportPort; workspacePath: string }, { mediaLabels = {}, mediaOrder = 'in-place', tokenHints = false }: { mediaLabels?: Readonly<Record<string, string>>; mediaOrder?: MediaWriteOrder; tokenHints?: boolean } = {}): OtherCredentialsPort {
  const base = trimBase({ workspacePath });
  const singles = { 'site-assistant': { path: '/assistant/site-credential', label: 'Assistant model key' }, 'admin-byok': { path: '/assistant/execution-credential', label: 'Admin model key' } };
  async function request<T>(path: string, method: 'GET' | 'PUT' | 'DELETE', options: RequestOptions, body?: unknown) { options.signal?.throwIfAborted(); return transport.request<T>({ path: `${base}${path}`, method, ...(body !== undefined ? { body } : {}) }, options); }
  const hintOf = (source: Parameters<typeof maskedHint>[0]) => (tokenHints ? maskedHint(source) : {});
  async function writeMedia({ id, token }: { id: string; token?: string }, options: RequestOptions) { const current = await request<MediaMap>(MEDIA_PROVIDERS_PATH, 'GET', options); await request(MEDIA_PROVIDERS_PATH, 'PUT', options, rebuildMedia({ current, id, token }, { order: mediaOrder })); }
  return {
    async list({ store }, options = {}) {
      if (store === 'site-assistant' || store === 'admin-byok') { const r = await request<SingleReply>(singles[store].path, 'GET', options); return r.data.isSet ? [{ store, id: store, label: singles[store].label, category: 'ai', configured: true, supportsReplace: true, updatedAt: r.data.updatedAt, ...hintOf({ hint: r.data.tokenHint, tail: r.data.masked }) }] : []; }
      if (store === 'media-provider') { const map = await request<MediaMap>(MEDIA_PROVIDERS_PATH, 'GET', options); return Object.entries(map).filter(([, entry]) => entry.apiKeyConfigured).map(([id, entry]) => ({ store, id, label: mediaLabels[id] ?? id, category: 'media' as CredentialCategory, configured: true, supportsReplace: true, ...hintOf({ hint: entry.apiKeyHint, tail: entry.apiKeyTail }) })); }
      // A host's built-in servers are not user credentials, so they are never listed (or removable) here.
      const { servers } = await request<{ servers: readonly McpServerReply[] }>('/mcp-servers', 'GET', options); return servers.filter(s => !s.builtIn).map(s => ({ store, id: s.serverId, label: s.label, category: 'ai', configured: true, supportsReplace: false, envNames: Object.freeze([...s.envNames]), ...hintOf({ hint: s.accessTokenHint }) }));
    },
    async replace({ store, id, token }, options = {}) {
      if (!token.trim()) throw new Error('Enter a credential');
      if (store === 'external-mcp') throw new Error('Edit the full server configuration on its own screen');
      if (store === 'media-provider') await writeMedia({ id, token }, options);
      else await request(singles[store].path, 'PUT', options, { apiKey: token });
    },
    async remove({ store, id }, options = {}) {
      if (store === 'media-provider') await writeMedia({ id }, options);
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
