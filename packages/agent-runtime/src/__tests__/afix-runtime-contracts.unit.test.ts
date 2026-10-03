import { describe, expect, it, vi } from 'vitest';
import { spawnEnvForAgent } from '../env.js';
import { modelCatalogCacheKey } from '../model-registry.js';
import { validateBaseUrlResolved } from '../providers/connection-guard.js';

describe('runtime contradiction regressions', () => {
  it.each(['opencode', 'mimo'])('runs %s housekeeping before host customization, then sandbox constraints', (agentId) => {
    const prefix = agentId === 'mimo' ? 'MIMOCODE' : 'OPENCODE';
    const identityKey = `${prefix}_PID`;
    const discoveryKey = `${prefix}_DISABLE_PROJECT_CONFIG`;
    const stages: string[] = [];
    const env = spawnEnvForAgent({ agentId, baseEnv: { [identityKey]: 'inherited' } }, {
      systemProxyEnv: {},
      hooks: {
        perAgentEnv: ({ env: liveEnv }) => {
          stages.push('host');
          expect(liveEnv[identityKey]).toBeUndefined();
          expect(liveEnv[discoveryKey]).toBe('true');
          return { [discoveryKey]: 'false', HOST_MARKER: 'customized' };
        },
        sandboxOverlay: ({ env: liveEnv }) => {
          stages.push('sandbox');
          expect(liveEnv[discoveryKey]).toBe('false');
          expect(liveEnv.HOST_MARKER).toBe('customized');
          return { ...liveEnv, [discoveryKey]: 'true' };
        },
      },
    });
    expect(stages).toEqual(['host', 'sandbox']);
    expect(env[discoveryKey]).toBe('true');
    expect(env[identityKey]).toBeUndefined();
  });

  const cacheArgs = { providerId: 'provider', baseUrl: 'https://api.example/v1/', credential: 'secret' };

  it.each([null, 7, true, [], {}, new String('version'), { trim: () => 'version' }].map(variant => ({ variant })))(
    'rejects non-string catalogue variants with a stable TypeError: %j', ({ variant }) => {
      expect(() => modelCatalogCacheKey(cacheArgs, { variant })).toThrow(TypeError);
      expect(() => modelCatalogCacheKey(cacheArgs, { variant })).toThrow('Model catalog variant must be a string');
    },
  );

  it('preserves absent variants and trimmed string cache keys', () => {
    const key = modelCatalogCacheKey(cacheArgs);
    expect(modelCatalogCacheKey(cacheArgs, { variant: undefined })).toBe(key);
    expect(modelCatalogCacheKey(cacheArgs, { variant: '' })).toBe(key);
    expect(modelCatalogCacheKey(cacheArgs, { variant: ' v2 ' })).toBe(`${key}v2`);
  });

  it('does not call a user-supplied trim method on an invalid variant', () => {
    const trim = vi.fn(() => 'version');
    expect(() => modelCatalogCacheKey(cacheArgs, { variant: { trim } })).toThrow(TypeError);
    expect(trim).not.toHaveBeenCalled();
  });

  it('fails closed when the injected DNS resolver throws', async () => {
    const lookup = vi.fn(async () => { throw new Error('ENOTFOUND'); });
    expect(await validateBaseUrlResolved({ baseUrl: 'https://api.example/v1', lookup }))
      .toEqual({ error: 'DNS lookup failed', forbidden: true });
    expect(lookup).toHaveBeenCalledWith({ hostname: 'api.example' });
  });

  it('fails closed when DNS resolves without any address', async () => {
    const lookup = vi.fn(async () => []);
    expect(await validateBaseUrlResolved({ baseUrl: 'https://api.example/v1', lookup }))
      .toEqual({ error: 'DNS lookup returned no addresses', forbidden: true });
  });

  it('fails closed at runtime when a nonliteral URL has no resolver', async () => {
    // JavaScript callers can violate the required resolver type; that must not bypass validation.
    const input = { baseUrl: 'https://api.example/v1' } as Parameters<typeof validateBaseUrlResolved>[0];
    expect(await validateBaseUrlResolved(input)).toEqual({ error: 'DNS lookup failed', forbidden: true });
  });

  it('pins successful DNS results and keeps literal-host bypasses explicit', async () => {
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
    const resolved = await validateBaseUrlResolved({ baseUrl: 'https://api.example/v1', lookup });
    expect(resolved.error).toBeUndefined();
    expect(resolved.pinnedAddress).toEqual({ address: '8.8.8.8', family: 4 });
    lookup.mockClear();
    const literal = await validateBaseUrlResolved({ baseUrl: 'http://127.0.0.1:11434', lookup });
    expect(literal.error).toBeUndefined();
    expect(literal.pinnedAddress).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});
