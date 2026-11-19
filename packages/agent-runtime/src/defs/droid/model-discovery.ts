import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { json } from '../../model-discovery-config-types.js';

export const droidModelConfig: ModelConfigAdapter = {
  files: ({ user }) => [json({ path: user('.factory/settings.json') }, { key: 'sessionDefaultSettings.model' })],
};
