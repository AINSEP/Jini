import type { ModelConfigAdapter } from '../../model-discovery-config-types.js';
import { join } from 'node:path';
import type { ConfigPaths, ConfigFile } from '../../model-discovery-config-types.js';
import { json } from '../../model-discovery-config-types.js';

function claudeConfigFiles({ env, context, user, root }: ConfigPaths): ConfigFile[] {
  const claudeRoot = env.CLAUDE_CONFIG_DIR || user('.claude');
  const sources = context.settingSources ?? ['user', 'project', 'local'];
  return [...(sources.includes('user') ? [json({ path: join(claudeRoot, 'settings.json') })] : []),
    ...(sources.includes('project') ? [json({ path: root('.claude/settings.json') })] : []),
    ...(sources.includes('local') ? [json({ path: root('.claude/settings.local.json') })] : [])];
}
export const claudeModelConfig: ModelConfigAdapter = {
  files: claudeConfigFiles,
  modelEnv: ['ANTHROPIC_MODEL'],
  projectRoot: true,
  settingsRaw: async (context, deps, signal) => {
    if (!context.settings) return null;
    return context.settings.trim().startsWith('{') ? context.settings : deps.fs.read(context.settings, { signal });
  },
};
