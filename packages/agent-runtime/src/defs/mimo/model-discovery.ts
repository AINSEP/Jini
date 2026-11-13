import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import { json } from '../../model-discovery-config-types.js';

export const mimoModelConfig: ModelConfigAdapter = {
  files: ({ configHome, local }) => [json(join(configHome, 'mimocode/mimocode.json')), json(local('.mimocode/mimocode.jsonc'))],
  inlineConfigEnv: 'MIMOCODE_CONFIG_CONTENT',
};
