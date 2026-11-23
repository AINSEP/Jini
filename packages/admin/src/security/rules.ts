import type { CredentialCategory, CredentialDraft, CredentialKind, CredentialPatch, CredentialProvider, CredentialSummary, OtherCredentialSummary, OtherStoreId, RootKeyStatus } from './models.js';
import type { SecurityApiPort } from './ports.js';
export const START_FRESH_CONFIRMATION = 'START FRESH';
export const ROOT_KEY_PERMISSION = 'admin.security.tokens.manage';
export const CATEGORIES: readonly { value: CredentialCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'source-control', label: 'Source control' },
  { value: 'hosting', label: 'Hosting' }, { value: 'media', label: 'Media' },
  { value: 'ai', label: 'AI' }, { value: 'ops', label: 'Ops' }, { value: 'general', label: 'General' },
];
export const OTHER_STORES: readonly OtherStoreId[] = ['site-assistant', 'admin-byok', 'media-provider', 'external-mcp'];
export function writePermission({ kind }: { kind: CredentialKind }, _optional = {}) {
  if (kind === 'custom') return 'custom-credentials.write';
  return kind === 'publish' ? 'system.publish' : 'source-control.credentials.write';
}
export function otherWritePermission({ store }: { store: OtherStoreId }, _optional = {}) { return store === 'site-assistant' || store === 'admin-byok' ? 'admin.assistant.manage' : 'admin.integrations.manage'; }
export function credentialStore({ api, kind }: { api: SecurityApiPort; kind: CredentialKind }, _optional = {}) {
  if (kind === 'source-control') return api.sourceControl;
  return kind === 'publish' ? api.publish : api.custom;
}
function defaultCategory({ kind }: { kind: CredentialKind }, _optional = {}): CredentialCategory {
  if (kind === 'publish') return 'hosting';
  return kind === 'source-control' ? 'source-control' : 'general';
}
export function blankCredentialDraft({ kind, providerId = '' }: { kind: CredentialKind; providerId?: string }, _optional = {}): CredentialDraft {
  return { kind, providerId, label: '', token: '', values: {}, category: defaultCategory({ kind }), baseUrl: '', additionalHosts: '', username: '' };
}
/** Legacy sentinel labels are display-only: opening this page must never mutate saved data. */
export function credentialLabel({ row, providers }: { row: CredentialSummary; providers: readonly CredentialProvider[] }, _optional = {}) {
  if (row.label !== 'default' || row.kind === 'custom') return row.label;
  return `${providers.find(p => p.kind === row.kind && p.id === row.providerId)?.label ?? row.providerId} token`;
}
export function credentialCategory({ row }: { row: CredentialSummary }, _optional = {}): CredentialCategory { return row.category ?? defaultCategory({ kind: row.kind }); }
export function filterCredentials({ rows, query, category, providers }: { rows: readonly CredentialSummary[]; query: string; category: CredentialCategory | 'all'; providers: readonly CredentialProvider[] }, _optional = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter(row => (category === 'all' || credentialCategory({ row }) === category) && [credentialLabel({ row, providers }), row.providerId, row.baseUrl ?? '', row.accountLabel ?? ''].join(' ').toLowerCase().includes(q));
}
export function filterOtherCredentials({ rows, query, category }: { rows: readonly OtherCredentialSummary[]; query: string; category: CredentialCategory | 'all' }, _optional = {}) { return rows.filter(row => (category === 'all' || row.category === category) && `${row.label} ${row.store}`.toLowerCase().includes(query.trim().toLowerCase())); }
function findProvider({ draft, providers }: { draft: CredentialDraft; providers: readonly CredentialProvider[] }, _optional = {}) { return providers.find(p => p.kind === draft.kind && p.id === draft.providerId); }
function isDuplicateLabel({ draft, rows }: { draft: CredentialDraft; rows: readonly CredentialSummary[] }, _optional = {}) {
  const label = draft.label.trim().toLowerCase();
  const sameScope = (r: CredentialSummary) => r.kind === draft.kind && r.id !== draft.id && (draft.kind === 'custom' || r.providerId === draft.providerId);
  return rows.some(r => sameScope(r) && r.label.trim().toLowerCase() === label);
}
function customDraftError({ draft }: { draft: CredentialDraft }, _optional = {}): string | null {
  try { if (!['http:', 'https:'].includes(new URL(draft.baseUrl).protocol)) return 'Enter an HTTP or HTTPS URL'; } catch { return 'Enter an HTTP or HTTPS URL'; }
  return null;
}
function providerDraftError({ draft, providers }: { draft: CredentialDraft; providers: readonly CredentialProvider[] }, _optional = {}): string | null {
  if (draft.id && !draft.token.trim()) return null;
  const provider = findProvider({ draft, providers });
  if (!provider) return 'Provider is unavailable';
  if (provider.fields.some(f => f.name !== provider.tokenField && f.required && !draft.values[f.name]?.trim())) return 'Complete all required fields';
  return null;
}
/** A custom row is its own provider identity; its username can change without retyping its token. */
export function validateCredentialDraft({ draft, rows, providers }: { draft: CredentialDraft; rows: readonly CredentialSummary[]; providers: readonly CredentialProvider[] }, _optional = {}): string | null {
  if (!draft.label.trim()) return 'Enter a name';
  if (isDuplicateLabel({ draft, rows })) return 'That name is already in use';
  if (!draft.id && !draft.token.trim()) return 'Enter an access token';
  return draft.kind === 'custom' ? customDraftError({ draft }) : providerDraftError({ draft, providers });
}
function customConnection({ draft, token }: { draft: CredentialDraft; token: string }, _optional = {}) {
  const username = draft.username.trim();
  return { token, ...(username ? { username } : {}) };
}
function providerConnection({ draft, token, providers }: { draft: CredentialDraft; token: string; providers: readonly CredentialProvider[] }, _optional = {}) {
  const provider = findProvider({ draft, providers });
  const extras = provider ? provider.fields.filter(f => f.name !== provider.tokenField && draft.values[f.name]?.trim()).map(f => [f.name, draft.values[f.name]!.trim()]) : [];
  return { providerId: draft.providerId, [provider?.tokenField ?? 'token']: token, ...Object.fromEntries(extras) };
}
function customPatchFields({ draft }: { draft: CredentialDraft }, _optional = {}) {
  return { category: draft.category, baseUrl: draft.baseUrl.trim(), additionalHosts: draft.additionalHosts.split(/[\n,]/).map(s => s.trim()).filter(Boolean), username: draft.username.trim() || null };
}
/** Omitting connection preserves the saved secret. Never send an empty or half-blank replacement. */
export function buildCredentialPatch({ draft, providers }: { draft: CredentialDraft; providers: readonly CredentialProvider[] }, _optional = {}): CredentialPatch {
  const token = draft.token.trim();
  const custom = draft.kind === 'custom';
  const connectionFor = (value: string) => (custom ? customConnection({ draft, token: value }) : providerConnection({ draft, token: value, providers }));
  const connection = token ? connectionFor(token) : undefined;
  return { label: draft.label.trim(), ...(connection ? { connection } : {}), ...(custom ? customPatchFields({ draft }) : {}) };
}
export function isRootKeyLocked({ status }: { status: RootKeyStatus | null }, _optional = {}) { return status?.state === 'missing-with-data' || status?.state === 'mismatch'; }
/** A translatable line: a message key, its variables, and an optional path rendered as code. */
export interface RootKeyCopy { readonly key: string; readonly vars: Readonly<Record<string, string>>; readonly path?: string }
export type RootKeyBadgeTone = 'info' | 'success' | 'warning';
/** Badge copy keeps env provenance here so rendering has no source policy. The env var name is the
 * server's, else the host default; a name, never a value. */
export function rootKeyBadge({ status }: { status: RootKeyStatus }, { defaultEnvVarName }: { defaultEnvVarName?: string } = {}): RootKeyCopy & { readonly tone: RootKeyBadgeTone } {
  const tone: RootKeyBadgeTone = status.invalid ? 'warning' : status.active ? 'success' : 'info';
  if (!status.active) return { key: 'rootKeyBadgeNone', vars: {}, tone };
  if (status.source !== 'env') return { key: 'rootKeyBadgeFile', vars: {}, tone };
  return { ...envCopy({ key: 'rootKeyBadgeEnv', name: status.envVarName ?? defaultEnvVarName }), tone };
}
function envCopy({ key, name }: { key: string; name: string | undefined }, _optional = {}): RootKeyCopy {
  return name === undefined ? { key: `${key}Unnamed`, vars: {} } : { key, vars: { name } };
}
/** One plain sentence per source under the badge; a path is kept out of the prose and shown as code. */
export function rootKeySourceNote({ status }: { status: RootKeyStatus }, { defaultEnvVarName }: { defaultEnvVarName?: string } = {}): RootKeyCopy {
  if (status.invalid) return status.source === 'env' ? envCopy({ key: 'rootKeyNoteInvalidEnv', name: status.envVarName ?? defaultEnvVarName }) : { key: 'rootKeyNoteInvalidFile', vars: {}, path: status.keyFilePath };
  if (status.source === 'env') return { key: 'rootKeyNoteEnv', vars: {} };
  if (status.source === 'file') return { key: 'rootKeyNoteFile', vars: {}, path: status.keyFilePath };
  return { key: 'rootKeyNoteNone', vars: {} };
}
/** What the host's describer says about a failure: a server code and its public, plain-words detail.
 * The module never reads a raw `Error.message`, which may echo submitted key material. */
export interface RootKeyErrorDescription { readonly code?: string; readonly detail?: string }
export type DescribeRootKeyError = (required: { error: unknown }, optional?: Record<string, never>) => RootKeyErrorDescription;
/** `locked`: saved credentials need a key that is not here. `refused`: nothing changed for another
 * reason. `already-exists`: a key appeared mid-request (create-only, never overwrite). */
export type RootKeyGenerateFailure =
  | { readonly kind: 'locked'; readonly code: string; readonly detail?: string }
  | { readonly kind: 'refused'; readonly code: string; readonly detail?: string }
  | { readonly kind: 'already-exists' }
  | { readonly kind: 'generic'; readonly detail?: string };
const LOCKED_CODES: readonly string[] = ['KEY_DEPENDENT_DATA', 'KEY_MISMATCH'];
const REFUSED_CODES: readonly string[] = ['KEY_INVALID', 'SITE_META_UNREADABLE'];
export function classifyRootKeyGenerateFailure({ description }: { description: RootKeyErrorDescription }, _optional = {}): RootKeyGenerateFailure {
  const { code } = description, detail = description.detail === undefined ? {} : { detail: description.detail };
  if (code !== undefined && LOCKED_CODES.includes(code)) return { kind: 'locked', code, ...detail };
  if (code !== undefined && REFUSED_CODES.includes(code)) return { kind: 'refused', code, ...detail };
  if (code === 'ALREADY_EXISTS') return { kind: 'already-exists' };
  return { kind: 'generic', ...detail };
}
export const ROOT_KEY_GENERATE_FAILED = 'Root key could not be created.';
export const ROOT_KEY_ALREADY_EXISTS = 'A root key already exists. This tab only creates a key; it never overwrites one.';
/** The shown text is the described detail or fixed copy, so a raw message cannot reach the page. */
export function rootKeyGenerateFailureText({ failure }: { failure: RootKeyGenerateFailure }, _optional = {}): string {
  if (failure.kind === 'already-exists') return ROOT_KEY_ALREADY_EXISTS;
  return failure.detail ? failure.detail : ROOT_KEY_GENERATE_FAILED;
}
