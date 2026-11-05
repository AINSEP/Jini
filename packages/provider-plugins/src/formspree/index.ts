import type { PluginSdk } from '@jini-ai/plugins/host';
import { createFormspreeProvider } from './provider.js';
/** Trusted host setup only registers a pure native-POST plan; installation sends no answers. */
export default { definition: { setup(sdk: PluginSdk): void {
  sdk.providers.register({ contract: 'form_collection', id: 'formspree', contractVersion: 1,
    factory(_required, _optional = {}) { return { port: createFormspreeProvider({}), dispose() {} }; },
  });
} } };
