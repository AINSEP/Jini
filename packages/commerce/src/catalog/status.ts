import type {
  CommercePaymentProvider,
  CommercePaymentRuntimePort,
  CommerceStatus,
} from "./contracts.js";

const CONFIGURATION_UNAVAILABLE = {
  status: "unavailable",
  schema: null,
  reason: "The payment runtime does not expose a provider configuration contract.",
} as const;

/** Copy adapter-owned arrays so callers cannot mutate provider registry state through the read model. */
function copyProvider(provider: CommercePaymentProvider): CommercePaymentProvider {
  return {
    id: provider.id,
    displayName: provider.displayName,
    capabilities: {
      refunds: provider.capabilities.refunds,
      tokenization: provider.capabilities.tokenization,
      recurring: provider.capabilities.recurring,
      confirmation: [...provider.capabilities.confirmation],
      currencies:
        provider.capabilities.currencies === "any"
          ? "any"
          : [...provider.capabilities.currencies],
      webhooks: provider.capabilities.webhooks,
    },
  };
}

/**
 * Builds the provider-neutral Commerce operational status for one workspace.
 *
 * @param input - Workspace scope and an injected resolver for the optional payment runtime.
 * @returns A truthful read model. Provider registration enables discovery only; every unsupported
 * Commerce capability remains explicitly unavailable.
 * @throws Propagates an unexpected adapter programming failure from `listProviders`; expected
 * absence is represented by the null runtime and never throws.
 *
 * @complexity Time: O(p + c), where p is registered providers and c is their declared capability
 * array entries. Space: O(p + c) for the detached response snapshot.
 */
export function readCommerceStatus(input: {
  readonly workspaceId: string;
  readonly resolvePaymentRuntime: () => CommercePaymentRuntimePort | null;
}, _optional: Record<string, never> = {}): CommerceStatus {
  const paymentRuntime = input.resolvePaymentRuntime();
  const available = paymentRuntime !== null;

  return {
    contractVersion: 1,
    workspaceId: input.workspaceId,
    paymentRuntime: {
      status: available ? "available" : "unavailable",
      reason: available ? null : "No payment runtime is composed for this workspace.",
    },
    providers: paymentRuntime?.listProviders().map(copyProvider) ?? [],
    configuration: { ...CONFIGURATION_UNAVAILABLE },
    capabilities: {
      providerDiscovery: available ? "available" : "unavailable",
      checkout: "unavailable",
      subscriptions: "unavailable",
      webhookReconciliation: "unavailable",
      revenue: "unavailable",
    },
  };
}
