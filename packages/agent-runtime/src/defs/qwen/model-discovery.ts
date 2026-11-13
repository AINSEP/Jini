import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { json } from '../../model-discovery-config-types.js';
import { MODEL_NAME_PATH } from '../../model-discovery-config-types.js';

export const qwenModelConfig: ModelConfigAdapter = {
  files: ({ user, local }) => [json(user('.qwen/settings.json'), MODEL_NAME_PATH), json(local('.qwen/settings.json'), MODEL_NAME_PATH)],
  modelEnv: ['QWEN_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'GEMINI_MODEL'],
};
