import type { SourceControlProvider, SourceControlCredential, SourceControlDraft, SourceControlProviderInfo, SourceControlConnection } from './models.js';
export function blankSourceControlDraft(_required: Record<string, never>, _optional = {}): SourceControlDraft { return { token: '', values: {}, saving: false, error: null }; }
/** Saved connections remain visible even when their provider plugin is missing or off. */
export function sourceControlProviders({ providers, credentials }: { providers: readonly SourceControlProvider[]; credentials: readonly Pick<SourceControlCredential, 'providerId'>[] }, _optional = {}): readonly SourceControlProviderInfo[] {
  const rows: SourceControlProviderInfo[] = providers.map(p => { const c = p.credential, token = c?.fields.find(f => f.name === c.tokenField); return { id: p.id, label: p.label, listed: true, tokenLabel: token?.label ?? 'Access token', fields: c?.fields.filter(f => f.name !== c.tokenField) ?? [], tokenPageUrl: c?.tokenPageUrl ?? '', help: c?.help ?? '' }; });
  for (const c of credentials) if (!rows.some(r => r.id === c.providerId)) rows.push({ id: c.providerId, label: c.providerId, listed: false, tokenLabel: 'Access token', fields: [], tokenPageUrl: '', help: '' }); return rows;
}
/** DEFAULT first, then a defensive first-row fallback. Never confuse identity with deploy targets. */
export function defaultSourceControlCredential({ credentials, providerId }: { credentials: readonly SourceControlCredential[]; providerId: string }, _optional = {}) { const rows = credentials.filter(r => r.providerId === providerId); return rows.find(r => r.isDefault) ?? rows[0]; }
export function sourceControlReady({ info, draft }: { info: SourceControlProviderInfo; draft: SourceControlDraft }, _optional = {}) { return info.listed && !!draft.token.trim() && info.fields.every(f => !f.required || !!draft.values[f.name]?.trim()); }
/** Only declared nonblank fields go on the wire; token always uses the API's canonical key. */
export function buildSourceControlConnection({ info, draft }: { info: SourceControlProviderInfo; draft: SourceControlDraft }, _optional = {}): SourceControlConnection {
  const fields: Record<string, string> = {}; for (const f of info.fields) { const value = draft.values[f.name]?.trim(); if (value) fields[f.name] = value; }
  return { ...fields, providerId: info.id, token: draft.token.trim() };
}
/** Explicit projection prevents accidental token, ciphertext or username disclosure. */
export function sourceControlSummary({ row }: { row: SourceControlCredential }, _optional = {}): SourceControlCredential { return Object.freeze({ id: row.id, providerId: row.providerId, label: row.label, configured: true, isDefault: row.isDefault, createdAt: row.createdAt, updatedAt: row.updatedAt }); }
export function sourceControlErrorMessage({ error }: { error: unknown }, _optional = {}) { const e = error as { code?: unknown; message?: unknown } | null; const marker = e?.code ?? e?.message; if (marker === 'DUPLICATE_LABEL') return 'This connection was already saved — reload and try again.'; if (marker === 'VALIDATION') return 'Check the required credential fields.'; return 'Unable to save connection'; }
export function safeSourceControlUrl({ url }: { url: string }, _optional = {}) { try { const parsed = new URL(url); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : undefined; } catch { return undefined; } }
