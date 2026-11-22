import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { json } from '../../model-discovery-config-types.js';

export const codebuddyModelConfig: ModelConfigAdapter = {
  files: ({ user, local }) => [json({ path: user('.codebuddy/settings.json') }), json({ path: local('.codebuddy/settings.json') }), json({ path: local('.codebuddy/settings.local.json') })],
};
