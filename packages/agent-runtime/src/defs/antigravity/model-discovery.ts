import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { json } from '../../model-discovery-config-types.js';

export const antigravityModelConfig: ModelConfigAdapter = {
  files: ({ user }) => [json({ path: user('.gemini/antigravity-cli/settings.json') })],
};
