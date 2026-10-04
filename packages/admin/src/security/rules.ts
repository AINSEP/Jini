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
export function writePermission({ kind }: { kind: CredentialKind }, _optional = {}) { return kind === 'custom' ? 'custom-credentials.write' : kind === 'publish' ? 'system.publish' : 'source-control.credentials.write'; }
export function otherWritePermission({ store }: { store: OtherStoreId }, _optional = {}) { return store === 'site-assistant' || store === 'admin-byok' ? 'admin.assistant.manage' : 'admin.integrations.manage'; }
export function credentialStore({ api, kind }: { api: SecurityApiPort; kind: CredentialKind }, _optional = {}) { return kind === 'source-control' ? api.sourceControl : kind === 'publish' ? api.publish : api.custom; }
export function blankCredentialDraft({ kind, providerId = '' }: { kind: CredentialKind; providerId?: string }, _optional = {}): CredentialDraft {
  return { kind, providerId, label: '', token: '', values: {}, category: kind === 'publish' ? 'hosting' : kind === 'source-control' ? 'source-control' : 'general', baseUrl: '', additionalHosts: '', username: '' };
}
/** Legacy sentinel labels are display-only: opening this page must never mutate saved data. */
export function credentialLabel({ row, providers }: { row: CredentialSummary; providers: readonly CredentialProvider[] }, _optional = {}) {
  if (row.label !== 'default' || row.kind === 'custom') return row.label;
  return `${providers.find(p => p.kind === row.kind && p.id === row.providerId)?.label ?? row.providerId} token`;
}
export function credentialCategory({ row }: { row: CredentialSummary }, _optional = {}): CredentialCategory { return row.category ?? (row.kind === 'publish' ? 'hosting' : row.kind === 'source-control' ? 'source-control' : 'general'); }
export function filterCredentials({ rows, query, category, providers }: { rows: readonly CredentialSummary[]; query: string; category: CredentialCategory | 'all'; providers: readonly CredentialProvider[] }, _optional = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter(row => (category === 'all' || credentialCategory({ row }) === category) && [credentialLabel({ row, providers }), row.providerId, row.baseUrl ?? '', row.accountLabel ?? ''].join(' ').toLowerCase().includes(q));
}
export function filterOtherCredentials({ rows, query, category }: { rows: readonly OtherCredentialSummary[]; query: string; category: CredentialCategory | 'all' }, _optional = {}) { return rows.filter(row => (category === 'all' || row.category === category) && `${row.label} ${row.store}`.toLowerCase().includes(query.trim().toLowerCase())); }
/** A custom row is its own provider identity; its username can change without retyping its token. */
export function validateCredentialDraft({ draft, rows, providers }: { draft: CredentialDraft; rows: readonly CredentialSummary[]; providers: readonly CredentialProvider[] }, _optional = {}): string | null {
  if (!draft.label.trim()) return 'Enter a name';
  if (rows.some(r => r.kind === draft.kind && r.id !== draft.id && (draft.kind === 'custom' || r.providerId === draft.providerId) && r.label.trim().toLowerCase() === draft.label.trim().toLowerCase())) return 'That name is already in use';
  if (!draft.id && !draft.token.trim()) return 'Enter an access token';
  if (draft.kind === 'custom') {
    try { if (!['http:', 'https:'].includes(new URL(draft.baseUrl).protocol)) return 'Enter an HTTP or HTTPS URL'; } catch { return 'Enter an HTTP or HTTPS URL'; }
  } else if (!draft.id || draft.token.trim()) {
    const provider = providers.find(p => p.kind === draft.kind && p.id === draft.providerId);
    if (!provider) return 'Provider is unavailable';
    if (provider.fields.some(f => f.name !== provider.tokenField && f.required && !draft.values[f.name]?.trim())) return 'Complete all required fields';
  }
  return null;
}
/** Omitting connection preserves the saved secret. Never send an empty or half-blank replacement. */
export function buildCredentialPatch({ draft, providers }: { draft: CredentialDraft; providers: readonly CredentialProvider[] }, _optional = {}): CredentialPatch {
  const provider = providers.find(p => p.kind === draft.kind && p.id === draft.providerId);
  const token = draft.token.trim();
  const connection = token ? draft.kind === 'custom'
    ? { token, ...(draft.username.trim() ? { username: draft.username.trim() } : {}) }
    : { providerId: draft.providerId, [provider?.tokenField ?? 'token']: token, ...Object.fromEntries((provider?.fields ?? []).filter(f => f.name !== provider?.tokenField && draft.values[f.name]?.trim()).map(f => [f.name, draft.values[f.name]!.trim()])) } : undefined;
  return { label: draft.label.trim(), ...(connection ? { connection } : {}), ...(draft.kind === 'custom' ? { category: draft.category, baseUrl: draft.baseUrl.trim(), additionalHosts: draft.additionalHosts.split(/[\n,]/).map(s => s.trim()).filter(Boolean), username: draft.username.trim() || null } : {}) };
}
export function isRootKeyLocked({ status }: { status: RootKeyStatus | null }, _optional = {}) { return status?.state === 'missing-with-data' || status?.state === 'mismatch'; }
