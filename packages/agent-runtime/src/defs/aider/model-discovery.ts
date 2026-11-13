import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';

export const aiderModelConfig: ModelConfigAdapter = {
  files: ({ context, user, root, local }) => context.configPath ? [{ path: context.configPath, format: 'yaml' }] : [{ path: user('.aider.conf.yml'), format: 'yaml' }, { path: root('.aider.conf.yml'), format: 'yaml' }, { path: local('.aider.conf.yml'), format: 'yaml' }],
  modelEnv: ['AIDER_MODEL'],
  projectRoot: true,
};
