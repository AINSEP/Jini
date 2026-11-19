import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import { json, qualified, scalar } from '../../model-discovery-config-types.js';

export function parseOpenCodeRecentModel(model: unknown): string | undefined {
  if (!Array.isArray(model)) return scalar({ value: model });
  const first = model[0] as { providerID?: unknown; modelID?: unknown } | undefined;
  return qualified({ provider: scalar({ value: first?.providerID }), id: scalar({ value: first?.modelID }) });
}

export const opencodeModelConfig: ModelConfigAdapter = {
  files: ({ env, user, configHome, root, local }) => [json({ path: join(env.XDG_STATE_HOME || user('.local/state'), 'opencode/model.json') }, { key: 'recent' }), json({ path: join(configHome, 'opencode/opencode.json') }), json({ path: join(configHome, 'opencode/opencode.jsonc') }), json({ path: root('opencode.json') }), json({ path: root('opencode.jsonc') }), json({ path: local('opencode.json') }), json({ path: local('opencode.jsonc') })],
  projectRoot: true,
  inlineConfigEnv: 'OPENCODE_CONFIG_CONTENT',
};
