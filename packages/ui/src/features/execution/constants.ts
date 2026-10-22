import type { AgentCliEnvFieldSpec, ApiProtocol, ProviderPreset } from './types.js';

/** @deprecated Endpoints come from host presets. Blank means the operator must supply an endpoint. */
export const DEFAULT_BASE_URL_BY_PROTOCOL: Readonly<Record<ApiProtocol, string>> = {
  anthropic: '',
  openai: '',
  azure: '',
  google: '',
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
 * The shortest string `apiKeyFormatWarning` will let pass without remark.
 *
 * Chosen from evidence rather than taste. The shortest real key shape in the integrations
 * starter presets is Azure OpenAI's bare 32-character hex string;
 * Google's is `AIza` + 35 = 39, OpenAI's `sk-` + 48 = 51, OpenRouter's `sk-or-v1-` + 64 = 73, and
 * Anthropic's longer again. 20 therefore sits 12 characters below that floor, so no credential this
 * catalog knows about can trip it, while it still catches the failure the check exists for: the
 * ~15-character saved PASSWORD Chrome autofilled into the key field (see
 * `ByokProviderForm.credential-hygiene.test.tsx`).
 *
 * A single global floor rather than a per-preset field on purpose — "shorter than any bearer secret
 * anyone issues" is a fact about secrets, not about a vendor, so a host adding a provider inherits
 * it without having to know it exists.
 */
export const MIN_PLAUSIBLE_API_KEY_LENGTH = 20;

/**
 * Shown when a pasted key carries ANOTHER catalog entry's key prefix. `{vendor}` is the provider
 * the key appears to belong to, `{provider}` the one currently selected.
 *
 * Names what was actually noticed, which the message it replaced did not: "this does not look like
 * a Google API key" was a claim about Google's formats, made without knowing them. This one needs a
 * positive match against a prefix some other row claims, so it cannot fire on a key that is merely
 * unfamiliar. English string as i18n key, per `DEFAULT_AGENT_DESCRIPTIONS`; the closing sentence is
 * load-bearing — this is advice, not a gate.
 */
export const API_KEY_CROSS_VENDOR_WARNING =
  'This looks like an API key for {vendor}, not {provider}. You can still save and test it.';

/** Shown when a key is shorter than {@link MIN_PLAUSIBLE_API_KEY_LENGTH}. Carries no placeholders:
 *  the length floor is global, so there is no vendor to name. */
export const API_KEY_TOO_SHORT_WARNING =
  'This is shorter than any provider API key — check that the whole key was pasted. You can still save and test it.';

/** @deprecated Supply host presets. The former starter set is exported by integrations/media-providers/catalog. */
export const DEFAULT_PROVIDER_PRESETS: readonly ProviderPreset[] = [];

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
