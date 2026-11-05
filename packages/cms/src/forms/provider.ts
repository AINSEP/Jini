/** Collection plans concern browser collection only; delivery and imported history keep their owners. */
import { createProviderRegistry, type ProviderRegistry } from '@jini-ai/core';

export interface FormProviderSelection { readonly id: string; readonly config: Readonly<Record<string, string>>; }
export interface FormCollectionCapabilities {
  readonly answers: string;
  readonly validation: string;
  readonly spamProtection: string;
}
export type FormCollectionPlan =
  | { readonly kind: 'post'; readonly action: string; readonly external: boolean; readonly capabilities: FormCollectionCapabilities }
  | { readonly kind: 'embed'; readonly url: string; readonly title: string; readonly capabilities: FormCollectionCapabilities }
  | { readonly kind: 'unavailable'; readonly code: 'provider_unavailable' | 'invalid_configuration'; readonly message: string };
export interface FormCollectionProvider {
  plan(required: { readonly slug: string; readonly config: Readonly<Record<string, string>> }, optional?: Record<string, never>): FormCollectionPlan;
}
export type FormCollectionRegistry = ProviderRegistry<FormCollectionProvider>;
export const FORM_COLLECTION_CONTRACT = 'form_collection';

/** Each host owns an independent registry. Plugin failures become refusals, never boot refusals.
 * @complexity O(1) time/space; lookups do no I/O. */
export function createFormCollectionRegistry(_required: Record<string, never>, _optional: Record<string, never> = {}): FormCollectionRegistry {
  return createProviderRegistry<FormCollectionProvider>({ contract: FORM_COLLECTION_CONTRACT }, {
    defaultProviderId: 'builtin',
    validate: ({ provider }) => provider && typeof provider.plan === 'function' ? undefined : 'missing collection plan',
    seed: [{ id: 'builtin', label: 'Built-in', provider: { plan: ({ slug }) => ({
      kind: 'post', action: `/forms/${encodeURIComponent(slug)}/submit`, external: false,
      capabilities: { answers: 'Answers are stored on this site.', validation: 'This site validates the declared form fields.', spamProtection: 'Hidden-field, timing, duplicate and rate-limit protection apply on the live server.' },
    }) } }],
  });
}

/** Resolve the selected provider without falling back and silently changing where answers go.
 * @complexity O(1), plus the provider's bounded pure configuration validation; no I/O. */
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
 * @complexity O(c) bounded configuration bytes, no I/O. */
export function validateFormProviderSelection({ selection }: { selection: FormProviderSelection }, _optional: Record<string, never> = {}): void {
  if (!selection || !/^[a-z][a-z0-9_]{0,63}$/.test(selection.id) || !selection.config || Array.isArray(selection.config) || typeof selection.config !== 'object') throw new Error('Form provider must have an id and public configuration object.');
  if (JSON.stringify(selection).length > 2048) throw new Error('Form provider configuration must not exceed 2 KiB.');
  for (const [key, value] of Object.entries(selection.config)) {
    if (typeof value !== 'string' || /secret|token|password|api.?key/i.test(key)) throw new Error('Form provider configuration contains a secret or a non-text value. Store only public form configuration.');
  }
}
