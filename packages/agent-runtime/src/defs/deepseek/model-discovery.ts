import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';

export const deepseekModelConfig: ModelConfigAdapter = {
  files: ({ user }) => [{ path: user('.deepseek/config.toml'), format: 'toml' }, { path: user('.codewhale/config.toml'), format: 'toml' }],
  modelEnv: ['CODEWHALE_MODEL', 'DEEPSEEK_MODEL'],
};
