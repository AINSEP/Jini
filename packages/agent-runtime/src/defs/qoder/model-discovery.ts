import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import { json } from '../../model-discovery-config-types.js';
import { MODEL_NAME_PATH } from '../../model-discovery-config-types.js';

export const qoderModelConfig: ModelConfigAdapter = {
  files: ({ env, user, local }) => [json({ path: join(env.QODER_CONFIG_DIR || user('.qoder'), 'settings.json') }, { key: MODEL_NAME_PATH }), json({ path: local('.qoder/settings.json') }, { key: MODEL_NAME_PATH }), json({ path: local('.qoder/settings.local.json') }, { key: MODEL_NAME_PATH })],
};
