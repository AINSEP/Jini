import type { ModelDiscoveryContext, ModelDiscoveryDeps } from './model-discovery-types.js';

/** JSON path of the model setting in the Qoder and Qwen settings files. */
export const MODEL_NAME_PATH = 'model.name';
export type ConfigFile = { path: string; format: 'json' | 'toml' | 'yaml'; key?: string };
export const json = (path: string, key = 'model'): ConfigFile => ({ path, format: 'json', key });
export type ConfigPaths = {
  env: ModelDiscoveryContext['env']; context: ModelDiscoveryContext; configHome: string;
  user(name: string): string; local(name: string): string; root(name: string): string;
};
export type ModelConfigAdapter = {
  files?: (paths: ConfigPaths) => ConfigFile[];
  modelEnv?: readonly string[];
  projectRoot?: boolean;
  inlineConfigEnv?: string;
  settingsRaw?: (context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal) => Promise<string | null>;
  fileSelection?: (contents: readonly { file: ConfigFile; raw: string | null }[]) => string | undefined;
};

export function parseSettingsJson(raw: string): Record<string, unknown> | null {
  try {
    // Preserve quoted strings (including URLs) while removing JSONC comments.
    const stripped = raw.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (token) => token.startsWith('"') ? token : '').replace(/,\s*([}\]])/g, '$1');
    const value: unknown = JSON.parse(stripped);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
export function scalar(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
/** "provider/id" when both parts are present; a bare id is never guessed into a provider. */
export function qualified(provider: string | undefined, id: string | undefined): string | undefined {
  return provider && id ? `${provider}/${id}` : undefined;
}
