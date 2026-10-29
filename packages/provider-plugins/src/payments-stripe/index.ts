/** Setup registers the commerce adapter; the host owns selection and activation. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { createStripePaymentProvider } from './provider.js';

/**
 * Builds a stateless resource. Payments select ONE provider per account; never fan out.
 * Credentials are explicit per-call context, never read from environment or retained by the factory.
 * @param _required Host initialization input; credentials are resolved separately for each site/mode.
 * @returns A commerce port and no-op disposer; allocates no connections and throws no errors.
 * @complexity O(1) time and space; no I/O.
 */
export function createStripeProvider(_required: Readonly<Record<string, unknown>>, _optional: Readonly<Record<string, unknown>> = {}) {
  return { port: createStripePaymentProvider({}), dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => {} };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'payments', id: 'stripe', contractVersion: 1, factory: createStripeProvider });
    },
  },
};
