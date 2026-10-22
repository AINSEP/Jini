import { freezeCommentsDefinition, type CommentsProviderDefinition } from './definitions.js';
import type { CommentsProviderAdapter, CommentsSelectionStorePort } from './ports.js';

export interface CommentsProviderBinding {
  definition: CommentsProviderDefinition;
  /** Resolves only this site's adapter; undefined explicitly means not ready. No executable metadata loading. */
  resolve(required: { siteId: string }, optional?: Record<string, never>): Promise<CommentsProviderAdapter | undefined>;
}
export interface CommentsProviderRegistry {
  register(required: CommentsProviderBinding, optional?: Record<string, never>): void;
  get(required: { providerId: string }, optional?: Record<string, never>): CommentsProviderDefinition | undefined;
  has(required: { providerId: string }, optional?: Record<string, never>): boolean;
  list(required: Record<string, never>, optional?: Record<string, never>): readonly CommentsProviderDefinition[];
  resolve(required: { siteId: string; providerId: string }, optional?: Record<string, never>): Promise<CommentsProviderAdapter | undefined>;
  active(required: { siteId: string }, optional?: Record<string, never>): Promise<{ providerId: string | null; revision: number; adapter: CommentsProviderAdapter | undefined }>;
  select(required: { siteId: string; providerId: string | null; expectedRevision: number; actorPrincipalId: string }, optional?: Record<string, never>): Promise<void>;
}
/** Definition registry plus site-scoped executable resolution; core bindings still own DI.
 * Selection commits only after readiness, with storage CAS refusing stale confirmations.
 * @complexity O(1) lookups; list is O(p) for p registered providers. */
export function createCommentsProviderRegistry({ selections }: { selections: CommentsSelectionStorePort }, _options = {}): CommentsProviderRegistry {
  const providers = new Map<string, CommentsProviderBinding>();
  const registry: CommentsProviderRegistry = {
    register({ definition, resolve }, _optional = {}) {
      const copy = freezeCommentsDefinition({ definition });
      if (providers.has(copy.id)) throw new Error('Duplicate comments provider');
      providers.set(copy.id, { definition: copy, resolve });
    },
    get: ({ providerId }, _optional = {}) => providers.get(providerId)?.definition,
    has: ({ providerId }, _optional = {}) => providers.has(providerId),
    list: (_required, _optional = {}) => Object.freeze([...providers.values()].map(binding => binding.definition)),
    async resolve({ siteId, providerId }, _optional = {}) {
      const binding = providers.get(providerId);
      if (!binding || binding.definition.implementation !== 'adapter') return undefined;
      const adapter = await binding.resolve({ siteId });
      if (adapter && adapter.kind !== binding.definition.kind) throw new Error('Comments adapter kind mismatch');
      return adapter;
    },
    async active({ siteId }, _optional = {}) {
      const selection = await selections.read({ siteId });
      const adapter = selection.providerId === null ? undefined : await registry.resolve({ siteId, providerId: selection.providerId });
      return { ...selection, adapter };
    },
    async select(input, _optional = {}) {
      if (input.providerId !== null && !await registry.resolve({ siteId: input.siteId, providerId: input.providerId })) throw new Error('Comments provider is not ready');
      if (!await selections.compareAndSet(input)) throw new Error('Comments selection changed; read the provider again');
    },
  };
  return registry;
}
