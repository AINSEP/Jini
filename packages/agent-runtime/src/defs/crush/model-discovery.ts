import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import { json } from '../../model-discovery-config-types.js';

export const crushModelConfig: ModelConfigAdapter = {
  files: ({ configHome, local }) => [json(join(configHome, 'crush/crush.json'), 'models.large.model'), json(local('crush.json'), 'models.large.model')],
};
