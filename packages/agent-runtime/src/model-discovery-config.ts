import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ModelDiscoveryContext, ModelDiscoveryDeps } from '@jini-ai/core/contracts/agents';
import { yamlModelCapture } from './model-discovery-yaml.js';

import { codexModelConfig } from './defs/codex/model-discovery.js';
import { claudeModelConfig } from './defs/claude/model-discovery.js';
import { antigravityModelConfig } from './defs/antigravity/model-discovery.js';
import { opencodeModelConfig, parseOpenCodeRecentModel } from './defs/opencode/model-discovery.js';
import { piModelConfig, parsePiDefaultModel } from './defs/pi/model-discovery.js';
import { aiderModelConfig } from './defs/aider/model-discovery.js';
import { grokBuildModelConfig } from './defs/grok-build/model-discovery.js';
import { codebuddyModelConfig } from './defs/codebuddy/model-discovery.js';
import { cursorAgentModelConfig } from './defs/cursor-agent/model-discovery.js';
import { droidModelConfig } from './defs/droid/model-discovery.js';
import { qoderModelConfig } from './defs/qoder/model-discovery.js';
import { qwenModelConfig } from './defs/qwen/model-discovery.js';
import { deepseekModelConfig } from './defs/deepseek/model-discovery.js';
import { mimoModelConfig } from './defs/mimo/model-discovery.js';
import { crushModelConfig } from './defs/crush/model-discovery.js';
import { amrModelConfig } from './defs/amr/model-discovery.js';
import { parseSettingsJson, scalar, type ConfigFile, type ModelConfigAdapter } from './model-discovery-config-types.js';
export { parseSettingsJson } from './model-discovery-config-types.js';

const CONFIG_FILES: ReadonlyMap<string, ModelConfigAdapter> = new Map([
  ['codex', codexModelConfig],
  ['claude', claudeModelConfig],
  ['antigravity', antigravityModelConfig],
  ['opencode', opencodeModelConfig],
  ['pi', piModelConfig],
  ['aider', aiderModelConfig],
  ['grok-build', grokBuildModelConfig],
  ['codebuddy', codebuddyModelConfig],
  ['cursor-agent', cursorAgentModelConfig],
  ['droid', droidModelConfig],
  ['qoder', qoderModelConfig],
  ['qwen', qwenModelConfig],
  ['deepseek', deepseekModelConfig],
  ['mimo', mimoModelConfig],
  ['crush', crushModelConfig],
  ['amr', amrModelConfig],
]);
/** Config-file resolvers read only settings, never auth-store contents. Precedence is applied
 * from global to workspace/local. Unknown native priorities remain unresolved, not invented. */
export function modelConfigFiles({ agentId, context }: { agentId: string; context: ModelDiscoveryContext }, _optional: Record<string, never> = {}): ConfigFile[] {
  const env = context.env;
  const home = env.HOME || homedir();
  const user = (name: string) => join(home, name);
  const local = (name: string) => join(context.cwd, name);
  const root = (name: string) => join(context.projectRoot || context.cwd, name);
  const configHome = env.XDG_CONFIG_HOME || user('.config');
  return CONFIG_FILES.get(agentId)?.files?.({ env, context, configHome, user, local, root }) ?? [];
}
function dotted(value: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((item, part) => item && typeof item === 'object' ? (item as Record<string, unknown>)[part] : undefined, value);
}
const JSON_MODEL_PARSERS: ReadonlyMap<string, (model: unknown, settings: Record<string, unknown> | null) => string | undefined> = new Map([
  ['recent', parseOpenCodeRecentModel],
  ['defaultModel', parsePiDefaultModel],
]);
function parseJsonModel(file: ConfigFile, raw: string): string | undefined {
  const settings = parseSettingsJson({ raw });
  const model = dotted(settings, file.key || 'model');
  // Cursor's model object subkeys are undocumented: never guess which one is the effective id.
  const parse = file.key ? JSON_MODEL_PARSERS.get(file.key) : undefined;
  return parse ? parse(model, settings) : scalar({ value: model });
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
export function parseConfiguredModel({ file, raw }: { file: ConfigFile; raw: string }, { profile }: { profile?: string | undefined } = {}): string | undefined {
  if (file.format === 'json') return parseJsonModel(file, raw);
  if (file.format === 'yaml') return scalar({ value: yamlModelCapture({ raw }) });
  return parseTomlModel(file, raw, profile);
}
async function withProjectRoot(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelDiscoveryContext> {
  if (context.projectRoot || !CONFIG_FILES.get(agentId)?.projectRoot || !deps.fs.projectRoot) return context;
  const projectRoot = await deps.fs.projectRoot({ cwd: context.cwd, signal });
  return projectRoot ? { ...context, projectRoot } : context;
}
/** Later files override earlier ones; Pi merges its files so provider and model may be split. */
function fileSelection(agentId: string, contents: readonly { file: ConfigFile; raw: string | null }[], profile?: string): string | undefined {
  const select = CONFIG_FILES.get(agentId)?.fileSelection;
  if (select) return select(contents);
  let selection: string | undefined;
  for (const { file, raw } of contents) if (raw !== null) selection = parseConfiguredModel({ file, raw }, { profile }) || selection;
  return selection;
}
function inlineSelection(agentId: string, env: ModelDiscoveryContext['env']): string | undefined {
  const key = CONFIG_FILES.get(agentId)?.inlineConfigEnv;
  const inline = key ? env[key] : undefined;
  return inline ? scalar({ value: parseSettingsJson({ raw: inline })?.model }) : undefined;
}
/** The first listed model variable with a value wins. */
function envSelection(agentId: string, env: ModelDiscoveryContext['env']): string | undefined {
  return (CONFIG_FILES.get(agentId)?.modelEnv || []).map((key) => scalar({ value: env[key] })).find(Boolean);
}
function modelSettingsRaw(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<string | null> | null { return CONFIG_FILES.get(agentId)?.settingsRaw?.(context, deps, signal) ?? null; }
function configuredSelection(agentId: string, context: ModelDiscoveryContext, settings: {
  settingsModel: string | undefined; contents: readonly { file: ConfigFile; raw: string | null }[];
}): string | undefined {
  const { settingsModel, contents } = settings;
  // Precedence, strongest first: launch model, Claude --settings, model env, inline config content, config files.
  const launchSelection = context.model || settingsModel;
  return launchSelection || envSelection(agentId, context.env) || inlineSelection(agentId, context.env) || fileSelection(agentId, contents, context.profile);
}

export async function readModelConfiguration({ agentId, context, deps, signal }: { agentId: string; context: ModelDiscoveryContext; deps: ModelDiscoveryDeps; signal: AbortSignal }, _optional: Record<string, never> = {}): Promise<{ selection?: string; fingerprintMaterial: string }> {
  context = await withProjectRoot(agentId, context, deps, signal);
  const files = modelConfigFiles({ agentId, context });
  const contents = await Promise.all(files.map(async (file) => ({ file, raw: await deps.fs.read(file.path, { signal }) })));
  const settingsRaw = await modelSettingsRaw(agentId, context, deps, signal);
  const settingsModel = settingsRaw ? scalar({ value: parseSettingsJson({ raw: settingsRaw })?.model }) : undefined;
  const selection = configuredSelection(agentId, context, { settingsModel, contents });
  // Material is hashed by the orchestration layer and is never exposed over HTTP.
  return { ...(selection ? { selection } : {}), fingerprintMaterial: JSON.stringify([contents.map(({ file, raw }) => [file.path, raw]), settingsRaw || '']) };
}
