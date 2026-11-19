import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import { json } from '../../model-discovery-config-types.js';

export const crushModelConfig: ModelConfigAdapter = {
  files: ({ configHome, local }) => [json({ path: join(configHome, 'crush/crush.json') }, { key: 'models.large.model' }), json({ path: local('crush.json') }, { key: 'models.large.model' })],
};
