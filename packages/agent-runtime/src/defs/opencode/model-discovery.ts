import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import { json, qualified, scalar } from '../../model-discovery-config-types.js';

export function parseOpenCodeRecentModel(model: unknown): string | undefined {
  if (!Array.isArray(model)) return scalar(model);
  const first = model[0] as { providerID?: unknown; modelID?: unknown } | undefined;
  return qualified(scalar(first?.providerID), scalar(first?.modelID));
}

export const opencodeModelConfig: ModelConfigAdapter = {
  files: ({ env, user, configHome, root, local }) => [json(join(env.XDG_STATE_HOME || user('.local/state'), 'opencode/model.json'), 'recent'), json(join(configHome, 'opencode/opencode.json')), json(join(configHome, 'opencode/opencode.jsonc')), json(root('opencode.json')), json(root('opencode.jsonc')), json(local('opencode.json')), json(local('opencode.jsonc'))],
  projectRoot: true,
  inlineConfigEnv: 'OPENCODE_CONFIG_CONTENT',
};
