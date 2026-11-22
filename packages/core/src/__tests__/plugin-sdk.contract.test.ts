import { describe, expect, it } from 'vitest';
import { hasProviderAuthHeader, PluginProviderStartupError, pluginProviderStartupGuidance } from '../contracts/plugin-sdk.js';

describe('pluginProviderStartupGuidance', () => {
  it('returns guidance from the local error and from a separately bundled Error class', () => {
    const cause = new Error('underlying SDK detail');
    const local = new PluginProviderStartupError({ reason: 'missing key', action: 'configure a credential', cause });
    expect(local.cause).toBe(cause);
    expect(pluginProviderStartupGuidance({ error: local })).toEqual({ reason: 'missing key', action: 'configure a credential' });
    const bundled = Object.assign(new Error('missing permission'), { name: 'PluginProviderStartupError', reason: 'missing permission', action: 'grant access' });
    expect(pluginProviderStartupGuidance({ error: bundled })).toEqual({ reason: 'missing permission', action: 'grant access' });
  });

  it.each([
    null, 'raw SDK detail', new Error('SDK detail'),
    { name: 'PluginProviderStartupError', reason: 'fake', action: 'fake' },
    Object.assign(new Error('detail'), { name: 'PluginProviderStartupError', reason: 1, action: 'configure' }),
    Object.assign(new Error('detail'), { name: 'PluginProviderStartupError', reason: 'configure', action: null }),
  ])('does not surface raw errors or malformed guidance: %j', error => {
    expect(pluginProviderStartupGuidance({ error })).toBeUndefined();
  });
});

describe('hasProviderAuthHeader', () => {
  const names = ['Authorization', 'X-Api-Key'];
  it('accepts a declared header with a nonblank value, case-insensitively', () => {
    expect(hasProviderAuthHeader({ text: 'authorization=Bearer abc', names })).toBe(true);
    expect(hasProviderAuthHeader({ text: 'X-Trace=1, x-api-key = k', names })).toBe(true);
  });
  it('refuses blank values, undeclared names and malformed pairs', () => {
    expect(hasProviderAuthHeader({ text: 'Authorization=', names })).toBe(false);
    expect(hasProviderAuthHeader({ text: 'X-Other=1', names })).toBe(false);
    expect(hasProviderAuthHeader({ text: 'Authorization=ok, garbage', names })).toBe(false);
    expect(hasProviderAuthHeader({ text: '=value', names })).toBe(false);
  });
});
