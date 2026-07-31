import { describe, expect, it } from 'vitest';
import {
  credentialsForPreset,
  groupPresets,
  isBaseUrlInvalid,
  isProviderConfigured,
  isValidApiBaseUrl,
  missingRequiredFields,
  nextConfigForModeChange,
  nextConfigForPresetSelect,
  nextConfigForProtocolSelect,
  parseMaxTokens,
  presetRequiresApiKey,
  presetsForProtocol,
  resolveSelectedPreset,
  showsBaseUrlField,
  sortDetectedAgents,
} from '../../../tabs/execution/rules.js';
import type {
  ByokConfig,
  ExecutionConfig,
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
  const config: ExecutionConfig = { mode: 'local-cli', byok: byok() };

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
