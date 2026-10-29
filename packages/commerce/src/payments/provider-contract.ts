/** Commerce's structural adapter for host provider artifacts; trust and retirement stay host-owned. */
import { paymentError, type PaymentProvider } from "./contract/provider.js";
import { OPTIONAL_PROVIDER_METHODS, paymentProviderModuleProblem } from "./provider-module-guard.js";
import type { LoadedProviderItem } from "./provider-registry.js";

export const paymentsProviderContract: {
  readonly contract: "payments";
  readonly validate: (required: { provider: unknown }, optional?: Record<string, never>) => string | undefined;
} = {
  contract: "payments",
  validate: ({ provider }, _optional = {}) => paymentProviderModuleProblem(provider),
};

/** Structural mirror of the host lease; commerce never imports its host. */
export interface PaymentProviderLease {
  readonly port: unknown;
  isCurrent(required: Record<string, never>, optional?: Record<string, never>): boolean;
}
type ProviderMethod = "createIntent" | "verifyWebhook" | (typeof OPTIONAL_PROVIDER_METHODS)[number];

/** Capture the validated method once; retired reads stay unknown so evidence can be retried. */
function guardedMethod<K extends ProviderMethod>(
  { provider, method, lease }: { provider: PaymentProvider; method: K; lease: PaymentProviderLease }, _optional = {}
): NonNullable<PaymentProvider[K]> {
  const inner = provider[method]!;
  return (async (required: unknown, optional: unknown = {}) => {
    if (!lease.isCurrent({})) {
      const read = method === "retrieve" || method === "verifyWebhook";
      return { kind: read ? "unknown" : "rejected", error: paymentError(
        { code: "PROVIDER_NOT_REGISTERED", message: "payment provider lease is retired" }, { retryable: read }
      ) };
    }
    // Preserve the plugin receiver and argument objects for every heterogeneous provider method.
    return Reflect.apply(inner, provider, [required, optional]);
  }) as NonNullable<PaymentProvider[K]>;
}

/**
 * Validate once and snapshot metadata; every operation checks the lease before dispatch.
 * @param required - Owning plugin and host lease.
 * @returns A guarded registry item, or the domain validator's problem.
 * @example leasedProviderItem({ pluginId: "payments-example", lease });
 */
export function leasedProviderItem(
  { pluginId, lease }: { pluginId: string; lease: PaymentProviderLease }, _optional: Record<string, never> = {}
): LoadedProviderItem | { readonly problem: string } {
  const problem = paymentsProviderContract.validate({ provider: lease.port });
  if (problem !== undefined) return { problem };
  const provider = lease.port as PaymentProvider;
  const module: PaymentProvider = {
    id: provider.id, displayName: provider.displayName, credentialKeys: Object.freeze([...provider.credentialKeys]),
    capabilities: Object.freeze({ ...provider.capabilities, confirmation: Object.freeze([...provider.capabilities.confirmation]),
      currencies: provider.capabilities.currencies === "any" ? "any" : Object.freeze([...provider.capabilities.currencies]) }),
    createIntent: guardedMethod({ provider, method: "createIntent", lease }),
    verifyWebhook: guardedMethod({ provider, method: "verifyWebhook", lease }),
  };
  for (const method of OPTIONAL_PROVIDER_METHODS) {
    if (provider[method]) Object.assign(module, { [method]: guardedMethod({ provider, method, lease }) });
  }
  return { pluginId, module: Object.freeze(module) };
}
