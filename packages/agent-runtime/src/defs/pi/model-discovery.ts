import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import { json } from '../../model-discovery-config-types.js';
import { parseSettingsJson, qualified, scalar } from '../../model-discovery-config-types.js';

export function parsePiDefaultModel(model: unknown, settings: Record<string, unknown> | null): string | undefined {
  const id = scalar({ value: model });
  return id ? qualified({ provider: scalar({ value: settings?.defaultProvider }), id }) : id;
}

export const piModelConfig: ModelConfigAdapter = {
  files: ({ env, user, local }) => [json({ path: join(env.PI_CODING_AGENT_DIR || user('.pi/agent'), 'settings.json') }, { key: 'defaultModel' }), json({ path: local('.pi/settings.json') }, { key: 'defaultModel' })],
  // Later files override earlier ones; Pi merges its files so provider and model may be split.
  fileSelection: (contents) => {
    const effective = Object.assign({}, ...contents.map(({ raw }) => raw ? parseSettingsJson({ raw }) || {} : {})) as Record<string, unknown>;
    return qualified({ provider: scalar({ value: effective.defaultProvider }), id: scalar({ value: effective.defaultModel }) });
  },
};
