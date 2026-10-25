import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ModelDiscoveryContext, ModelDiscoveryDeps } from './model-discovery-types.js';

type ConfigFile = { path: string; format: 'json' | 'toml' | 'yaml'; key?: string };
const json = (path: string, key = 'model'): ConfigFile => ({ path, format: 'json', key });
type ConfigPaths = {
  env: ModelDiscoveryContext['env']; context: ModelDiscoveryContext; configHome: string;
  user(name: string): string; local(name: string): string; root(name: string): string;
};
function codexConfigFiles({ env, context, user, local }: ConfigPaths): ConfigFile[] {
  const root = env.CODEX_HOME || user('.codex');
  return [{ path: join(root, 'config.toml'), format: 'toml' },
    ...(context.profile ? [{ path: join(root, `${context.profile}.config.toml`), format: 'toml' as const }] : []),
    { path: local('.codex/config.toml'), format: 'toml' }];
}
function claudeConfigFiles({ env, context, user, root }: ConfigPaths): ConfigFile[] {
  const claudeRoot = env.CLAUDE_CONFIG_DIR || user('.claude');
  const sources = context.settingSources ?? ['user', 'project', 'local'];
  return [...(sources.includes('user') ? [json(join(claudeRoot, 'settings.json'))] : []),
    ...(sources.includes('project') ? [json(root('.claude/settings.json'))] : []),
    ...(sources.includes('local') ? [json(root('.claude/settings.local.json'))] : [])];
}
const CONFIG_FILES: ReadonlyMap<string, (paths: ConfigPaths) => ConfigFile[]> = new Map<string, (paths: ConfigPaths) => ConfigFile[]>([
  ['codex', codexConfigFiles],
  ['claude', claudeConfigFiles],
  ['antigravity', ({ user }) => [json(user('.gemini/antigravity-cli/settings.json'))]],
  ['opencode', ({ env, user, configHome, root, local }) => [json(join(env.XDG_STATE_HOME || user('.local/state'), 'opencode/model.json'), 'recent'), json(join(configHome, 'opencode/opencode.json')), json(join(configHome, 'opencode/opencode.jsonc')), json(root('opencode.json')), json(root('opencode.jsonc')), json(local('opencode.json')), json(local('opencode.jsonc'))]],
  ['pi', ({ env, user, local }) => [json(join(env.PI_CODING_AGENT_DIR || user('.pi/agent'), 'settings.json'), 'defaultModel'), json(local('.pi/settings.json'), 'defaultModel')]],
  ['aider', ({ context, user, root, local }) => context.configPath ? [{ path: context.configPath, format: 'yaml' }] : [{ path: user('.aider.conf.yml'), format: 'yaml' }, { path: root('.aider.conf.yml'), format: 'yaml' }, { path: local('.aider.conf.yml'), format: 'yaml' }]],
  // UNVERIFIED locally: the survey documents these settings, not installed schema behavior.
  ['grok-build', ({ user }) => [{ path: user('.grok/config.toml'), format: 'toml', key: 'models.model' }]],
  ['codebuddy', ({ user, local }) => [json(user('.codebuddy/settings.json')), json(local('.codebuddy/settings.json')), json(local('.codebuddy/settings.local.json'))]],
  ['copilot', ({ user }) => [json(user('.copilot/config.json'))]],
  ['cursor-agent', ({ user }) => [json(user('.cursor/cli-config.json'))]],
  ['droid', ({ user }) => [json(user('.factory/settings.json'), 'sessionDefaultSettings.model')]],
  ['qoder', ({ env, user, local }) => [json(join(env.QODER_CONFIG_DIR || user('.qoder'), 'settings.json'), 'model.name'), json(local('.qoder/settings.json'), 'model.name'), json(local('.qoder/settings.local.json'), 'model.name')]],
  ['qwen', ({ user, local }) => [json(user('.qwen/settings.json'), 'model.name'), json(local('.qwen/settings.json'), 'model.name')]],
  ['deepseek', ({ user }) => [{ path: user('.deepseek/config.toml'), format: 'toml' }, { path: user('.codewhale/config.toml'), format: 'toml' }]],
  ['mimo', ({ configHome, local }) => [json(join(configHome, 'mimocode/mimocode.json')), json(local('.mimocode/mimocode.jsonc'))]],
  ['crush', ({ configHome, local }) => [json(join(configHome, 'crush/crush.json'), 'models.large.model'), json(local('crush.json'), 'models.large.model')]],
]);
/** Config-file resolvers read only settings, never auth-store contents. Precedence is applied
 * from global to workspace/local. Unknown native priorities remain unresolved, not invented. */
export function modelConfigFiles(agentId: string, context: ModelDiscoveryContext): ConfigFile[] {
  const env = context.env;
  const home = env.HOME || homedir();
  const user = (name: string) => join(home, name);
  const local = (name: string) => join(context.cwd, name);
  const root = (name: string) => join(context.projectRoot || context.cwd, name);
  const configHome = env.XDG_CONFIG_HOME || user('.config');
  return CONFIG_FILES.get(agentId)?.({ env, context, configHome, user, local, root }) ?? [];
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
/** "provider/id" when both parts are present; a bare id is never guessed into a provider. */
function qualified(provider: string | undefined, id: string | undefined): string | undefined {
  return provider && id ? `${provider}/${id}` : undefined;
}
function parseJsonModel(file: ConfigFile, raw: string): string | undefined {
  const settings = parseSettingsJson(raw);
  const model = dotted(settings, file.key || 'model');
  if (file.key === 'recent' && Array.isArray(model)) {
    const first = model[0] as { providerID?: unknown; modelID?: unknown } | undefined;
    return qualified(scalar(first?.providerID), scalar(first?.modelID));
  }
  // Cursor's model object subkeys are undocumented: never guess which one is the effective id.
  const id = scalar(model);
  if (file.key === 'defaultModel' && id) return qualified(scalar(settings?.defaultProvider), id);
  return id;
}
/** Every quoted `model = "..."` assignment with the TOML section it appears in. */
function tomlModelAssignments(raw: string): { section: string; model: string }[] {
  let section = '';
  const assignments: { section: string; model: string }[] = [];
  for (const line of raw.split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) { section = header[1]!; continue; }
    const match = line.match(/^\s*model\s*=\s*["']([^"']+)["']/);
    if (match) assignments.push({ section, model: match[1]! });
  }
  return assignments;
}
function parseTomlModel(file: ConfigFile, raw: string, profile?: string): string | undefined {
  const assignments = tomlModelAssignments(raw);
  const lastIn = (section: string) => assignments.filter((row) => row.section === section).pop()?.model;
  const profileChoice = profile ? lastIn(`profiles.${profile}`) : undefined;
  return profileChoice || lastIn(file.key === 'models.model' ? 'models' : '');
}
export function parseConfiguredModel(file: ConfigFile, raw: string, profile?: string): string | undefined {
  if (file.format === 'json') return parseJsonModel(file, raw);
  if (file.format === 'yaml') return scalar(raw.match(/^model\s*:\s*["']?([^\n"'#]+)["']?\s*(?:#.*)?$/m)?.[1]);
  return parseTomlModel(file, raw, profile);
}
const MODEL_ENV: Record<string, readonly string[]> = {
  claude: ['ANTHROPIC_MODEL'], aider: ['AIDER_MODEL'], amr: ['VELA_DEFAULT_MODEL'],
  deepseek: ['CODEWHALE_MODEL', 'DEEPSEEK_MODEL'], qwen: ['QWEN_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'GEMINI_MODEL'],
};
const PROJECT_ROOT_AGENTS: ReadonlySet<string> = new Set(['claude', 'aider', 'opencode']);
const INLINE_CONFIG_ENV: ReadonlyMap<string, string> = new Map([['opencode', 'OPENCODE_CONFIG_CONTENT'], ['mimo', 'MIMOCODE_CONFIG_CONTENT']]);
async function withProjectRoot(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelDiscoveryContext> {
  if (context.projectRoot || !PROJECT_ROOT_AGENTS.has(agentId) || !deps.fs.projectRoot) return context;
  const projectRoot = await deps.fs.projectRoot({ cwd: context.cwd, signal });
  return projectRoot ? { ...context, projectRoot } : context;
}
/** Later files override earlier ones; Pi merges its files so provider and model may be split. */
function fileSelection(agentId: string, contents: readonly { file: ConfigFile; raw: string | null }[], profile?: string): string | undefined {
  if (agentId === 'pi') {
    const effective = Object.assign({}, ...contents.map(({ raw }) => raw ? parseSettingsJson(raw) || {} : {})) as Record<string, unknown>;
    return qualified(scalar(effective.defaultProvider), scalar(effective.defaultModel));
  }
  let selection: string | undefined;
  for (const { file, raw } of contents) if (raw !== null) selection = parseConfiguredModel(file, raw, profile) || selection;
  return selection;
}
function inlineSelection(agentId: string, env: ModelDiscoveryContext['env']): string | undefined {
  const key = INLINE_CONFIG_ENV.get(agentId);
  const inline = key ? env[key] : undefined;
  return inline ? scalar(parseSettingsJson(inline)?.model) : undefined;
}
/** The first listed model variable with a value wins. */
function envSelection(agentId: string, env: ModelDiscoveryContext['env']): string | undefined {
  return (MODEL_ENV[agentId] || []).map((key) => scalar(env[key])).find(Boolean);
}
async function claudeSettingsRaw(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<string | null> {
  if (agentId !== 'claude' || !context.settings) return null;
  return context.settings.trim().startsWith('{') ? context.settings : deps.fs.read(context.settings, { signal });
}
export async function readModelConfiguration(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<{ selection?: string; fingerprintMaterial: string }> {
  context = await withProjectRoot(agentId, context, deps, signal);
  const files = modelConfigFiles(agentId, context);
  const contents = await Promise.all(files.map(async (file) => ({ file, raw: await deps.fs.read(file.path, { signal }) })));
  const settingsRaw = await claudeSettingsRaw(agentId, context, deps, signal);
  const settingsModel = settingsRaw ? scalar(parseSettingsJson(settingsRaw)?.model) : undefined;
  // Precedence, strongest first: launch model, Claude --settings, model env, inline config content, config files.
  const selection = context.model || settingsModel || envSelection(agentId, context.env) || inlineSelection(agentId, context.env) || fileSelection(agentId, contents, context.profile);
  // Material is hashed by the orchestration layer and is never exposed over HTTP.
  return { ...(selection ? { selection } : {}), fingerprintMaterial: JSON.stringify([contents.map(({ file, raw }) => [file.path, raw]), settingsRaw || '']) };
}
