import type { AgentCliEnvFieldSpec, ApiProtocol, ProviderPreset } from './types.js';

/** Fallback endpoint per protocol, used when a host supplies no preset and
 *  the operator has not typed a base URL. Origin: `DEFAULT_BASE_URL_BY_PROTOCOL`. */
export const DEFAULT_BASE_URL_BY_PROTOCOL: Readonly<Record<ApiProtocol, string>> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  azure: '',
  google: 'https://generativelanguage.googleapis.com',
};

/** Display order and English labels for the protocol row. Values are i18n
 *  keys (this package's convention is "the English string is the key"). */
export const PROTOCOL_OPTIONS: ReadonlyArray<{ id: ApiProtocol; label: string }> = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'azure', label: 'Azure OpenAI' },
  { id: 'google', label: 'Google Gemini' },
];

/** Stable id for the synthetic "Custom" preset. */
export const CUSTOM_PRESET_ID = 'custom';

/** Sentinel model-select value meaning "let me type a model id by hand".
 *  Never a real model id (models are validated against this and rejected as
 *  a legitimate pick — see `shouldShowCustomModelInput`). Origin:
 *  `CUSTOM_MODEL_SENTINEL`. */
export const CUSTOM_MODEL_SENTINEL = '__custom__';

/**
 * A small, vendor-shaped starting catalog. Deliberately NOT the origin's full
 * ~30-entry list: that list is hand-curated product content that goes stale,
 * and this package's rule for tables like this (see `LanguageTab`) is that the
 * host owns them. Pass your own `presets` to replace this wholesale.
 */
export const DEFAULT_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'anthropic',
    title: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    preferredModels: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
    kind: 'protocol',
  },
  {
    id: 'openai',
    title: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    preferredModels: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
    kind: 'protocol',
  },
  {
    id: 'azure-openai',
    title: 'Azure OpenAI',
    protocol: 'azure',
    baseUrl: '',
    preferredModels: [],
    kind: 'protocol',
  },
  {
    id: 'google-gemini',
    title: 'Google Gemini',
    protocol: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com',
    // Ordered newest-first: `rules.ts`'s `saved?.model ?? preset.preferredModels[0]` makes entry [0]
    // the default for anyone who has never picked a model, so a stale head silently pins new users
    // to an old generation. Reported live: the field defaulted to `gemini-2.5-flash` while the
    // operator was actually running `gemini-3.6-flash`. This list is only a FALLBACK — the form
    // prefers live `listModels` discovery and drops back here when that call fails.
    preferredModels: ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    kind: 'protocol',
  },
  {
    id: 'openrouter',
    title: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    preferredModels: ['anthropic/claude-3.7-sonnet', 'google/gemini-2.5-pro', 'openai/gpt-4o'],
    kind: 'gateway',
  },
  {
    id: 'ollama',
    title: 'Ollama',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    preferredModels: [],
    kind: 'gateway',
    requiresApiKey: false,
  },
];

/**
 * One-line descriptions for the code-agent CLIs this package knows about,
 * keyed by the agent id `ExecutionPort` reports. Origin:
 * `SettingsDialog.tsx`'s `AGENT_SHORT_DESCRIPTIONS`.
 *
 * These describe the CLI's own vendor ("Anthropic official CLI"), not the
 * product embedding it, which is why they are generic enough to ship here —
 * the same reasoning that puts `PROTOCOL_OPTIONS` in this file. A host with a
 * different or larger agent catalog supplies `DetectedAgent.description`
 * directly and never consults this map; it is a fallback, not a gate, so an
 * unknown agent id renders without a tagline rather than being hidden.
 */
export const DEFAULT_AGENT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  claude: 'Anthropic official CLI',
  codex: 'OpenAI official CLI',
  'cursor-agent': 'Cursor command line',
  opencode: 'Open-source agent CLI',
  qwen: 'Qwen coding CLI',
  copilot: 'GitHub coding CLI',
  devin: 'Cognition terminal CLI',
  kimi: 'Moonshot Kimi CLI',
  qoder: 'Alibaba coding CLI',
  pi: 'Inflection chat CLI',
  kiro: 'Kiro agent CLI',
  kilo: 'Kilo Code CLI',
  vibe: 'Mistral open-source CLI',
  deepseek: 'DeepSeek terminal UI',
  hermes: 'ACP agent CLI',
  'grok-build': 'xAI coding CLI',
  reasonix: 'DeepSeek native coding CLI',
};

/**
 * Starter catalog of operator-configurable CLI environment variables for the
 * two agents the origin actually exposed fields for (Claude Code, Codex) —
 * proxy base URLs, custom config/home directories, and (Codex only) a
 * binary-path override. Origin: `AGENT_CLI_ENV_FIELDS`, with the
 * origin's dual `labelKey`+`labelSuffix` i18n plumbing collapsed into a
 * single plain `label` per this package's "the English string is the key"
 * convention (see `DEFAULT_AGENT_DESCRIPTIONS`).
 *
 * A host with a larger/different agent roster passes its own `fields` catalog
 * to `AgentCliEnvFields` rather than editing this one — same convention as
 * `DEFAULT_PROVIDER_PRESETS`. Only `codex`'s `CODEX_BIN` carries
 * `kind: 'binPath'`: the origin's path-repair affordance
 * (`agentExecutableRepairState`) is Codex-only in practice today, even though
 * the mechanism itself is generic to any agent a host tags this way.
 */
export const DEFAULT_AGENT_CLI_ENV_FIELDS: readonly AgentCliEnvFieldSpec[] = [
  {
    agentId: 'claude',
    envKey: 'CLAUDE_CONFIG_DIR',
    label: 'Config directory',
    placeholder: '~/.claude-2',
  },
  {
    agentId: 'claude',
    envKey: 'ANTHROPIC_BASE_URL',
    label: 'Base URL',
    placeholder: 'https://your-proxy.example.com',
  },
  {
    agentId: 'claude',
    envKey: 'ANTHROPIC_API_KEY',
    label: 'API key',
    placeholder: 'Paste CLI API key',
    secret: true,
  },
  {
    agentId: 'codex',
    envKey: 'CODEX_HOME',
    label: 'Config directory',
    placeholder: '~/.codex-alt',
  },
  {
    agentId: 'codex',
    envKey: 'CODEX_BIN',
    label: 'Binary path',
    placeholder: '/absolute/path/to/codex',
    kind: 'binPath',
  },
  {
    agentId: 'codex',
    envKey: 'OPENAI_BASE_URL',
    label: 'Base URL',
    placeholder: 'https://your-proxy.example.com/v1',
  },
  {
    agentId: 'codex',
    envKey: 'CODEX_API_KEY',
    label: 'API key (CODEX_API_KEY)',
    placeholder: 'Paste CODEX_API_KEY',
    secret: true,
  },
  {
    agentId: 'codex',
    envKey: 'OPENAI_API_KEY',
    label: 'API key (OPENAI_API_KEY)',
    placeholder: 'Paste OPENAI_API_KEY',
    secret: true,
  },
];
