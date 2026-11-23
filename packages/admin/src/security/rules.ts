import { englishSecurity, type SecurityTranslator } from './messages.en.js';
import type { CredentialTokenHint } from '@jini-ai/core/contracts/site/secrets-credential-token';
import type { CredentialCategory, CredentialDraft, CredentialKind, CredentialPatch, CredentialProvider, CredentialSummary, OtherCredentialSummary, OtherStoreId, RootKeyStatus } from './models.js';
import type { SecurityApiPort } from './ports.js';
import { customCreateFields, customUpdateFields, invalidAdditionalHosts, isValidHttpUrl, worksForPart, type SavedCredentialFacts } from './credential-forms.rules.js';
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
/** First legacy row for a provider gets "{Provider} token"; any additional legacy rows get "{Provider} token 2", "{Provider} token 3", ... so names never collide. */
export function legacyCredentialLabel({ providerLabel, index }: { providerLabel: string; index: number }, _optional = {}) {
  return index === 0 ? `${providerLabel} token` : `${providerLabel} token ${index + 1}`;
}
/** Legacy sentinel labels are display-only: opening this page must never mutate saved data. `rows` numbers repeated sentinels per provider. */
export function credentialLabel({ row, providers }: { row: CredentialSummary; providers: readonly CredentialProvider[] }, { rows = [] }: { rows?: readonly CredentialSummary[] } = {}) {
  if (row.label !== 'default' || row.kind === 'custom') return row.label;
  const legacy = rows.filter(r => r.kind === row.kind && r.providerId === row.providerId && r.label === 'default');
  return legacyCredentialLabel({ providerLabel: providers.find(p => p.kind === row.kind && p.id === row.providerId)?.label ?? row.providerId, index: Math.max(0, legacy.findIndex(r => r.id === row.id)) });
}
/** `providers` plus a bare entry for every saved publish or source-control row whose provider is not listed, so no saved credential ever drops off the page: it must stay visible and removable. Custom rows group on their own. */
export function providersWithSavedRows({ providers, rows }: { providers: readonly CredentialProvider[]; rows: readonly CredentialSummary[] }, _optional = {}): CredentialProvider[] {
  const all = [...providers];
  for (const row of rows) {
    if (row.kind === 'custom' || all.some(p => p.kind === row.kind && p.id === row.providerId)) continue;
    all.push({ kind: row.kind, id: row.providerId, label: row.providerId, vendorLabel: row.providerId, category: row.kind === 'source-control' ? 'source-control' : 'hosting', tokenField: 'token', fields: [], unlisted: true });
  }
  return all;
}
const CATEGORY_RANK = Object.fromEntries(CATEGORIES.filter(c => c.value !== 'all').map((c, rank) => [c.value, rank])) as Record<CredentialCategory, number>;
function categoryLabel({ category }: { category: CredentialCategory }, _optional = {}) { return CATEGORIES.find(c => c.value === category)?.label ?? category; }
export interface CredentialGroupSortInput { readonly provider: Pick<CredentialProvider, 'category' | 'label'>; readonly rows: readonly unknown[] }
/** Groups with a saved row first, then the filter chips' category order, then label (locale-aware, case-insensitive). Returns a new array. */
export function sortCredentialGroups<T extends CredentialGroupSortInput>({ groups }: { groups: readonly T[] }, _optional = {}): T[] {
  return [...groups].sort((a, b) => Number(b.rows.length > 0) - Number(a.rows.length > 0) || CATEGORY_RANK[a.provider.category] - CATEGORY_RANK[b.provider.category]
    || a.provider.label.trim().toLocaleLowerCase().localeCompare(b.provider.label.trim().toLocaleLowerCase()));
}
function matchesText({ query, texts }: { query: string; texts: readonly string[] }, _optional = {}) { const q = query.trim().toLowerCase(); return q === '' || texts.some(text => text.toLowerCase().includes(q)); }
/** A not-connected provider stays findable by its own label or purpose. */
export function providerMatchesQuery({ provider, query }: { provider: Pick<CredentialProvider, 'category' | 'label'>; query: string }, _optional = {}) { return matchesText({ query, texts: [provider.label, categoryLabel({ category: provider.category })] }); }
/** A row matches on its provider's label and purpose and on its own display name. */
export function rowMatchesQuery({ row, provider, query }: { row: CredentialSummary; provider: Pick<CredentialProvider, 'category' | 'label'>; query: string }, { name = row.label }: { name?: string } = {}) {
  return matchesText({ query, texts: [provider.label, categoryLabel({ category: provider.category }), name] });
}
/** One whole sentence per state; the noun's plural follows the total, never the matched subset. `query` is shown as typed. */
export function credentialCountText({ total, matched, query }: { total: number; matched: number; query: string }, { t = englishSecurity }: { t?: SecurityTranslator } = {}) {
  if (query.trim() === '') return t(total === 1 ? 'tokenCountOne' : 'tokenCountMany', { count: total });
  return t(total === 1 ? 'tokenCountMatchingOne' : 'tokenCountMatchingMany', { matched, count: total, query });
}
/** The server's masked hint, displayed exactly as sent: "…last4, N chars", or "N chars" when it sent no tail (OD-3 c). */
export function formatTokenHint({ hint }: { hint: CredentialTokenHint | null | undefined }, { t = englishSecurity }: { t?: SecurityTranslator } = {}) {
  if (!hint) return '';
  const chars = t('tokenHintChars', { length: hint.length });
  if (hint.last4 === null) return chars;
  // A literal leading dot belongs to the tail; separate it from the ellipsis without rewriting it.
  return `…${hint.last4.startsWith('.') ? '\u202f' : ''}${hint.last4}, ${chars}`;
}
/** Replacing a project key rewrites the one shared row, so every other site using it switches too.
 * The owner is warned before saving; null when no other site uses the key. */
export function sharedKeyRotationWarning({ row }: { row: Pick<CredentialSummary, 'scope' | 'usedBy' | 'usedByThisSite'> }, { t = englishSecurity }: { t?: SecurityTranslator } = {}): string | null {
  const others = row.scope === 'project' ? (row.usedBy?.length ?? 0) - (row.usedByThisSite ? 1 : 0) : 0;
  if (others < 1) return null;
  return others === 1 ? t('sharedKeyRotationOne') : t('sharedKeyRotationMany', { count: others });
}
export function credentialCategory({ row }: { row: CredentialSummary }, _optional = {}): CredentialCategory { return row.category ?? defaultCategory({ kind: row.kind }); }
export function filterCredentials({ rows, query, category, providers }: { rows: readonly CredentialSummary[]; query: string; category: CredentialCategory | 'all'; providers: readonly CredentialProvider[] }, _optional = {}) {
  const q = query.trim().toLowerCase();
  // Provider label and purpose are searchable too, so a row is found by what it connects to.
  const facts = (row: CredentialSummary) => [credentialLabel({ row, providers }, { rows }), row.providerId, row.baseUrl ?? '', row.accountLabel ?? '', providers.find(p => p.kind === row.kind && p.id === row.providerId)?.label ?? '', categoryLabel({ category: credentialCategory({ row }) })];
  return rows.filter(row => (category === 'all' || credentialCategory({ row }) === category) && facts(row).join(' ').toLowerCase().includes(q));
}
export function filterOtherCredentials({ rows, query, category }: { rows: readonly OtherCredentialSummary[]; query: string; category: CredentialCategory | 'all' }, _optional = {}) { return rows.filter(row => (category === 'all' || row.category === category) && `${row.label} ${row.store}`.toLowerCase().includes(query.trim().toLowerCase())); }
function findProvider({ draft, providers }: { draft: CredentialDraft; providers: readonly CredentialProvider[] }, _optional = {}) { return providers.find(p => p.kind === draft.kind && p.id === draft.providerId); }
function isDuplicateLabel({ draft, rows }: { draft: CredentialDraft; rows: readonly CredentialSummary[] }, _optional = {}) {
  const label = draft.label.trim().toLowerCase();
  const sameScope = (r: CredentialSummary) => r.kind === draft.kind && r.id !== draft.id && (draft.kind === 'custom' || r.providerId === draft.providerId);
  return rows.some(r => sameScope(r) && r.label.trim().toLowerCase() === label);
}
function customDraftError({ draft }: { draft: CredentialDraft }, _optional = {}): string | null {
  if (!isValidHttpUrl({ value: draft.baseUrl.trim() })) return 'Enter an HTTP or HTTPS URL';
  // Every additional host is its own origin the credential may call, so each one must parse on its own.
  return invalidAdditionalHosts({ raw: draft.additionalHosts }).length > 0 ? 'Each additional host must be a valid http:// or https:// URL.' : null;
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
/** Omitting connection preserves the saved secret. Never send an empty or half-blank replacement.
 * A create sends its whole body; an edit (`saved`) sends only what changed (W2/W3/W8): a rename
 * without a token is `{ label }` alone, and extra fields only ever travel inside `connection`. */
export function buildCredentialPatch({ draft, providers }: { draft: CredentialDraft; providers: readonly CredentialProvider[] }, { saved }: { saved?: SavedCredentialFacts | undefined } = {}): CredentialPatch {
  const token = draft.token.trim();
  const custom = draft.kind === 'custom';
  const connectionFor = (value: string) => (custom ? customConnection({ draft, token: value }) : providerConnection({ draft, token: value, providers }));
  const connection = token ? { connection: connectionFor(token) } : {};
  const label = draft.label.trim();
  if (!draft.id || !saved) return { label, ...worksForPart({ draft }), ...(custom ? customCreateFields({ draft }) : {}), ...connection };
  return { ...worksForPart({ draft, saved: saved.worksFor }), ...(label !== saved.label.trim() ? { label } : {}), ...connection, ...(custom ? customUpdateFields({ draft, saved }) : {}) };
}
/** Locked: saved credentials need a key that is not here, per the status or a `locked` create refusal. */
export function isRootKeyLocked({ status, generateFailure = null }: { status: RootKeyStatus | null; generateFailure?: RootKeyGenerateFailure | null }, _optional = {}) {
  return generateFailure?.kind === 'locked' || status?.state === 'missing-with-data' || status?.state === 'mismatch';
}
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
/** What the host's describer says about a failure. Only `code` is read: a `detail` is reader text (it
 * may echo submitted key material) and is ignored, as is a raw `Error.message`. */
export interface RootKeyErrorDescription { readonly code?: string; readonly detail?: string }
export type DescribeRootKeyError = (required: { error: unknown }, optional?: Record<string, never>) => RootKeyErrorDescription;
/** `locked`: saved credentials need a key that is not here. `refused`: nothing changed for another
 * reason. `already-exists`: a key appeared mid-request (create-only, never overwrite). */
export type RootKeyGenerateFailure =
  | { readonly kind: 'locked'; readonly code: string }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'already-exists' }
  | { readonly kind: 'generic'; readonly code?: string };
/** Host-approved public copy for a refusal code (already translated), or `undefined` for fixed copy. */
export type DescribeRootKeyRefusal = (required: { code: string }, optional?: Record<string, never>) => string | undefined;
const LOCKED_CODES: readonly string[] = ['KEY_DEPENDENT_DATA', 'KEY_MISMATCH'];
const REFUSED_CODES: readonly string[] = ['KEY_INVALID', 'SITE_META_UNREADABLE'];
/** Keeps only the code; the described `detail` never travels on (see `RootKeyErrorDescription`). */
export function classifyRootKeyGenerateFailure({ description }: { description: RootKeyErrorDescription }, _optional = {}): RootKeyGenerateFailure {
  const { code } = description;
  if (code === undefined) return { kind: 'generic' };
  if (LOCKED_CODES.includes(code)) return { kind: 'locked', code };
  if (REFUSED_CODES.includes(code)) return { kind: 'refused', code };
  return code === 'ALREADY_EXISTS' ? { kind: 'already-exists' } : { kind: 'generic', code };
}
export const ROOT_KEY_GENERATE_FAILED = 'Root key could not be created.';
export const ROOT_KEY_ALREADY_EXISTS = 'A root key already exists. This tab only creates a key; it never overwrites one.';
/** Host-approved copy for a code, else the fallback. A throwing or silent describer reads as no copy. */
export function rootKeyRefusalText({ code, fallback }: { code?: string | undefined; fallback: string }, { describeRefusal }: { describeRefusal?: DescribeRootKeyRefusal | undefined } = {}): string {
  if (code === undefined || !describeRefusal) return fallback;
  try { return describeRefusal({ code }) || fallback; } catch { return fallback; }
}
/** The shown text is host copy for the code or fixed copy, so reader text cannot reach the page. */
export function rootKeyGenerateFailureText({ failure }: { failure: RootKeyGenerateFailure }, { describeRefusal }: { describeRefusal?: DescribeRootKeyRefusal | undefined } = {}): string {
  if (failure.kind === 'already-exists') return ROOT_KEY_ALREADY_EXISTS;
  return rootKeyRefusalText({ code: failure.code, fallback: ROOT_KEY_GENERATE_FAILED }, { describeRefusal });
}
