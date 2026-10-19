import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_OPTION,
  isKnownModel,
  getRememberedLiveModels,
  preferFreshLiveModels,
  rememberLiveModels,
  resolveModelForAgent,
  sanitizeCustomModel,
  validateRuntimeSelection,
} from '../models.js';
import type { RuntimeAgentDef } from '../types.js';

describe('validateRuntimeSelection', () => {
  const agents = [{ id: 'runtime', available: true, authStatus: 'ok' as const, modelsSource: 'live' as const, models: [
    { id: 'new-from-catalog', label: 'New', reasoning: [{ id: 'high', label: 'High' }] },
    { id: 'small', label: 'Small', reasoning: [] },
  ], reasoningOptions: [{ id: 'ultra', label: 'Ultra' }] }];
  it('accepts newly discovered ids and default sentinels without an allowlist', () => {
    expect(validateRuntimeSelection({ agents, agentId: 'runtime', modelId: 'new-from-catalog', effort: 'high' })).toBeNull();
    expect(validateRuntimeSelection({ agents, agentId: 'runtime', modelId: '', effort: '' })).toBeNull();
  });
  it('refuses unknown models with the actual available list', () => {
    expect(validateRuntimeSelection({ agents, agentId: 'runtime', modelId: 'missing' })).toContain('Available models: new-from-catalog, small');
  });
  it('honors each model\'s effort vocabulary, including an explicitly empty one', () => {
    expect(validateRuntimeSelection({ agents, agentId: 'runtime', modelId: 'new-from-catalog', effort: 'ultra' })).toContain('Available effort levels: high');
    expect(validateRuntimeSelection({ agents, agentId: 'runtime', modelId: 'small', effort: 'high' })).toContain('Unknown effort');
  });
  it('refuses unavailable agents and lists available agents', () => {
    expect(validateRuntimeSelection({ agents: [...agents, { id: 'offline', available: false, modelsSource: 'fallback', models: [] }], agentId: 'offline' })).toContain('Available agents: runtime');
  });
  it.each(['missing', 'unknown', undefined] as const)('refuses unready credentials (%s)', authStatus => {
    const { authStatus: _ready, ...unprobed } = agents[0]!;
    const agent = authStatus ? { ...unprobed, authStatus } : unprobed;
    expect(validateRuntimeSelection({ agents: [agent], agentId: 'runtime', modelId: 'small' })).toContain('Credentials');
  });
  it('uses resolved concrete IDs, refusing aliases and routing modes', () => {
    const catalog = [{ ...agents[0]!, models: [
      { id: 'opus', label: 'Opus', identityKind: 'alias' as const, resolvedId: 'claude-future', reasoning: [{ id: 'high', label: 'High' }] },
      { id: 'auto', label: 'Automatic', identityKind: 'routing-mode' as const },
      { id: 'latest', label: 'Latest' },
    ] }];
    expect(validateRuntimeSelection({ agents: catalog, agentId: 'runtime', modelId: 'claude-future', effort: 'high' })).toBeNull();
    for (const modelId of ['opus', 'auto', 'latest']) expect(validateRuntimeSelection({ agents: catalog, agentId: 'runtime', modelId })).toContain('Available models: claude-future');
    expect(validateRuntimeSelection({ agents: [{ ...catalog[0]!, supportsConcreteModelSelection: false }], agentId: 'runtime', modelId: 'claude-future' })).toContain('cannot pin');
  });
  it('resolves Default before validating model-specific effort', () => {
    const catalog = [{ ...agents[0]!, defaultModelResolution: { status: 'resolved' as const, id: 'small', source: 'cli' as const, resolvedAt: 'now', launchFingerprint: 'test' } }];
    for (const modelId of ['', 'default']) {
      expect(validateRuntimeSelection({ agents: catalog, agentId: 'runtime', modelId, effort: 'ultra' })).toContain('Unknown effort');
    }
    expect(validateRuntimeSelection({ agents, agentId: 'runtime', effort: 'ultra' })).toContain('Default model');
  });
  it('refuses static fallback catalogs even when they contain the requested id', () => {
    expect(validateRuntimeSelection({ agents: [{ ...agents[0]!, modelsSource: 'fallback' }], agentId: 'runtime', modelId: 'small' })).toContain('Live model catalog');
  });
});

function makeDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    bin: 'test-agent',
    versionArgs: [],
    buildArgs: () => [],
    fallbackModels: [],
    streamFormat: 'plain',
    ...overrides,
  } as RuntimeAgentDef;
}

describe('rememberLiveModels / getRememberedLiveModels / isKnownModel', () => {
  it('is a no-op for a non-array models value', () => {
    rememberLiveModels({ agentId: 'agent-x', models: 'not-an-array' as unknown as never });
    expect(getRememberedLiveModels({ agentId: 'agent-x' })).toEqual([]);
  });

  it('remembers a list of live models scoped by agent id', () => {
    rememberLiveModels({ agentId: 'agent-a', models: [{ id: 'm1', label: 'Model 1' }] });
    expect(getRememberedLiveModels({ agentId: 'agent-a' })).toEqual([{ id: 'm1', label: 'm1' }]);
  });

  it('filters out entries without a string id', () => {
    rememberLiveModels({ agentId: 'agent-b', models: [
      { id: 'm1', label: 'Model 1' },
      null as unknown as { id: string; label: string },
      { id: 42 as unknown as string, label: 'bad' },
    ] });
    expect(getRememberedLiveModels({ agentId: 'agent-b' })).toEqual([{ id: 'm1', label: 'm1' }]);
  });

  it('scopes the cache by an optional scope string, trimmed', () => {
    rememberLiveModels({ agentId: 'agent-c', models: [{ id: 'default-scope', label: 'x' }] });
    rememberLiveModels({ agentId: 'agent-c', models: [{ id: 'scoped', label: 'x' }] }, { scope: '  profile-1  ' });
    expect(getRememberedLiveModels({ agentId: 'agent-c' })).toEqual([{ id: 'default-scope', label: 'default-scope' }]);
    expect(getRememberedLiveModels({ agentId: 'agent-c' }, { scope: 'profile-1' })).toEqual([{ id: 'scoped', label: 'scoped' }]);
  });

  it('returns an empty array for an unknown agent/scope', () => {
    expect(getRememberedLiveModels({ agentId: 'never-remembered' })).toEqual([]);
  });

  it('isKnownModel returns false for a nullish modelId', () => {
    const def = makeDef();
    expect(isKnownModel({ def: def, modelId: null })).toBe(false);
    expect(isKnownModel({ def: def, modelId: undefined })).toBe(false);
  });

  it('isKnownModel finds a model from the live cache', () => {
    rememberLiveModels({ agentId: 'agent-live', models: [{ id: 'm1', label: 'x' }] });
    expect(isKnownModel({ def: makeDef({ id: 'agent-live' }), modelId: 'm1' })).toBe(true);
    expect(isKnownModel({ def: makeDef({ id: 'agent-live' }), modelId: 'unknown-id' })).toBe(false);
  });

  it('isKnownModel falls back to fallbackModels when there is no live cache entry', () => {
    const def = makeDef({ id: 'agent-no-live', fallbackModels: [{ id: 'fallback-1', label: 'x' }] });
    expect(isKnownModel({ def: def, modelId: 'fallback-1' })).toBe(true);
    expect(isKnownModel({ def: def, modelId: 'not-in-fallback' })).toBe(false);
  });

  it('isKnownModel returns false when fallbackModels is not an array', () => {
    const def = makeDef({ id: 'agent-bad-fallback', fallbackModels: undefined as unknown as [] });
    expect(isKnownModel({ def: def, modelId: 'anything' })).toBe(false);
  });
});

describe('preferFreshLiveModels', () => {
  it('prefers the fresh list when non-empty', () => {
    const fresh = [{ id: 'fresh', label: 'Fresh' }];
    const remembered = [{ id: 'old', label: 'Old' }];
    expect(preferFreshLiveModels({ freshModels: fresh, rememberedModels: remembered })).toBe(fresh);
  });

  it('falls back to the remembered list when fresh is empty', () => {
    const remembered = [{ id: 'old', label: 'Old' }];
    expect(preferFreshLiveModels({ freshModels: [], rememberedModels: remembered })).toBe(remembered);
  });
});

describe('sanitizeCustomModel', () => {
  it('rejects non-string input', () => {
    expect(sanitizeCustomModel({ id: null })).toBeNull();
    expect(sanitizeCustomModel({ id: undefined })).toBeNull();
    expect(sanitizeCustomModel({ id: 42 as unknown as string })).toBeNull();
  });

  it('rejects an empty or all-whitespace string', () => {
    expect(sanitizeCustomModel({ id: '' })).toBeNull();
    expect(sanitizeCustomModel({ id: '   ' })).toBeNull();
  });

  it('rejects a string over 200 chars', () => {
    expect(sanitizeCustomModel({ id: 'a'.repeat(201) })).toBeNull();
  });

  it('rejects a string that does not start with an alphanumeric', () => {
    expect(sanitizeCustomModel({ id: '-leading-dash' })).toBeNull();
    expect(sanitizeCustomModel({ id: '.leading-dot' })).toBeNull();
  });

  it('rejects a string containing disallowed characters', () => {
    expect(sanitizeCustomModel({ id: 'model with spaces' })).toBeNull();
    expect(sanitizeCustomModel({ id: 'model;rm -rf' })).toBeNull();
  });

  it('accepts a well-formed model id and trims surrounding whitespace', () => {
    expect(sanitizeCustomModel({ id: '  gpt-5/mini_v2.1:latest@east  ' })).toBe('gpt-5/mini_v2.1:latest@east');
  });
});

describe('resolveModelForAgent', () => {
  it('returns the resolved model unchanged when it is a non-default string', () => {
    const def = makeDef();
    expect(resolveModelForAgent({ def: def, resolved: 'explicit-model' })).toBe('explicit-model');
  });

  it('honors defaultModelEnvVar when resolved is null and the env var is set', () => {
    const def = makeDef({ defaultModelEnvVar: 'MY_DEFAULT_MODEL' });
    expect(resolveModelForAgent({ def: def, resolved: null }, { env: { MY_DEFAULT_MODEL: 'env-model' } })).toBe('env-model');
  });

  it('ignores an empty/whitespace-only defaultModelEnvVar value', () => {
    const def = makeDef({ defaultModelEnvVar: 'MY_DEFAULT_MODEL', fallbackModels: [{ id: 'fb-1', label: 'x' }] });
    expect(resolveModelForAgent({ def: def, resolved: null }, { env: { MY_DEFAULT_MODEL: '   ' } })).toBe('fb-1');
  });

  it('returns resolved unchanged when fallbackModels declares the synthetic "default" option', () => {
    const def = makeDef({ fallbackModels: [DEFAULT_MODEL_OPTION, { id: 'fb-1', label: 'x' }] });
    expect(resolveModelForAgent({ def: def, resolved: 'default' }, { env: {} })).toBe('default');
    expect(resolveModelForAgent({ def: def, resolved: null }, { env: {} })).toBe(null);
  });

  it('prefers the first remembered live model when fallbackModels omits "default"', () => {
    rememberLiveModels({ agentId: 'agent-omits-default', models: [{ id: 'live-1', label: 'x' }] });
    const def = makeDef({ id: 'agent-omits-default', fallbackModels: [{ id: 'fb-1', label: 'x' }] });
    expect(resolveModelForAgent({ def: def, resolved: null }, { env: {} })).toBe('live-1');
  });

  it('falls back to the first fallback model id when there is no live list', () => {
    const def = makeDef({ id: 'agent-no-live-no-default', fallbackModels: [{ id: 'fb-1', label: 'x' }, { id: 'fb-2', label: 'y' }] });
    expect(resolveModelForAgent({ def: def, resolved: null }, { env: {} })).toBe('fb-1');
  });

  it('returns resolved unchanged when fallbackModels is empty and there is no live list', () => {
    const def = makeDef({ id: 'agent-empty-fallback', fallbackModels: [] });
    expect(resolveModelForAgent({ def: def, resolved: null }, { env: {} })).toBe(null);
  });

  it('is scoped by liveModelScope', () => {
    rememberLiveModels({ agentId: 'agent-scoped-resolve', models: [{ id: 'scoped-live', label: 'x' }] }, { scope: 'scope-1' });
    const def = makeDef({ id: 'agent-scoped-resolve', fallbackModels: [{ id: 'fb-1', label: 'x' }] });
    expect(resolveModelForAgent({ def: def, resolved: null }, { env: {}, liveModelScope: 'scope-1' })).toBe('scoped-live');
    expect(resolveModelForAgent({ def: def, resolved: null }, { env: {}, liveModelScope: 'other-scope' })).toBe('fb-1');
  });

  it('defaults env to process.env when omitted', () => {
    const def = makeDef({ defaultModelEnvVar: '__AGENT_RUNTIME_TEST_ENV_VAR__' });
    process.env.__AGENT_RUNTIME_TEST_ENV_VAR__ = 'from-process-env';
    try {
      expect(resolveModelForAgent({ def: def, resolved: null })).toBe('from-process-env');
    } finally {
      delete process.env.__AGENT_RUNTIME_TEST_ENV_VAR__;
    }
  });
});
