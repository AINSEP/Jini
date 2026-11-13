import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { json } from '../../model-discovery-config-types.js';

export const droidModelConfig: ModelConfigAdapter = {
  files: ({ user }) => [json(user('.factory/settings.json'), 'sessionDefaultSettings.model')],
};
