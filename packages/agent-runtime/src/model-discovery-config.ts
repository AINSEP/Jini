import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ModelDiscoveryContext, ModelDiscoveryDeps } from './model-discovery-types.js';

type ConfigFile = { path: string; format: 'json' | 'toml' | 'yaml'; key?: string };
const json = (path: string, key = 'model'): ConfigFile => ({ path, format: 'json', key });
/** Config-file resolvers read only settings, never auth-store contents. Precedence is applied
 * from global to workspace/local. Unknown native priorities remain unresolved, not invented. */
export function modelConfigFiles(agentId: string, context: ModelDiscoveryContext): ConfigFile[] {
  const env = context.env;
  const home = env.HOME || homedir();
  const user = (name: string) => join(home, name);
  const local = (name: string) => join(context.cwd, name);
  const root = (name: string) => join(context.projectRoot || context.cwd, name);
  const configHome = env.XDG_CONFIG_HOME || user('.config');
  switch (agentId) {
    case 'codex': {
      const root = env.CODEX_HOME || user('.codex');
      return [{ path: join(root, 'config.toml'), format: 'toml' },
        ...(context.profile ? [{ path: join(root, `${context.profile}.config.toml`), format: 'toml' as const }] : []),
        { path: local('.codex/config.toml'), format: 'toml' }];
    }
    case 'claude': {
      const claudeRoot = env.CLAUDE_CONFIG_DIR || user('.claude');
      const sources = context.settingSources ?? ['user', 'project', 'local'];
      return [...(sources.includes('user') ? [json(join(claudeRoot, 'settings.json'))] : []),
        ...(sources.includes('project') ? [json(root('.claude/settings.json'))] : []),
        ...(sources.includes('local') ? [json(root('.claude/settings.local.json'))] : [])];
    }
    case 'antigravity': return [json(user('.gemini/antigravity-cli/settings.json'))];
    case 'opencode': return [json(join(env.XDG_STATE_HOME || user('.local/state'), 'opencode/model.json'), 'recent'), json(join(configHome, 'opencode/opencode.json')), json(join(configHome, 'opencode/opencode.jsonc')), json(root('opencode.json')), json(root('opencode.jsonc')), json(local('opencode.json')), json(local('opencode.jsonc'))];
    case 'pi': return [json(join(env.PI_CODING_AGENT_DIR || user('.pi/agent'), 'settings.json'), 'defaultModel'), json(local('.pi/settings.json'), 'defaultModel')];
    case 'aider': return context.configPath ? [{ path: context.configPath, format: 'yaml' }] : [{ path: user('.aider.conf.yml'), format: 'yaml' }, { path: root('.aider.conf.yml'), format: 'yaml' }, { path: local('.aider.conf.yml'), format: 'yaml' }];
    // UNVERIFIED locally: the survey documents these settings, not installed schema behavior.
    case 'grok-build': return [{ path: user('.grok/config.toml'), format: 'toml', key: 'models.model' }];
    case 'codebuddy': return [json(user('.codebuddy/settings.json')), json(local('.codebuddy/settings.json')), json(local('.codebuddy/settings.local.json'))];
    case 'copilot': return [json(user('.copilot/config.json'))];
    case 'cursor-agent': return [json(user('.cursor/cli-config.json'))];
    case 'droid': return [json(user('.factory/settings.json'), 'sessionDefaultSettings.model')];
    case 'qoder': return [json(join(env.QODER_CONFIG_DIR || user('.qoder'), 'settings.json'), 'model.name'), json(local('.qoder/settings.json'), 'model.name'), json(local('.qoder/settings.local.json'), 'model.name')];
    case 'qwen': return [json(user('.qwen/settings.json'), 'model.name'), json(local('.qwen/settings.json'), 'model.name')];
    case 'deepseek': return [{ path: user('.deepseek/config.toml'), format: 'toml' }, { path: user('.codewhale/config.toml'), format: 'toml' }];
    case 'mimo': return [json(join(configHome, 'mimocode/mimocode.json')), json(local('.mimocode/mimocode.jsonc'))];
    case 'crush': return [json(join(configHome, 'crush/crush.json'), 'models.large.model'), json(local('crush.json'), 'models.large.model')];
    default: return [];
  }
}
export function parseSettingsJson(raw: string): Record<string, unknown> | null {
  try {
    // Preserve quoted strings (including URLs) while removing JSONC comments.
    const stripped = raw.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (token) => token.startsWith('"') ? token : '').replace(/,\s*([}\]])/g, '$1');
    const value: unknown = JSON.parse(stripped);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function scalar(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function dotted(value: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((item, part) => item && typeof item === 'object' ? (item as Record<string, unknown>)[part] : undefined, value);
}
export function parseConfiguredModel(file: ConfigFile, raw: string, profile?: string): string | undefined {
  if (file.format === 'json') {
    const settings = parseSettingsJson(raw);
    const model = dotted(settings, file.key || 'model');
    if (file.key === 'recent' && Array.isArray(model)) {
      const first = model[0] as { providerID?: unknown; modelID?: unknown } | undefined;
      const provider = scalar(first?.providerID); const id = scalar(first?.modelID);
      return provider && id ? `${provider}/${id}` : undefined;
    }
    // Cursor's model object subkeys are undocumented: never guess which one is the effective id.
    const id = scalar(model);
    if (file.key === 'defaultModel' && id) {
      const provider = scalar(settings?.defaultProvider);
      return provider ? `${provider}/${id}` : undefined;
    }
    return id;
  }
  if (file.format === 'yaml') return scalar(raw.match(/^model\s*:\s*["']?([^\n"'#]+)["']?\s*(?:#.*)?$/m)?.[1]);
  let section = ''; let chosen: string | undefined; let profileChoice: string | undefined;
  for (const line of raw.split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) { section = header[1]!; continue; }
    const match = line.match(/^\s*model\s*=\s*["']([^"']+)["']/);
    if (!match) continue;
    if (profile && section === `profiles.${profile}`) profileChoice = match[1];
    if (section === (file.key === 'models.model' ? 'models' : '')) chosen = match[1];
  }
  return profileChoice || chosen;
}
const MODEL_ENV: Record<string, readonly string[]> = {
  claude: ['ANTHROPIC_MODEL'], aider: ['AIDER_MODEL'], amr: ['VELA_DEFAULT_MODEL'],
  deepseek: ['CODEWHALE_MODEL', 'DEEPSEEK_MODEL'], qwen: ['QWEN_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'GEMINI_MODEL'],
};
export async function readModelConfiguration(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<{ selection?: string; fingerprintMaterial: string }> {
  if (!context.projectRoot && ['claude', 'aider', 'opencode'].includes(agentId) && deps.fs.projectRoot) {
    const projectRoot = await deps.fs.projectRoot({ cwd: context.cwd, signal });
    if (projectRoot) context = { ...context, projectRoot };
  }
  const files = modelConfigFiles(agentId, context);
  const contents = await Promise.all(files.map(async (file) => ({ file, raw: await deps.fs.read(file.path, { signal }) })));
  let extraMaterial = '';
  let selection: string | undefined;
  for (const { file, raw } of contents) if (raw !== null) selection = parseConfiguredModel(file, raw, context.profile) || selection;
  if (agentId === 'pi') {
    const effective = Object.assign({}, ...contents.map(({ raw }) => raw ? parseSettingsJson(raw) || {} : {})) as Record<string, unknown>;
    const provider = scalar(effective.defaultProvider); const id = scalar(effective.defaultModel);
    selection = provider && id ? `${provider}/${id}` : undefined;
  }
  const inline = agentId === 'opencode' ? context.env.OPENCODE_CONFIG_CONTENT : agentId === 'mimo' ? context.env.MIMOCODE_CONFIG_CONTENT : undefined;
  if (inline) selection = scalar(parseSettingsJson(inline)?.model) || selection;
  for (const key of [...(MODEL_ENV[agentId] || [])].reverse()) selection = scalar(context.env[key]) || selection;
  if (agentId === 'claude' && context.settings) {
    const raw = context.settings.trim().startsWith('{') ? context.settings : await deps.fs.read(context.settings, { signal });
    extraMaterial = raw || '';
    if (raw) selection = scalar(parseSettingsJson(raw)?.model) || selection;
  }
  selection = context.model || selection;
  // Material is hashed by the orchestration layer and is never exposed over HTTP.
  return { ...(selection ? { selection } : {}), fingerprintMaterial: JSON.stringify([contents.map(({ file, raw }) => [file.path, raw]), extraMaterial]) };
}
