import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import { json } from '../../model-discovery-config-types.js';
import { parseSettingsJson, qualified, scalar } from '../../model-discovery-config-types.js';

export function parsePiDefaultModel(model: unknown, settings: Record<string, unknown> | null): string | undefined {
  const id = scalar(model);
  return id ? qualified(scalar(settings?.defaultProvider), id) : id;
}

export const piModelConfig: ModelConfigAdapter = {
  files: ({ env, user, local }) => [json(join(env.PI_CODING_AGENT_DIR || user('.pi/agent'), 'settings.json'), 'defaultModel'), json(local('.pi/settings.json'), 'defaultModel')],
  // Later files override earlier ones; Pi merges its files so provider and model may be split.
  fileSelection: (contents) => {
    const effective = Object.assign({}, ...contents.map(({ raw }) => raw ? parseSettingsJson(raw) || {} : {})) as Record<string, unknown>;
    return qualified(scalar(effective.defaultProvider), scalar(effective.defaultModel));
  },
};
