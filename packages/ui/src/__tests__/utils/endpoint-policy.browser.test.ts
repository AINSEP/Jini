import { describe, expect, it, vi } from 'vitest';
import { isBlockedExternalApiHostname, isLoopbackApiHost } from '@jini-ai/platform/net/endpoint-policy';
import { isAllowedEndpointUrl, isBlockedEndpointHost, isLoopbackEndpointHost } from '../../utils/endpoint-policy.js';

// Browser settings must load without evaluating Node IP or DNS adapters,
// including in development where a bundler cannot hide them by tree shaking.
vi.mock('node:net', () => { throw new Error('Node IP adapter reached from browser policy'); });
vi.mock('node:dns', () => { throw new Error('Node DNS adapter reached from browser policy'); });
vi.mock('node:dns/promises', () => { throw new Error('Node DNS adapter reached from browser policy'); });

describe('browser endpoint policy ownership', () => {
  it('preserves UI exports as aliases of the browser-safe owner', () => {
    expect(isLoopbackEndpointHost).toBe(isLoopbackApiHost);
    expect(isBlockedEndpointHost).toBe(isBlockedExternalApiHostname);
  });

  it('allows local models and public hosts while refusing credential-bearing private destinations', () => {
    expect(isAllowedEndpointUrl({ raw: 'http://localhost:11434/v1' })).toBe(true);
    expect(isAllowedEndpointUrl({ raw: 'https://example.com/v1' })).toBe(true);
    expect(isAllowedEndpointUrl({ raw: 'http://169.254.169.254/latest/meta-data/' })).toBe(false);
    expect(isAllowedEndpointUrl({ raw: 'http://[::ffff:a00:1]/v1' })).toBe(false);
  });
});
