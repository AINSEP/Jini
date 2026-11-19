import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { json } from '../../model-discovery-config-types.js';
import { MODEL_NAME_PATH } from '../../model-discovery-config-types.js';

export const qwenModelConfig: ModelConfigAdapter = {
  files: ({ user, local }) => [json({ path: user('.qwen/settings.json') }, { key: MODEL_NAME_PATH }), json({ path: local('.qwen/settings.json') }, { key: MODEL_NAME_PATH })],
  modelEnv: ['QWEN_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'GEMINI_MODEL'],
};
