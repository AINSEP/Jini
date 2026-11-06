/** Collection plans concern browser collection only; delivery and imported history keep their owners. */
import { createProviderRegistry, type ProviderRegistry } from '@jini-ai/core';

export interface FormProviderSelection { readonly id: string; readonly config: Readonly<Record<string, string>>; }
export interface FormCollectionCapabilities {
  readonly answers: string;
  readonly validation: string;
  readonly spamProtection: string;
}
/** Public settings only; secrets and provider credentials never belong in form definitions. */
export interface FormProviderDescription {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly { readonly key: string; readonly label: string; readonly type: 'text' | 'url'; readonly helpText?: string }[];
  readonly helpText?: string;
  readonly answers: string;
  readonly validation: string;
  readonly frameOrigins: readonly string[];
  readonly available: boolean;
  readonly message?: string;
}
export type FormCollectionPlan =
  | { readonly kind: 'post'; readonly action: string; readonly external: boolean; readonly capabilities: FormCollectionCapabilities }
  | { readonly kind: 'embed'; readonly url: string; readonly title: string; readonly capabilities: FormCollectionCapabilities; readonly consent?: readonly ('necessary' | 'functional' | 'analytics' | 'marketing')[]; readonly publicUrl?: string; readonly fallbackMessage?: string }
  | { readonly kind: 'unavailable'; readonly code: 'provider_unavailable' | 'invalid_configuration'; readonly message: string };
export interface FormCollectionProvider {
  describe?(): Omit<FormProviderDescription, 'id' | 'available'>;
  plan(required: { readonly slug: string; readonly config: Readonly<Record<string, string>> }, optional?: Record<string, never>): FormCollectionPlan;
}
export type FormCollectionRegistry = ProviderRegistry<FormCollectionProvider>;
export const FORM_COLLECTION_CONTRACT = 'form_collection';
const BUILTIN_CAPABILITIES: FormCollectionCapabilities = {
  answers: 'Answers are stored in the built-in inbox.',
  validation: 'The built-in receiver validates the declared form fields.',
  spamProtection: 'Hidden-field, timing, duplicate and rate-limit protection apply on the live server.',
};

/** Each host owns an independent registry. Plugin failures become refusals, never boot refusals.
 * @example createFormCollectionRegistry({}).get({ id: 'builtin' });
 * @complexity O(1) time/space; lookups do no I/O.
 * @overallScore 97 — Recommended: provider capability descriptions remain provider-owned prose. */
export function createFormCollectionRegistry(_required: Record<string, never>, _optional: Record<string, never> = {}): FormCollectionRegistry {
  return createProviderRegistry<FormCollectionProvider>({ contract: FORM_COLLECTION_CONTRACT }, {
    defaultProviderId: 'builtin',
    validate: ({ provider }) => provider && typeof provider.plan === 'function' ? undefined : 'missing collection plan',
    seed: [{ id: 'builtin', label: 'Built-in', provider: { describe: () => ({ label: 'Built-in', fields: [], answers: BUILTIN_CAPABILITIES.answers, validation: BUILTIN_CAPABILITIES.validation, frameOrigins: [] }), plan: ({ slug }) => ({
      kind: 'post', action: `/forms/${encodeURIComponent(slug)}/submit`, external: false,
      capabilities: { ...BUILTIN_CAPABILITIES },
    }) } }],
  });
}

/** Project the registry once for every editor and assistant; unavailable settings retain their ID.
 * A description failure affects only that provider's settings, never server startup or stored choices.
 * @complexity O(p × d) time/space for p providers and description bytes; no I/O. */
export function describeFormCollectionProviders({ providers }: { readonly providers: FormCollectionRegistry }, _optional: Record<string, never> = {}): readonly FormProviderDescription[] {
  return providers.list().map(({ id, label, provider }) => {
    const unavailable: FormProviderDescription = { id, label: label ?? id, available: false, fields: [], answers: '', validation: '', frameOrigins: [], message: 'This form provider’s settings are unavailable because its plugin is disabled or unavailable. Enable it in Plugins, or choose another form provider. Your saved selection has been kept.' };
    try {
      const description = provider.describe?.();
      if (!description || !validDescription(description)) return unavailable;
      return { ...description, id, available: true };
    } catch { return unavailable; }
  });
}

/** Trusted plugins can still supply broken metadata; keep malformed settings out of clients. */
function validDescription(description: Omit<FormProviderDescription, 'id' | 'available'>): boolean {
  if (typeof description.label !== 'string' || typeof description.answers !== 'string' || typeof description.validation !== 'string') return false;
  if (!optionalText(description.helpText) || !Array.isArray(description.frameOrigins) || !Array.isArray(description.fields)) return false;
  return description.frameOrigins.every(origin => typeof origin === 'string') && description.fields.every(validDescriptionField);
}
function optionalText(value: unknown): boolean { return value === undefined || typeof value === 'string'; }
function validDescriptionField(field: FormProviderDescription['fields'][number]): boolean {
  if (!field || typeof field.key !== 'string' || typeof field.label !== 'string') return false;
  return (field.type === 'text' || field.type === 'url') && optionalText(field.helpText);
}

/** Resolve the selected provider without falling back and silently changing where answers go.
 * @example resolveFormCollectionPlan({ definition: { slug: 'contact' }, providers });
 * @complexity O(1) space/time, plus the provider's bounded pure configuration validation; no I/O.
 * @overallScore 96 — Recommended: throwing trusted plugins become the same visible unavailable state. */
export function resolveFormCollectionPlan({ definition, providers }: {
  readonly definition: { readonly slug: string; readonly provider?: FormProviderSelection };
  readonly providers: FormCollectionRegistry;
}, _optional: Record<string, never> = {}): FormCollectionPlan {
  const id = definition.provider?.id ?? 'builtin';
  const provider = providers.get({ id });
  const unavailable: FormCollectionPlan = { kind: 'unavailable', code: 'provider_unavailable', message: `This form cannot send answers because its ${id} form provider is unavailable.` };
  if (!provider) return unavailable;
  // A retired plugin lease goes inert; never send to the built-in endpoint in that case.
  try { return provider.provider.plan({ slug: definition.slug, config: definition.provider?.config ?? {} }) ?? unavailable; }
  catch { return unavailable; }
}

/** Stored selection is public, small and string-only; provider-specific checks happen in its plan.
 * @throws Error for malformed, oversized or secret-like configuration.
 * @example validateFormProviderSelection({ selection: { id: 'builtin', config: {} } });
 * @complexity O(c) time/space for configuration bytes, no I/O; accepted storage is capped at 2 KiB.
 * @overallScore 96 — Recommended: public configuration uses string values; richer vendor options need a contract revision. */
export function validateFormProviderSelection({ selection }: { selection: FormProviderSelection }, _optional: Record<string, never> = {}): void {
  if (!selection || typeof selection.id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(selection.id)) throw new Error('Form provider must have a valid provider id.');
  assertPublicConfiguration({ config: selection.config });
  if (JSON.stringify(selection).length > 2048) throw new Error('Form provider configuration must not exceed 2 KiB.');
}

/** Reject secret names and malformed values before public configuration can enter an export.
 * @complexity O(c) time/space for configuration entries; no I/O.
 * @overallScore 96 — Recommended: secret-like key matching is intentionally conservative. */
function assertPublicConfiguration({ config }: { config: unknown }): void {
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Form provider needs a public configuration object.');
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || /secret|token|password|api.?key/i.test(key)) throw new Error('Form provider configuration contains a secret or a non-text value. Store only public form configuration.');
  }
}
