import type { CredentialDraft, CredentialField, CredentialPatch, CredentialProvider, CredentialSummary } from './models.js';
/** The saved facts an edit is compared against, so only what changed is sent (W3, W8). `label` is the
 * display name the edit draft started from (a legacy sentinel row starts from its numbered label). */
export type SavedCredentialFacts = Partial<Pick<CredentialSummary, 'username' | 'worksFor' | 'category' | 'baseUrl' | 'additionalHosts'>> & { readonly label: string };
/** Whether `value` parses as an absolute `http`/`https` URL. Checked explicitly rather than trusting
 * "`new URL()` did not throw": that constructor accepts far more schemes than this field should
 * (`javascript:`, `mailto:`, a bare `file:`). */
export function isValidHttpUrl({ value }: { value: string }, _optional = {}): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
/** One host per line or comma-separated (operator's choice, so pasting a provider's own docs either
 * way just works), trimmed, with blank entries dropped. Does not validate. */
export function parseAdditionalHosts({ raw }: { raw: string }, _optional = {}): string[] {
  return raw.split(/[\n,]/).map(entry => entry.trim()).filter(entry => entry !== '');
}
/** The parsed entries that are not their own http(s) origin. An empty field is never invalid; a
 * half-typed host list must not silently save with the bad entry dropped. */
export function invalidAdditionalHosts({ raw }: { raw: string }, _optional = {}): string[] {
  return parseAdditionalHosts({ raw }).filter(entry => !isValidHttpUrl({ value: entry }));
}
/** Whether a draft changes compatibility membership. Omission preserves it; an explicit `[]` clears it. */
export function worksForChanged({ draft, saved = [] }: { draft?: readonly string[] | undefined; saved?: readonly string[] | undefined }, _optional = {}): boolean {
  if (draft === undefined) return false;
  const savedIds = new Set(saved);
  return draft.length !== saved.length || draft.some(id => !savedIds.has(id));
}
/** A provider's extra fields split around the secret input, keeping the declared order: fields
 * declared before the token field (an access key ID before its secret key) render above it, the
 * rest below. A provider that does not declare its token field puts every extra field below. */
export function fieldsAroundToken({ provider }: { provider: Pick<CredentialProvider, 'fields' | 'tokenField'> }, _optional = {}): { before: CredentialField[]; after: CredentialField[] } {
  const tokenIndex = provider.fields.findIndex(field => field.name === provider.tokenField);
  const beforeNames = new Set(provider.fields.slice(0, Math.max(tokenIndex, 0)).map(field => field.name));
  const extras = provider.fields.filter(field => field.name !== provider.tokenField);
  return { before: extras.filter(field => beforeNames.has(field.name)), after: extras.filter(field => !beforeNames.has(field.name)) };
}
/** The "Works for" choices: the catalogs own ids and labels (no parallel list lives here), and a saved
 * id whose plugin is switched off stays as its own raw chip so it can still be seen and removed. */
export function worksForChoices({ providers, value }: { providers: readonly Pick<CredentialProvider, 'id' | 'label'>[]; value: readonly string[] }, _optional = {}): { value: string; label: string }[] {
  const choices = new Map(providers.map(provider => [provider.id, { value: provider.id, label: provider.label }] as const));
  for (const id of value) if (!choices.has(id)) choices.set(id, { value: id, label: id });
  return [...choices.values()];
}
/** Source control has no compatibility list; publish and custom rows send `worksFor` only when it changed. */
export function worksForPart({ draft, saved }: { draft: CredentialDraft; saved?: readonly string[] | undefined }, _optional = {}): Pick<CredentialPatch, 'worksFor'> {
  return draft.kind !== 'source-control' && worksForChanged({ draft: draft.worksFor, saved }) ? { worksFor: [...(draft.worksFor ?? [])] } : {};
}
/** A custom create: no top-level `username` (it travels in `connection`), and `additionalHosts` only when any were typed. */
export function customCreateFields({ draft }: { draft: CredentialDraft }, _optional = {}): CredentialPatch {
  const hosts = parseAdditionalHosts({ raw: draft.additionalHosts });
  return { category: draft.category, baseUrl: draft.baseUrl.trim(), ...(hosts.length > 0 ? { additionalHosts: hosts } : {}) };
}
function sameList({ a, b }: { a: readonly string[]; b: readonly string[] }, _optional = {}) { return a.length === b.length && a.every((entry, i) => entry === b[i]); }
/** A custom edit sends each metadata field only when it changed. A supplied `additionalHosts` replaces
 * the whole list (`[]` clears it); a blank username is sent as the server's `null` clear sentinel,
 * never `""`, and needs no token retype. */
export function customUpdateFields({ draft, saved }: { draft: CredentialDraft; saved: SavedCredentialFacts }, _optional = {}): CredentialPatch {
  const username = draft.username.trim();
  return { ...customLocationChanges({ draft, saved }), ...(username !== (saved.username ?? '').trim() ? { username: username === '' ? null : username } : {}) };
}
function customLocationChanges({ draft, saved }: { draft: CredentialDraft; saved: SavedCredentialFacts }, _optional = {}): CredentialPatch {
  const baseUrl = draft.baseUrl.trim(), hosts = parseAdditionalHosts({ raw: draft.additionalHosts });
  return {
    ...(draft.category !== (saved.category ?? 'general') ? { category: draft.category } : {}),
    ...(baseUrl !== (saved.baseUrl ?? '') ? { baseUrl } : {}),
    ...(!sameList({ a: hosts, b: saved.additionalHosts ?? [] }) ? { additionalHosts: hosts } : {}),
  };
}
