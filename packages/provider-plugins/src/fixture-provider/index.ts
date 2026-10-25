/** Small conformance fixture, not a vendor adapter. Evaluation and setup allocate no resources. */
import type { PluginSdk } from '@jini-ai/plugins/host';

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'fixture', id: 'fixture', contractVersion: 1,
        factory(required, _optional = {}) {
          let closed = false;
          return {
            port: { read: (_required: Record<string, never>, _options: Record<string, never> = {}) => closed ? undefined : required.value },
            dispose(_required, _options = {}) { closed = true; },
          };
        },
      });
    },
  },
};
