import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import type { ConfigPaths, ConfigFile } from '../../model-discovery-config-types.js';

function codexConfigFiles({ env, context, user, local }: ConfigPaths): ConfigFile[] {
  const root = env.CODEX_HOME || user('.codex');
  return [{ path: join(root, 'config.toml'), format: 'toml' },
    ...(context.profile ? [{ path: join(root, `${context.profile}.config.toml`), format: 'toml' as const }] : []),
    { path: local('.codex/config.toml'), format: 'toml' }];
}
export const codexModelConfig: ModelConfigAdapter = {
  files: codexConfigFiles,
};
