/** Setup registers the commerce adapter; the host owns selection and activation. */
import type { PluginSdk } from '@jini-ai/core/contracts/plugin-sdk';
import { readStripeContext } from './configuration.js';
import { createStripePaymentProvider } from './provider.js';

/**
 * Builds a stateless resource. Payments select ONE provider per account; never fan out.
 * Credentials are explicit per-call context, never read from environment or retained by the factory.
 * The payment helpers (`paymentError`, `moneyProblem`) arrive as `optional.context`, put there by commerce's provider contract
 * through the host's `initialize` call; a plugin cannot import them.
 * @param _required Host initialization input; credentials are resolved separately for each site/mode.
 * @param optional `context`: the helpers the domain registered for every payment provider.
 * @returns A commerce port and no-op disposer; allocates no connections and opens none.
 * @throws StripeProviderConfigError at initialize when a helper is absent, never at the first payment.
 * @complexity O(1) time and space; no I/O.
 */
export function createStripeProvider(_required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  return { port: createStripePaymentProvider({ errors: readStripeContext({ context: optional.context }) }), dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => {} };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'payments', id: 'stripe', contractVersion: 1, factory: createStripeProvider });
    },
  },
};
