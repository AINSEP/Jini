import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import { json } from '../../model-discovery-config-types.js';
import { MODEL_NAME_PATH } from '../../model-discovery-config-types.js';

export const qoderModelConfig: ModelConfigAdapter = {
  files: ({ env, user, local }) => [json(join(env.QODER_CONFIG_DIR || user('.qoder'), 'settings.json'), MODEL_NAME_PATH), json(local('.qoder/settings.json'), MODEL_NAME_PATH), json(local('.qoder/settings.local.json'), MODEL_NAME_PATH)],
};
