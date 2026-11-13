import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';

export const grokBuildModelConfig: ModelConfigAdapter = {
  // UNVERIFIED locally: the survey documents these settings, not installed schema behavior.
  files: ({ user }) => [{ path: user('.grok/config.toml'), format: 'toml', key: 'models.model' }],
};
