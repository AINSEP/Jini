/**
 * @file The kernel's provider registry (lot L4) and the seam that turns a scope into a
 * `ProviderContext`. Shared by the operations (L4), the ingest worker (L5) and the agent tools (L7).
 *
 * Built from the contribution loader's items (`{ pluginId, module }`). The loader validates a
 * module's shape but does not bind the provider's `id` to the plugin that contributed it, so two
 * plugins could both claim `stripe` and the last one loaded would receive Stripe's webhooks and
 * credentials (L0 known limit). This registry refuses a duplicate id outright and records which
 * plugin owns each id; a host may also pin ids to plugins with `bindings`.
 *
 * Registration failures THROW: a bad registration is a composition-root error found at boot.
 */
import type { PaymentError, PaymentProvider, ProviderContext } from "./contract/provider.js";
import type { PaymentScope } from "./contract/scope.js";

/** One loaded provider and the plugin that contributed it. */
export interface RegisteredProvider {
  readonly provider: PaymentProvider;
  readonly pluginId: string;
}

/** The loader item shape (`PluginContributionItem<PaymentProviderDescriptor, PaymentProvider>`), structurally. */
export interface LoadedProviderItem {
  readonly pluginId: string;
  readonly module: PaymentProvider;
}

export interface KernelProviderRegistry {
  get(required: { id: string }, optional?: Record<string, never>): RegisteredProvider | null;
  list(required?: Record<string, never>, optional?: Record<string, never>): readonly RegisteredProvider[];
}

/** ADR-026 identifier grammar: the id is a URL path segment of the webhook route. */
const PROVIDER_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function registrationProblem(
  { item, seen, bindings }: { item: LoadedProviderItem; seen: ReadonlyMap<string, RegisteredProvider>; bindings: Readonly<Record<string, string>> }
): string | null {
  const { id } = item.module;
  if (!PROVIDER_ID.test(id)) return `invalid payment provider id '${id}' — must match ${PROVIDER_ID.source}`;
  const existing = seen.get(id);
  if (existing) return `payment provider '${id}' from '${item.pluginId}' is already registered by '${existing.pluginId}'`;
  const bound = Object.hasOwn(bindings, id) ? bindings[id] : undefined;
  if (bound !== undefined && bound !== item.pluginId) return `payment provider '${id}' is bound to plugin '${bound}', not '${item.pluginId}'`;
  return null;
}

/**
 * Build the registry from loaded items.
 * @param required.items - The loader's items, in load order.
 * @param optional.bindings - Host pins `{ providerId: pluginId }`; a provider id claimed by another plugin is refused.
 * @throws On an invalid id, a duplicate id (from any plugin) or a binding mismatch.
 * @complexity O(n) build, O(1) lookup.
 */
export function createKernelProviderRegistry(
  { items }: { items: readonly LoadedProviderItem[] },
  optional: { bindings?: Readonly<Record<string, string>> } = {}
): KernelProviderRegistry {
  const bindings = optional.bindings ?? {};
  const byId = new Map<string, RegisteredProvider>();
  for (const item of items) {
    const problem = registrationProblem({ item, seen: byId, bindings });
    if (problem) throw new Error(`commerce: ${problem}`);
    byId.set(item.module.id, { provider: item.module, pluginId: item.pluginId });
  }
  return {
    get: ({ id }) => byId.get(id) ?? null,
    list: () => [...byId.values()],
  };
}

export type ProviderContextResult =
  | { readonly ok: true; readonly ctx: ProviderContext }
  | { readonly ok: false; readonly error: PaymentError };

/**
 * Host-owned: resolves credentials (only `provider.credentialKeys`, only for this provider account
 * + mode), the http client and the site's webhook/return URLs. `NO_CREDENTIALS_CONFIGURED` when a
 * slot is empty. The kernel never reads credentials itself.
 */
export interface ProviderContextPort {
  resolve(
    required: { scope: PaymentScope; provider: PaymentProvider },
    optional?: { signal?: AbortSignal }
  ): Promise<ProviderContextResult>;
}
