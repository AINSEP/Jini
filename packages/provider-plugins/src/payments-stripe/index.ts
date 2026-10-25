/** `payments-stripe`: moved only. Setup registers an inert factory; no host selects or activates it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { StripePaymentsProvider, type StripePaymentsProviderOptionalArgs } from './stripe.js';

/**
 * Builds the legacy-port adapter. Payments select ONE provider per account; never fan out.
 * @param required `{ secretKey }` from the host's secure settings.
 * @param optional `{ now?, fetchFn?, apiBase? }` test seams.
 * @returns `{ port, dispose }`; the adapter holds no resources, so dispose is a no-op.
 * @throws StripePaymentsProviderError (status 401) on a missing or non-string key, via the adapter's own check.
 */
export function createStripeProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const port = new StripePaymentsProvider({ secretKey: typeof required.secretKey === 'string' ? required.secretKey : '' }, optional as StripePaymentsProviderOptionalArgs);
  return { port, dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => {} };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'payments', id: 'stripe', contractVersion: 1, factory: createStripeProvider });
    },
  },
};
