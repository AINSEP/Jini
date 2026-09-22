import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadAnthropicLiveModels,
  mergeLiveModels,
  resetAnthropicLiveModelCacheForTesting,
  resolveAnthropicCredential,
} from '../anthropic-live-models.js';
import { setClaudeCodeModelIoForTesting } from '../claude-code-models.js';
import { claudeAgentDef } from '../defs/claude.js';
import type { RuntimeModelOption } from '../types.js';

const FALLBACK: RuntimeModelOption[] = [
  { id: 'default', label: 'Default (CLI config)' },
  { id: 'fable', label: 'Fable (alias)' },
  { id: 'claude-opus-5', label: 'claude-opus-5' },
];

/** The `/v1/models` envelope, trimmed to the two fields `extractAnthropicModels` reads. */
function anthropicCatalog(...ids: string[]): Response {
  return new Response(
    JSON.stringify({ data: ids.map((id) => ({ id, display_name: id.toUpperCase(), type: 'model' })) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ) as unknown as Response;
}

describe('resolveAnthropicCredential', () => {
  it('reads ANTHROPIC_API_KEY and defaults the base URL', () => {
    expect(resolveAnthropicCredential({ ANTHROPIC_API_KEY: 'sk-test' })).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.com',
    });
  });

  it('honours an explicit ANTHROPIC_BASE_URL', () => {
    expect(resolveAnthropicCredential({ ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: 'https://proxy.example.com' })).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://proxy.example.com',
    });
  });

  it('returns null for an absent or whitespace-only key', () => {
    expect(resolveAnthropicCredential({})).toBeNull();
    expect(resolveAnthropicCredential({ ANTHROPIC_API_KEY: '   ' })).toBeNull();
  });

  // ANTHROPIC_AUTH_TOKEN is a bearer credential; `listProviderModels`' anthropic protocol sends
  // `x-api-key`. Accepting it here would 401 on every detection pass and read as a bad key.
  it('does not accept ANTHROPIC_AUTH_TOKEN as an x-api-key credential', () => {
    expect(resolveAnthropicCredential({ ANTHROPIC_AUTH_TOKEN: 'bearer-token' })).toBeNull();
  });
});

describe('mergeLiveModels', () => {
  it('keeps the whole fallback list, in order, and appends only new live ids', () => {
    const merged = mergeLiveModels(FALLBACK, [
      { id: 'claude-opus-5', label: 'CLAUDE-OPUS-5' },
      { id: 'claude-fable-6', label: 'Fable 6' },
    ]);
    expect(merged.map((m) => m.id)).toEqual(['default', 'fable', 'claude-opus-5', 'claude-fable-6']);
    // The fallback's own label wins for an id present in both — the alias rows read as aliases.
    expect(merged.find((m) => m.id === 'claude-opus-5')?.label).toBe('claude-opus-5');
  });

  it('de-duplicates repeats within the live list itself', () => {
    const merged = mergeLiveModels([], [{ id: 'a', label: 'A' }, { id: 'a', label: 'A again' }]);
    expect(merged.map((m) => m.id)).toEqual(['a']);
  });
});

describe('loadAnthropicLiveModels', () => {
  beforeEach(() => {
    resetAnthropicLiveModelCacheForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAnthropicLiveModelCacheForTesting();
  });

  // The "never a gate" invariant, asserted by construction rather than by timing: a `fetch` that
  // throws on ANY call means a passing test proves zero network calls were made, not merely that
  // they were fast.
  it('makes no network call at all when no credential is resolvable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('no network call should have been attempted');
    });
    await expect(loadAnthropicLiveModels({}, FALLBACK)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('merges the account catalog on top of the fallback list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropicCatalog('claude-opus-5', 'claude-fable-5-1'));

    const result = await loadAnthropicLiveModels({ ANTHROPIC_API_KEY: 'sk-a' }, FALLBACK);

    // The exact list, not "contains claude-fable-5-1": a result that REPLACED the fallback would
    // still satisfy a containment assertion while silently dropping the CLI aliases the Local-CLI
    // path depends on.
    expect(result?.map((m) => m.id)).toEqual(['default', 'fable', 'claude-opus-5', 'claude-fable-5-1']);
  });

  it('returns null when the live call fails, so the caller keeps its static list', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"bad key"}}', { status: 401 }) as unknown as Response,
    );

    await expect(loadAnthropicLiveModels({ ANTHROPIC_API_KEY: 'sk-bad' }, FALLBACK)).resolves.toBeNull();
  });

  it('returns null for a 200 that carries no models', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropicCatalog());
    await expect(loadAnthropicLiveModels({ ANTHROPIC_API_KEY: 'sk-a' }, FALLBACK)).resolves.toBeNull();
  });

  it('issues one request for repeated probes inside the TTL window', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => anthropicCatalog('claude-fable-5-1'));

    const env = { ANTHROPIC_API_KEY: 'sk-a' };
    await loadAnthropicLiveModels(env, FALLBACK, () => 1_000);
    await loadAnthropicLiveModels(env, FALLBACK, () => 2_000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-issues the request once the TTL has elapsed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => anthropicCatalog('claude-fable-5-1'));

    const env = { ANTHROPIC_API_KEY: 'sk-a' };
    await loadAnthropicLiveModels(env, FALLBACK, () => 1_000);
    const refreshed = await loadAnthropicLiveModels(env, FALLBACK, () => 1_000 + 5 * 60_000 + 1);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // The re-issued call really answered — not a second request whose body was already consumed.
    expect(refreshed?.map((m) => m.id)).toContain('claude-fable-5-1');
  });

  // Two accounts must not share a cache slot: keying on baseUrl alone would serve the first key's
  // catalog to the second.
  it('caches per credential, not per endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => anthropicCatalog('claude-fable-5-1'));

    await loadAnthropicLiveModels({ ANTHROPIC_API_KEY: 'sk-a' }, FALLBACK, () => 1_000);
    const second = await loadAnthropicLiveModels({ ANTHROPIC_API_KEY: 'sk-b' }, FALLBACK, () => 1_000);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(second?.map((m) => m.id)).toContain('claude-fable-5-1');
  });
});

describe("claudeAgentDef.fetchModels — the def's own resolution order", () => {
  beforeEach(() => {
    resetAnthropicLiveModelCacheForTesting();
    // The credential-free CLI step finds nothing here, so these cases pin the BYOK path exactly as
    // it behaved before that step existed — and no real `claude` is ever spawned by this suite.
    setClaudeCodeModelIoForTesting({ runInitialize: async () => null, readConfigFile: async () => null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAnthropicLiveModelCacheForTesting();
    setClaudeCodeModelIoForTesting(null);
  });

  it('reaches live discovery when no mmd routes file resolves, and merges into the static list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropicCatalog('claude-fable-6-hypothetical'));

    const result = await claudeAgentDef.fetchModels!('claude', {
      HOME: '/nonexistent-home-for-this-test',
      ANTHROPIC_API_KEY: 'sk-a',
    });

    expect(result?.map((m) => m.id)).toContain('claude-fable-6-hypothetical');
    // Everything the static list offered is still offered.
    for (const model of claudeAgentDef.fallbackModels) {
      expect(result?.some((m) => m.id === model.id)).toBe(true);
    }
  });

  it('makes no network call when the agent environment carries no key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('no network call should have been attempted');
    });

    await claudeAgentDef.fetchModels!('claude', { HOME: '/nonexistent-home-for-this-test' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
