import { describe, expect, it } from 'vitest';
import {
  agentCliEnvValue,
  agentDiagnosticTooltip,
  agentExecutableRepairState,
  agentMetaLabel,
  agentModelSummary,
  binPathEnvField,
  cleanAgentVersionLabel,
  cliEnvFieldsForAgent,
  credentialsForPreset,
  filterAgentModelOptions,
  groupPresets,
  isBaseUrlInvalid,
  isProviderConfigured,
  isValidApiBaseUrl,
  missingRequiredFields,
  nextConfigForAgentCliEnvChange,
  nextConfigForAgentModel,
  nextConfigForAgentReasoning,
  nextConfigForAgentSelect,
  nextConfigForModeChange,
  nextConfigForPresetSelect,
  nextConfigForProtocolSelect,
  parseMaxTokens,
  presetRequiresApiKey,
  presetsForProtocol,
  resolveSelectedPreset,
  selectedAgentModel,
  selectedAgentReasoning,
  shouldShowCustomModelInput,
  showsBaseUrlField,
  sortDetectedAgents,
} from '../../../tabs/execution/rules.js';
import type {
  AgentCliEnvFieldSpec,
  AgentDiagnostic,
  ByokConfig,
  DetectedAgent,
  ExecutionConfig,
  LocalCliConfig,
  ProviderPreset,
} from '../../../tabs/execution/types.js';

function byok(overrides: Partial<ByokConfig> = {}): ByokConfig {
  return {
    protocol: 'anthropic',
    providerId: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com',
    model: 'example-model',
    ...overrides,
  };
}

function preset(overrides: Partial<ProviderPreset> = {}): ProviderPreset {
  return {
    id: 'anthropic',
    title: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.example.com',
    preferredModels: ['example-model'],
    ...overrides,
  };
}

describe('isValidApiBaseUrl', () => {
  it('accepts absolute http and https URLs', () => {
    expect(isValidApiBaseUrl('https://api.example.com')).toBe(true);
    expect(isValidApiBaseUrl('http://localhost:11434/v1')).toBe(true);
  });

  it('rejects blank, relative, and non-http schemes', () => {
    expect(isValidApiBaseUrl('')).toBe(false);
    expect(isValidApiBaseUrl('   ')).toBe(false);
    expect(isValidApiBaseUrl('/v1/messages')).toBe(false);
    expect(isValidApiBaseUrl('ftp://example.com')).toBe(false);
    expect(isValidApiBaseUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('isBaseUrlInvalid', () => {
  it('treats an untouched blank field as not-yet-an-error', () => {
    expect(isBaseUrlInvalid(byok({ baseUrl: '' }))).toBe(false);
  });

  it('flags a non-empty value that is not a URL', () => {
    expect(isBaseUrlInvalid(byok({ baseUrl: 'not a url' }))).toBe(true);
  });
});

describe('presetRequiresApiKey / showsBaseUrlField', () => {
  it('requires a key unless the preset explicitly opts out', () => {
    expect(presetRequiresApiKey(preset())).toBe(true);
    expect(presetRequiresApiKey(null)).toBe(true);
    expect(presetRequiresApiKey(preset({ requiresApiKey: false }))).toBe(false);
  });

  it('hides Base URL only for fixed-origin gateways', () => {
    expect(showsBaseUrlField(preset())).toBe(true);
    expect(showsBaseUrlField(null)).toBe(true);
    expect(showsBaseUrlField(preset({ fixedOrigin: true }))).toBe(false);
  });
});

describe('missingRequiredFields', () => {
  it('reports nothing when every required field is present', () => {
    expect(missingRequiredFields(byok(), preset())).toEqual([]);
  });

  it('reports blank key, invalid URL, and blank model in render order', () => {
    expect(missingRequiredFields(byok({ apiKey: ' ', baseUrl: 'nope', model: '' }), preset())).toEqual([
      'apiKey',
      'baseUrl',
      'model',
    ]);
  });

  it('does not require a key for a keyless preset', () => {
    expect(missingRequiredFields(byok({ apiKey: '' }), preset({ requiresApiKey: false }))).toEqual([]);
  });

  it('does not require a base URL for a fixed-origin gateway', () => {
    expect(missingRequiredFields(byok({ baseUrl: '' }), preset({ fixedOrigin: true }))).toEqual([]);
  });
});

describe('credentialsForPreset / isProviderConfigured (per-provider keying)', () => {
  it('is true exactly when nothing is missing for the ACTIVE preset', () => {
    expect(isProviderConfigured(byok(), preset())).toBe(true);
    expect(isProviderConfigured(byok({ apiKey: '' }), preset())).toBe(false);
  });

  it('reads a non-active preset from its own saved draft, not the active form fields', () => {
    const config = byok({
      providerId: 'anthropic',
      apiKey: 'anthropic-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      savedByProviderId: { ollama: { apiKey: '', baseUrl: 'http://localhost:11434/v1', model: 'llama3' } },
    });
    const ollama = preset({ id: 'ollama', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', requiresApiKey: false });
    expect(credentialsForPreset(config, ollama)).toEqual({
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3',
      maxTokens: undefined,
    });
    expect(isProviderConfigured(config, ollama)).toBe(true);
  });

  it('BUG FIX: a keyless preset with no saved draft does NOT read as configured just because a different provider is active', () => {
    // Regression for the reported bug: the active (Anthropic) form holds a
    // valid key + base URL + model, but Ollama (keyless) has never been
    // configured itself. Ollama's chip must not borrow Anthropic's base URL.
    const config = byok({
      providerId: 'anthropic',
      apiKey: 'anthropic-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
    });
    const ollama = preset({ id: 'ollama', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', requiresApiKey: false });
    expect(isProviderConfigured(config, ollama)).toBe(false);
    expect(credentialsForPreset(config, ollama)).toEqual({
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: '',
      maxTokens: undefined,
    });
  });

  it('returns false for a null preset', () => {
    expect(isProviderConfigured(byok(), null)).toBe(false);
  });
});

describe('presetsForProtocol / groupPresets', () => {
  const catalog: ProviderPreset[] = [
    preset({ id: 'a', protocol: 'anthropic', kind: 'protocol' }),
    preset({ id: 'b', protocol: 'openai', kind: 'protocol' }),
    preset({ id: 'c', protocol: 'openai', kind: 'gateway' }),
    preset({ id: 'custom', custom: true }),
  ];

  it('filters by protocol and excludes the custom entry', () => {
    expect(presetsForProtocol(catalog, 'openai').map((p) => p.id)).toEqual(['b', 'c']);
    expect(presetsForProtocol(catalog, 'anthropic').map((p) => p.id)).toEqual(['a']);
  });

  it('splits into protocol and gateway rows, dropping custom', () => {
    const { protocols, gateways } = groupPresets(catalog);
    expect(protocols.map((p) => p.id)).toEqual(['a', 'b']);
    expect(gateways.map((p) => p.id)).toEqual(['c']);
  });

  it('defaults a kind-less preset into the protocol row so hosts ignoring kind still see one populated row', () => {
    const { protocols, gateways } = groupPresets([preset({ id: 'x' })]);
    expect(protocols.map((p) => p.id)).toEqual(['x']);
    expect(gateways).toEqual([]);
  });
});

describe('resolveSelectedPreset', () => {
  const catalog = [preset({ id: 'a' }), preset({ id: 'b', baseUrl: 'https://b.example.com' })];

  it('returns null when the config is on custom', () => {
    expect(resolveSelectedPreset(catalog, byok({ providerId: null }))).toBeNull();
  });

  it('matches by id first', () => {
    expect(resolveSelectedPreset(catalog, byok({ providerId: 'b' }))?.id).toBe('b');
  });

  it('falls back to protocol+baseUrl so a config from an older catalog still resolves', () => {
    const resolved = resolveSelectedPreset(
      catalog,
      byok({ providerId: 'gone', baseUrl: 'https://b.example.com' }),
    );
    expect(resolved?.id).toBe('b');
  });

  it('returns null when neither id nor endpoint matches', () => {
    expect(resolveSelectedPreset(catalog, byok({ providerId: 'gone', baseUrl: 'https://z.example.com' }))).toBeNull();
  });
});

describe('nextConfigForPresetSelect', () => {
  it('adopts the preset endpoint and top preferred model when switching from custom (nothing to snapshot)', () => {
    const next = nextConfigForPresetSelect(
      byok({ providerId: null, baseUrl: '', model: '' }),
      preset({ id: 'b', baseUrl: 'https://b.example.com', preferredModels: ['m1', 'm2'] }),
    );
    expect(next).toMatchObject({ providerId: 'b', baseUrl: 'https://b.example.com', model: 'm1' });
  });

  // Regression coverage for the per-provider credential bug: switching
  // presets must NOT hand the outgoing provider's key/base URL/model to an
  // unrelated preset that has never been configured — that sharing is what
  // let a keyless preset's chip read as "configured" off an active
  // provider's live values (see `isProviderConfigured`'s bug-fix test above).
  it('does NOT carry an API key over to a different, never-configured preset', () => {
    const next = nextConfigForPresetSelect(byok({ providerId: 'anthropic', apiKey: 'keep-me' }), preset({ id: 'b' }));
    expect(next.apiKey).toBe('');
  });

  it('snapshots the outgoing provider into savedByProviderId before switching', () => {
    const before = byok({ providerId: 'anthropic', apiKey: 'anthropic-key', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' });
    const next = nextConfigForPresetSelect(before, preset({ id: 'b', baseUrl: 'https://b.example.com' }));
    expect(next.savedByProviderId?.anthropic).toEqual({
      apiKey: 'anthropic-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      maxTokens: undefined,
    });
  });

  it('restores a preset\'s own previously-saved credentials when switching back to it', () => {
    const config = byok({
      providerId: 'b',
      apiKey: '',
      baseUrl: 'https://b.example.com',
      model: '',
      savedByProviderId: {
        anthropic: { apiKey: 'saved-key', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
      },
    });
    const next = nextConfigForPresetSelect(config, preset({ id: 'anthropic', baseUrl: 'https://api.anthropic.com' }));
    expect(next).toMatchObject({
      providerId: 'anthropic',
      apiKey: 'saved-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
    });
  });

  it('a never-configured preset with no preferred models starts with a blank model rather than inheriting a different provider\'s model', () => {
    const next = nextConfigForPresetSelect(
      byok({ providerId: 'anthropic', model: 'mine' }),
      preset({ id: 'b', preferredModels: [] }),
    );
    expect(next.model).toBe('');
  });

  it('selecting the custom preset clears the provider id and snapshots the outgoing provider', () => {
    const before = byok();
    const next = nextConfigForPresetSelect(before, preset({ id: 'custom', custom: true }));
    expect(next).toEqual({
      ...before,
      providerId: null,
      savedByProviderId: {
        anthropic: { apiKey: before.apiKey, baseUrl: before.baseUrl, model: before.model, maxTokens: before.maxTokens },
      },
    });
  });
});

describe('nextConfigForProtocolSelect', () => {
  it('is identity when the protocol is unchanged', () => {
    const before = byok();
    expect(nextConfigForProtocolSelect(before, 'anthropic')).toBe(before);
  });

  it('drops the preset selection and keeps an operator-typed base URL', () => {
    const next = nextConfigForProtocolSelect(byok({ baseUrl: 'https://mine.example.com' }), 'openai');
    expect(next.providerId).toBeNull();
    expect(next.protocol).toBe('openai');
    expect(next.baseUrl).toBe('https://mine.example.com');
  });

  it('adopts the protocol default when no base URL was typed', () => {
    const next = nextConfigForProtocolSelect(byok({ baseUrl: '' }), 'openai');
    expect(next.baseUrl).toBe('https://api.openai.com/v1');
  });
});

describe('nextConfigForModeChange', () => {
  const config: ExecutionConfig = { mode: 'local-cli', byok: byok(), localCli: { agentId: null } };

  it('is identity when the mode is unchanged', () => {
    expect(nextConfigForModeChange(config, 'local-cli')).toBe(config);
  });

  it('preserves BYOK credentials across a mode flip', () => {
    const next = nextConfigForModeChange(config, 'byok');
    expect(next.mode).toBe('byok');
    expect(next.byok).toEqual(config.byok);
  });
});

describe('parseMaxTokens', () => {
  it('treats blank as "use the model default"', () => {
    expect(parseMaxTokens('')).toBeUndefined();
    expect(parseMaxTokens('   ')).toBeUndefined();
  });

  it('parses a positive integer', () => {
    expect(parseMaxTokens('8192')).toBe(8192);
  });

  it('rejects zero, negatives, fractions, and junk rather than storing 0', () => {
    expect(parseMaxTokens('0')).toBeUndefined();
    expect(parseMaxTokens('-5')).toBeUndefined();
    expect(parseMaxTokens('1.5')).toBeUndefined();
    expect(parseMaxTokens('lots')).toBeUndefined();
  });
});

describe('sortDetectedAgents', () => {
  it('puts installed agents first, then sorts alphabetically', () => {
    const sorted = sortDetectedAgents([
      { id: '1', label: 'Zeta', installed: false },
      { id: '2', label: 'Beta', installed: true },
      { id: '3', label: 'Alpha', installed: false },
      { id: '4', label: 'Alpha2', installed: true },
    ]);
    expect(sorted.map((a) => a.label)).toEqual(['Alpha2', 'Beta', 'Alpha', 'Zeta']);
  });

  it('does not mutate its input', () => {
    const input = [
      { id: '1', label: 'Zeta', installed: false },
      { id: '2', label: 'Beta', installed: true },
    ];
    sortDetectedAgents(input);
    expect(input.map((a) => a.label)).toEqual(['Zeta', 'Beta']);
  });
});

/**
 * Local-CLI decision logic. These were previously exercised only through the
 * React layer in `@jini-ai/ui`, which meant the *decisions* — auth status
 * outranking the version string, a stale model pick surviving a list refresh,
 * re-selecting an agent being a no-op — had no direct test naming them.
 */

function agent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return { id: 'claude', label: 'Claude Code', installed: true, ...overrides };
}

describe('cleanAgentVersionLabel', () => {
  it('is blank when the CLI reported no version', () => {
    expect(cleanAgentVersionLabel('Claude Code', undefined)).toBe('');
    expect(cleanAgentVersionLabel('Claude Code', null)).toBe('');
  });

  it('strips a redundant trailing agent name in either shape', () => {
    expect(cleanAgentVersionLabel('Claude Code', '1.2.3 (Claude Code)')).toBe('1.2.3');
    expect(cleanAgentVersionLabel('Claude Code', '1.2.3 Claude Code')).toBe('1.2.3');
  });

  it('leaves a version that merely contains the name intact', () => {
    expect(cleanAgentVersionLabel('Claude Code', 'Claude Code build 9')).toBe('Claude Code build 9');
  });

  it('does not treat the label as a regex', () => {
    expect(cleanAgentVersionLabel('a.b', '1.0 (a.b)')).toBe('1.0');
    expect(cleanAgentVersionLabel('a.b', '1.0 (axb)')).toBe('1.0 (axb)');
  });
});

describe('agentMetaLabel', () => {
  const labels = {
    authRequired: 'Authentication required',
    authUnknown: 'Auth status unknown',
    installed: 'Installed',
    notInstalled: 'Not installed',
  };

  it('reports auth trouble instead of the version', () => {
    // A signed-out CLI showing "1.2.3" reads as everything being fine.
    const missing = agentMetaLabel(agent({ version: '1.2.3', authStatus: 'missing' }), labels);
    expect(missing.text).toBe('Authentication required');
    const unknown = agentMetaLabel(agent({ version: '1.2.3', authStatus: 'unknown' }), labels);
    expect(unknown.text).toBe('Auth status unknown');
  });

  it('keeps unknown distinct from missing rather than collapsing them', () => {
    expect(agentMetaLabel(agent({ authStatus: 'unknown' }), labels).text).not.toBe(
      agentMetaLabel(agent({ authStatus: 'missing' }), labels).text,
    );
  });

  it('falls back to "Installed" when there is no version to show', () => {
    expect(agentMetaLabel(agent({ authStatus: 'ok' }), labels).text).toBe('Installed');
  });

  it('reports a missing agent regardless of any other field', () => {
    expect(agentMetaLabel(agent({ installed: false, version: '9' }), labels).text).toBe('Not installed');
  });

  it('puts the actionable detail in the tooltip, preferring the auth message', () => {
    expect(
      agentMetaLabel(agent({ authStatus: 'missing', authMessage: 'run login', path: '/bin/c' }), labels).title,
    ).toBe('run login');
    expect(agentMetaLabel(agent({ authStatus: 'ok', path: '/bin/c' }), labels).title).toBe('/bin/c');
    expect(agentMetaLabel(agent({ authStatus: 'ok' }), labels).title).toBe('');
  });
});

describe('selectedAgentModel / agentModelSummary', () => {
  const models = [
    { id: 'm1', label: 'Model One' },
    { id: 'm2', label: 'Model Two' },
  ];

  it('prefers the operator pick over the reported default', () => {
    const config: LocalCliConfig = { agentId: 'claude', modelByAgentId: { claude: 'm2' } };
    expect(selectedAgentModel(config, agent({ models }))).toBe('m2');
  });

  it('falls back to the first reported model, then to nothing', () => {
    expect(selectedAgentModel({ agentId: 'claude' }, agent({ models }))).toBe('m1');
    expect(selectedAgentModel({ agentId: 'claude' }, agent())).toBe('');
  });

  it('ignores a blank pick rather than treating it as a choice', () => {
    const config: LocalCliConfig = { agentId: 'claude', modelByAgentId: { claude: '   ' } };
    expect(selectedAgentModel(config, agent({ models }))).toBe('m1');
  });

  it('keys picks per agent so switching agents does not cross-contaminate', () => {
    const config: LocalCliConfig = { agentId: 'claude', modelByAgentId: { codex: 'm2' } };
    expect(selectedAgentModel(config, agent({ id: 'claude', models }))).toBe('m1');
  });

  it('summarises a stale pick by raw id rather than hiding it', () => {
    // Hiding it would misreport what will actually run.
    const config: LocalCliConfig = { agentId: 'claude', modelByAgentId: { claude: 'retired' } };
    expect(agentModelSummary(config, agent({ models }))).toBe('retired');
    expect(agentModelSummary({ agentId: 'claude' }, agent({ models }))).toBe('Model One');
    expect(agentModelSummary({ agentId: 'claude' }, agent())).toBe('');
  });
});

describe('nextConfigForAgentSelect / nextConfigForAgentModel', () => {
  const base: ExecutionConfig = { mode: 'local-cli', byok: byok(), localCli: { agentId: null } };

  it('is identity when re-picking the selected agent', () => {
    const selected = { ...base, localCli: { agentId: 'claude' } };
    expect(nextConfigForAgentSelect(selected, 'claude')).toBe(selected);
  });

  it('selects without disturbing saved per-agent models or BYOK state', () => {
    const withPicks: ExecutionConfig = {
      ...base,
      localCli: { agentId: 'claude', modelByAgentId: { claude: 'm1', codex: 'm9' } },
    };
    const next = nextConfigForAgentSelect(withPicks, 'codex');
    expect(next.localCli.agentId).toBe('codex');
    expect(next.localCli.modelByAgentId).toEqual({ claude: 'm1', codex: 'm9' });
    expect(next.byok).toEqual(withPicks.byok);
  });

  it('records a model per agent without clobbering the others', () => {
    const first = nextConfigForAgentModel(base, 'claude', 'm1');
    const second = nextConfigForAgentModel(first, 'codex', 'm9');
    expect(second.localCli.modelByAgentId).toEqual({ claude: 'm1', codex: 'm9' });
    // The originals are untouched — these are pure transitions.
    expect(base.localCli.modelByAgentId).toBeUndefined();
    expect(first.localCli.modelByAgentId).toEqual({ claude: 'm1' });
  });
});

describe('selectedAgentReasoning / nextConfigForAgentReasoning', () => {
  const reasoningOptions = [
    { id: 'low', label: 'Low' },
    { id: 'high', label: 'High' },
  ];
  const base: ExecutionConfig = { mode: 'local-cli', byok: byok(), localCli: { agentId: null } };

  it('prefers the operator pick over the reported default', () => {
    const config: LocalCliConfig = { agentId: 'claude', reasoningByAgentId: { claude: 'high' } };
    expect(selectedAgentReasoning(config, agent({ reasoningOptions }))).toBe('high');
  });

  it('falls back to the first reported option, then to nothing', () => {
    expect(selectedAgentReasoning({ agentId: 'claude' }, agent({ reasoningOptions }))).toBe('low');
    expect(selectedAgentReasoning({ agentId: 'claude' }, agent())).toBe('');
  });

  it('ignores a blank pick rather than treating it as a choice', () => {
    const config: LocalCliConfig = { agentId: 'claude', reasoningByAgentId: { claude: '   ' } };
    expect(selectedAgentReasoning(config, agent({ reasoningOptions }))).toBe('low');
  });

  it('keys picks per agent so switching agents does not cross-contaminate', () => {
    const config: LocalCliConfig = { agentId: 'claude', reasoningByAgentId: { codex: 'high' } };
    expect(selectedAgentReasoning(config, agent({ id: 'claude', reasoningOptions }))).toBe('low');
  });

  it('records a reasoning pick per agent without clobbering the others or the model map', () => {
    const withModel = nextConfigForAgentModel(base, 'claude', 'm1');
    const first = nextConfigForAgentReasoning(withModel, 'claude', 'high');
    const second = nextConfigForAgentReasoning(first, 'codex', 'low');
    expect(second.localCli.reasoningByAgentId).toEqual({ claude: 'high', codex: 'low' });
    expect(second.localCli.modelByAgentId).toEqual({ claude: 'm1' });
    // The originals are untouched — these are pure transitions.
    expect(base.localCli.reasoningByAgentId).toBeUndefined();
    expect(first.localCli.reasoningByAgentId).toEqual({ claude: 'high' });
  });
});

describe('shouldShowCustomModelInput', () => {
  it('shows custom input once the operator has explicitly switched to it', () => {
    expect(shouldShowCustomModelInput('m1', ['m1', 'm2'], true)).toBe(true);
  });

  it('shows custom input when there is no resolved value yet', () => {
    expect(shouldShowCustomModelInput('', ['m1', 'm2'], false)).toBe(true);
  });

  it('shows custom input when the value is not one of the known models', () => {
    expect(shouldShowCustomModelInput('retired-model', ['m1', 'm2'], false)).toBe(true);
  });

  it('hides custom input for a known value with no explicit toggle', () => {
    expect(shouldShowCustomModelInput('m1', ['m1', 'm2'], false)).toBe(false);
  });
});

describe('per-agent CLI env fields', () => {
  const FIELDS: AgentCliEnvFieldSpec[] = [
    { agentId: 'claude', envKey: 'ANTHROPIC_BASE_URL', label: 'Base URL' },
    { agentId: 'claude', envKey: 'ANTHROPIC_API_KEY', label: 'API key', secret: true },
    { agentId: 'codex', envKey: 'CODEX_BIN', label: 'Binary path', kind: 'binPath' },
    { agentId: 'codex', envKey: 'OPENAI_BASE_URL', label: 'Base URL' },
  ];

  describe('cliEnvFieldsForAgent', () => {
    it('filters the shared catalog down to one agent, preserving catalog order', () => {
      expect(cliEnvFieldsForAgent(FIELDS, 'claude').map((f) => f.envKey)).toEqual([
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_API_KEY',
      ]);
    });

    it('returns an empty list for an agent with no configurable fields', () => {
      expect(cliEnvFieldsForAgent(FIELDS, 'unknown-agent')).toEqual([]);
    });
  });

  describe('binPathEnvField', () => {
    it('finds the field tagged as the binary-path override', () => {
      expect(binPathEnvField(FIELDS, 'codex')?.envKey).toBe('CODEX_BIN');
    });

    it('returns null for an agent with no binPath-tagged field', () => {
      expect(binPathEnvField(FIELDS, 'claude')).toBeNull();
    });
  });

  describe('agentCliEnvValue / nextConfigForAgentCliEnvChange', () => {
    const base: ExecutionConfig = { mode: 'local-cli', byok: byok(), localCli: { agentId: 'claude' } };

    it('reads an unset field as blank', () => {
      expect(agentCliEnvValue(base.localCli, 'claude', 'ANTHROPIC_BASE_URL')).toBe('');
    });

    it('sets a field, trimming the input', () => {
      const next = nextConfigForAgentCliEnvChange(base, 'claude', 'ANTHROPIC_BASE_URL', '  https://proxy.example.com  ');
      expect(agentCliEnvValue(next.localCli, 'claude', 'ANTHROPIC_BASE_URL')).toBe('https://proxy.example.com');
      // The original is untouched — this is a pure transition.
      expect(agentCliEnvValue(base.localCli, 'claude', 'ANTHROPIC_BASE_URL')).toBe('');
    });

    it('keeps two fields for the same agent independent', () => {
      const withBaseUrl = nextConfigForAgentCliEnvChange(base, 'claude', 'ANTHROPIC_BASE_URL', 'https://a.example.com');
      const withBoth = nextConfigForAgentCliEnvChange(withBaseUrl, 'claude', 'ANTHROPIC_API_KEY', 'sk-1');
      expect(withBoth.localCli.envByAgentId).toEqual({
        claude: { ANTHROPIC_BASE_URL: 'https://a.example.com', ANTHROPIC_API_KEY: 'sk-1' },
      });
    });

    it('keeps two agents independent so one CLI\'s override never bleeds into another\'s', () => {
      const withClaude = nextConfigForAgentCliEnvChange(base, 'claude', 'ANTHROPIC_BASE_URL', 'https://a.example.com');
      const withBoth = nextConfigForAgentCliEnvChange(withClaude, 'codex', 'CODEX_BIN', '/usr/local/bin/codex');
      expect(withBoth.localCli.envByAgentId).toEqual({
        claude: { ANTHROPIC_BASE_URL: 'https://a.example.com' },
        codex: { CODEX_BIN: '/usr/local/bin/codex' },
      });
    });

    it('clearing the last field for an agent drops that agent from the map entirely, not just to {}', () => {
      const withField = nextConfigForAgentCliEnvChange(base, 'claude', 'ANTHROPIC_BASE_URL', 'https://a.example.com');
      const cleared = nextConfigForAgentCliEnvChange(withField, 'claude', 'ANTHROPIC_BASE_URL', '');
      expect(cleared.localCli.envByAgentId).toEqual({});
      expect(cleared.localCli.envByAgentId?.claude).toBeUndefined();
    });

    it('clearing one field leaves a sibling field for the same agent intact', () => {
      const withBaseUrl = nextConfigForAgentCliEnvChange(base, 'claude', 'ANTHROPIC_BASE_URL', 'https://a.example.com');
      const withBoth = nextConfigForAgentCliEnvChange(withBaseUrl, 'claude', 'ANTHROPIC_API_KEY', 'sk-1');
      const clearedOne = nextConfigForAgentCliEnvChange(withBoth, 'claude', 'ANTHROPIC_API_KEY', '');
      expect(clearedOne.localCli.envByAgentId).toEqual({ claude: { ANTHROPIC_BASE_URL: 'https://a.example.com' } });
    });

    it('a whitespace-only value clears the field rather than storing blank spaces', () => {
      const withField = nextConfigForAgentCliEnvChange(base, 'claude', 'ANTHROPIC_BASE_URL', 'https://a.example.com');
      const cleared = nextConfigForAgentCliEnvChange(withField, 'claude', 'ANTHROPIC_BASE_URL', '   ');
      expect(cleared.localCli.envByAgentId).toEqual({});
    });
  });
});

describe('agentExecutableRepairState', () => {
  it('offers the repair when a successful test silently fell back off an invalid override', () => {
    expect(
      agentExecutableRepairState({
        ok: true,
        usedExecutableSource: 'fallback-invalid',
        detectedExecutablePath: '/usr/local/bin/codex',
      }),
    ).toEqual({ detectedPath: '/usr/local/bin/codex', canUseDetected: true });
  });

  it('offers the repair the same way for a fallback that resolved but failed to run', () => {
    expect(
      agentExecutableRepairState({
        ok: true,
        usedExecutableSource: 'fallback-failed',
        detectedExecutablePath: '/opt/homebrew/bin/codex',
      }),
    ).toEqual({ detectedPath: '/opt/homebrew/bin/codex', canUseDetected: true });
  });

  it('returns null for a normal primary-binary run', () => {
    expect(
      agentExecutableRepairState({ ok: true, usedExecutableSource: 'primary', detectedExecutablePath: '/bin/x' }),
    ).toBeNull();
  });

  it('returns null for a failed test regardless of executable source', () => {
    expect(
      agentExecutableRepairState({ ok: false, usedExecutableSource: 'fallback-invalid', detectedExecutablePath: '/bin/x' }),
    ).toBeNull();
  });

  it('returns null when the host did not report which executable it used', () => {
    expect(agentExecutableRepairState({ ok: true })).toBeNull();
  });

  it('returns null for a fallback with no usable detected path', () => {
    expect(agentExecutableRepairState({ ok: true, usedExecutableSource: 'fallback-invalid' })).toBeNull();
    expect(
      agentExecutableRepairState({ ok: true, usedExecutableSource: 'fallback-invalid', detectedExecutablePath: '   ' }),
    ).toBeNull();
  });
});

describe('filterAgentModelOptions', () => {
  const options = [
    { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { id: 'gpt-4o', label: 'GPT-4o' },
  ];

  it('returns every option for a blank query', () => {
    expect(filterAgentModelOptions(options, '', '')).toEqual(options);
    expect(filterAgentModelOptions(options, '   ', '')).toEqual(options);
  });

  it('matches case-insensitively against the label', () => {
    expect(filterAgentModelOptions(options, 'HAIKU', '').map((o) => o.id)).toEqual(['claude-haiku-4-5']);
  });

  it('matches against the raw id even when it does not appear in the label', () => {
    expect(filterAgentModelOptions(options, 'gpt-4o', '').map((o) => o.id)).toEqual(['gpt-4o']);
  });

  it('keeps the selected option visible even when it stops matching the query', () => {
    const filtered = filterAgentModelOptions(options, 'haiku', 'gpt-4o');
    expect(filtered.map((o) => o.id).sort()).toEqual(['claude-haiku-4-5', 'gpt-4o']);
  });

  it('returns an empty list when nothing matches and nothing is selected', () => {
    expect(filterAgentModelOptions(options, 'nonexistent', '')).toEqual([]);
  });
});

describe('agentDiagnosticTooltip', () => {
  function diagnostic(overrides: Partial<AgentDiagnostic> = {}): AgentDiagnostic {
    return { reason: 'not-on-path', severity: 'error', message: 'Not found on PATH.', ...overrides };
  }

  it('is blank when there is nothing beyond the one-line message', () => {
    expect(agentDiagnosticTooltip(diagnostic())).toBe('');
  });

  it('surfaces the longer detail', () => {
    expect(agentDiagnosticTooltip(diagnostic({ detail: 'exit code 127' }))).toBe('exit code 127');
  });

  it('appends every searched directory after the detail', () => {
    expect(
      agentDiagnosticTooltip(
        diagnostic({ detail: 'exit code 127', searchedDirs: ['/usr/local/bin', '/opt/homebrew/bin'] }),
      ),
    ).toBe('exit code 127\n/usr/local/bin\n/opt/homebrew/bin');
  });

  it('lists searched directories even with no detail line', () => {
    expect(agentDiagnosticTooltip(diagnostic({ searchedDirs: ['/usr/local/bin'] }))).toBe('/usr/local/bin');
  });

  it('drops blank entries rather than rendering empty lines', () => {
    expect(agentDiagnosticTooltip(diagnostic({ detail: '', searchedDirs: [] }))).toBe('');
  });
});
