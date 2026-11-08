import type { PluginCredentialCard, PluginCredentialField } from "@jini-ai/core/contracts/credentials";


/** Composition-supplied loader; absent when no plugin catalog can declare cards here. */
export type LoadPluginCredentialCards = (workspaceId: string) => Promise<readonly PluginCredentialCard[]>;
/** Host-owned exception identity and public-field policy are preserved through these ports. */
export interface PluginCredentialCardPorts {
  readonly cardErrors: { validation(message: string, field?: string): Error };
  readonly assertFreeField: (required: { value: string; field: string }) => void;
}
/** @agent-note Supply the same validation error constructor and field policy used by the host's credential store. */
export function createPluginCredentialCardOperations({ cardErrors, assertFreeField }: PluginCredentialCardPorts, _optional: Record<string, never> = {}) {

/** Extract API inputs from the human card. Fixed destinations cannot be changed by form params.
 * Required public fields and dynamic HTTPS origins are checked before sealing. @complexity O(f).
 */
function readPluginCredentialValues({ card, values }: { card: PluginCredentialCard; values: Readonly<Record<string, unknown>> }, _options = {}): {
  label: string; category: string; baseUrl: string; username?: string | undefined; token: string; additionalHosts?: readonly string[];
} {
  const publicValues = Object.fromEntries((card.fields ?? []).map(field => [field.name, readPublicField({ field, values })]));
  const baseUrl = card.baseUrl || publicValues.baseUrl || '';
  if (!card.baseUrl) assertHttpsInput({ value: baseUrl });
  return { label: card.label, category: card.category, baseUrl, username: publicValues.username,
    token: typeof values.token === 'string' ? values.token : '',
    ...(card.additionalHosts === undefined ? {} : { additionalHosts: card.additionalHosts }) };
}

/** Public fields share the existing credential-free-value invariant with other credential forms. */
function readPublicField({ field, values }: { field: PluginCredentialField; values: Readonly<Record<string, unknown>> }, _options = {}): string | undefined {
  const value = values[field.name];
  if (field.required && (typeof value !== 'string' || !value.trim())) throw cardErrors.validation(`${field.name} is required`);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw cardErrors.validation(`${field.name} must be text`);
  assertFreeField({ value, field: field.name });
  return value;
}

/** The API store permits HTTP for legacy rows; plugin-declared dynamic origins require HTTPS. */
function assertHttpsInput({ value }: { value: string }, _options = {}): void {
  let url: URL;
  try { url = new URL(value); } catch { throw cardErrors.validation('Server URL must use HTTPS'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw cardErrors.validation('Server URL must use HTTPS without credentials');
}


return { readPluginCredentialValues, findPluginCredentialCard, loadPluginCredentialCardsSafely };
}

/** Resolve copy only for the matching domain and provider, never a similarly named card. */
export async function findPluginCredentialCard({ loadCards, workspaceId, saveKind, target }: {
  loadCards?: LoadPluginCredentialCards | undefined; workspaceId: string; saveKind: PluginCredentialCard['saveKind']; target: string;
}, _options = {}): Promise<PluginCredentialCard | undefined> {
  return (await loadPluginCredentialCardsSafely({ loadCards, workspaceId })).find(card => cardMatches({ card, saveKind, target }));
}

/** A missing saveKind keeps the original API-card contract (credential-cards.ts isApiCard). */
function cardMatches({ card, saveKind, target }: { card: PluginCredentialCard; saveKind: PluginCredentialCard['saveKind']; target: string }, _options = {}): boolean {
  if (saveKind === "api") return (card.saveKind ?? "api") === "api" && card.label === target;
  return card.saveKind === saveKind && (card.saveTarget ?? card.providerId) === target;
}

/** Optional display data cannot prevent a domain's authorized credential operation. O(cards).
 * Failures report a fixed warning, without reflecting filesystem paths or credential metadata.
 */
export async function loadPluginCredentialCardsSafely({ loadCards, workspaceId }: { loadCards?: LoadPluginCredentialCards | undefined; workspaceId: string }, options: { warn?: (message: string) => void } = {}): Promise<readonly PluginCredentialCard[]> {
  try { return await loadCards?.(workspaceId) ?? []; }
  catch { (options.warn ?? console.warn)("[plugin-credential-cards] Optional card lookup failed; using the default credential form."); return []; }
}
