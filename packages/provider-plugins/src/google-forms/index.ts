import type { PluginSdk } from '@jini-ai/plugins/host';
import { createGoogleFormsProvider } from './provider.js';
/** Trusted setup registers a pure embed plan; installation performs no vendor requests. */
export default { definition: { setup(sdk: PluginSdk): void {
  sdk.providers.register({ contract: 'form_collection', id: 'google_forms', contractVersion: 1,
    factory(_required, _optional = {}) { return { port: createGoogleFormsProvider({}), dispose() {} }; },
  });
} } };
