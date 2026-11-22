import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { json } from '../../model-discovery-config-types.js';

export const cursorAgentModelConfig: ModelConfigAdapter = {
  files: ({ user }) => [json({ path: user('.cursor/cli-config.json') })],
};
