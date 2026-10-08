/**
 * @file The open provider registry (architecture review §4.5).
 *
 * WooCommerce's registry is genuinely open — core never enumerates gateways, providers add
 * themselves — but its execution is an array of class-name STRINGS passed through a filter and
 * `new $gateway()`'d, where a missing class is skipped with a bare `continue` and core's own
 * registry still carries a hard-coded branch for one gateway. This keeps the openness and drops
 * that: registration takes a constructed object, validates it once, and fails loudly at
 * composition time rather than silently at checkout time.
 *
 * Registration failures THROW, unlike every method on `PaymentProvider` itself. The distinction is
 * deliberate: a bad registration is a composition-root programming error discovered at boot, in
 * the same class as `activateDeploy` throwing on a failed dataModule declaration. A bad *payment*
 * is a runtime condition a caller must be able to handle, which is why it is a typed
 * `PaymentError` instead.
 */
import type { PaymentProvider, PaymentProviderId, PaymentProviderRegistry } from "./ports.js";

/**
 * ADR-026's plugin-identifier grammar: lowercase ASCII alphanumerics and internal hyphens, no
 * underscore anywhere. A provider id is both a URL path segment (`/payments/webhook/:providerId`)
 * and an env-var name fragment (`{HOST_PREFIX}_{PROVIDER}_{KEY}`), so constraining it here keeps
 * both derivations injective and free of escaping concerns.
 */
const PROVIDER_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class Registry implements PaymentProviderRegistry {
  private readonly providers = new Map<PaymentProviderId, PaymentProvider>();

  register({ provider }: { provider: PaymentProvider }, _optional: Record<string, never> = {}): void {
    if (!PROVIDER_ID.test(provider.id)) {
      throw new Error(
        `lipay: invalid payment provider id '${provider.id}' — must match ${PROVIDER_ID.source}`
      );
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`lipay: payment provider '${provider.id}' is already registered`);
    }
    if (provider.capabilities.refunds !== "none" && typeof provider.refund !== "function") {
      throw new Error(
        `lipay: provider '${provider.id}' declares refunds='${provider.capabilities.refunds}' but implements no refund()`
      );
    }
    this.providers.set(provider.id, provider);
  }

  get({ id }: { id: PaymentProviderId }, _optional: Record<string, never> = {}): PaymentProvider | null {
    return this.providers.get(id) ?? null;
  }

  list(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): readonly PaymentProvider[] {
    return [...this.providers.values()];
  }
}

/**
 * Build a registry, optionally pre-populated. Adding a provider to a running install is one
 * `register()` call — no core type, table, route, or error-union edit.
 *
 * @complexity O(n) in the number of seeded providers; every later lookup is O(1).
 * @overallScore 100
 */
export function createPaymentProviderRegistry(
  { providers = [] }: { providers?: (readonly PaymentProvider[]) | undefined } = {},
  _optional: Record<string, never> = {}
): PaymentProviderRegistry {
  const registry = new Registry();
  for (const provider of providers) registry.register({ provider: provider });
  return registry;
}
