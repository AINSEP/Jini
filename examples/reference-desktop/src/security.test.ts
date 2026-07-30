import { describe, expect, it, vi } from 'vitest';

import {
  grantNativeWorkingDirectory,
  isTrustedRendererFrame,
  normalizeSampleWorkingDirectory,
  resolveDesktopWorkingDirectory,
  resolveTrustedRendererUrl,
} from './security.js';

describe('reference desktop security helpers', () => {
  it('allows only the fixed loopback renderer origins', () => {
    expect(resolveTrustedRendererUrl(
      'http://127.0.0.1:4173/?shell=desktop',
    ).origin).toBe('http://127.0.0.1:4173');
    expect(() => resolveTrustedRendererUrl('https://evil.example/')).toThrow('trusted local');
    expect(() => resolveTrustedRendererUrl('http://127.0.0.1:9999/')).toThrow('trusted local');
  });
  it('accepts only the trusted origin in the top-level frame', () => {
    const trustedOrigin = 'http://127.0.0.1:4173';
    expect(isTrustedRendererFrame({
      origin: trustedOrigin,
      url: `${trustedOrigin}/?shell=desktop`,
      parent: null,
    }, trustedOrigin)).toBe(true);
    expect(isTrustedRendererFrame({
      origin: trustedOrigin,
      url: `${trustedOrigin}/`,
      parent: {},
    }, trustedOrigin)).toBe(false);
    expect(isTrustedRendererFrame({
      origin: 'https://evil.example',
      url: 'https://evil.example/',
      parent: null,
    }, trustedOrigin)).toBe(false);
    expect(isTrustedRendererFrame(null, trustedOrigin)).toBe(false);
  });

  it('resolves relative paths and normalizes only declared sample paths', () => {
    expect(resolveDesktopWorkingDirectory('/repo', 'examples/sample-projects/demo'))
      .toBe('/repo/examples/sample-projects/demo');
    expect(normalizeSampleWorkingDirectory(
      '/repo',
      'examples/sample-projects/starter-site',
    )).toBe('/repo/examples/sample-projects/starter-site');
    expect(normalizeSampleWorkingDirectory('/repo', '../secret')).toBeNull();
    expect(normalizeSampleWorkingDirectory('/repo', '/absolute')).toBeNull();
  });

  it('keeps the secret in main and validates the grant response', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ directory: '/canonical/work' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ));
    await expect(grantNativeWorkingDirectory({
      daemonUrl: 'http://127.0.0.1:4317',
      secret: 'main-only-secret',
      directory: '/selected/work',
      fetchImpl,
    })).resolves.toBe('/canonical/work');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/playground/working-directory-grants',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-jini-grant-secret': 'main-only-secret',
        }),
      }),
    );
    await expect(grantNativeWorkingDirectory({
      daemonUrl: 'http://127.0.0.1:4317',
      secret: undefined,
      directory: '/selected/work',
      fetchImpl,
    })).rejects.toThrow('unavailable');
  });
});
