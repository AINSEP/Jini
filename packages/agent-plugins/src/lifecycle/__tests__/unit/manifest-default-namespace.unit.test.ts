const fixtureLegacyIdentity = { namespace: "tovu", warning: 'Legacy extensions.tovu agent-plugin metadata is deprecated; compatibility is retained through at least 2027-05-06. Portable packages use extensions.jini and unprefixed MCP metadata.' };
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseAgentPluginManifest } from '../../manifest.js';
import { readAgentPluginMetadata, readAgentPluginPortableExtension, readAgentPluginCompatibilityWarnings } from '../../manifest.js';
import { resolveAgentPluginLifecycleNamespace } from '../../../core/identity-namespace.js';
import { validatePluginManifest } from '../../../manifest.js';

const base = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'stock' };
const legacy = { id: 'publisher/legacy-stock', provides: ['legacy-data'], requires: ['account'], hostRange: '^1.0.0' };
const neutral = { id: 'publisher/stock', provides: ['stock-data'], requires: ['quotes'], hostRange: '^2.0.0' };

describe('portable plugin identity without a host namespace', () => {
  test('a host-neutral caller reads jini identity and compatibility metadata before legacy metadata', () => {
    const value = { ...base, extensions: { jini: neutral, tovu: legacy } };
    expect(parseAgentPluginManifest({ value })).toMatchObject({ ok: true, manifest: neutral });
    expect(validatePluginManifest({ value })).toBe(true);
  });

  test('an invalid jini identity is refused even when the legacy identity is valid', () => {
    const value = { ...base, extensions: { jini: { id: 'invalid identity' }, tovu: legacy } };
    expect(parseAgentPluginManifest({ value }).ok).toBe(false);
    expect(validatePluginManifest({ value })).toBe(false);
  });

  test('a malformed jini extension is refused rather than replaced with legacy metadata', () => {
    const value = { ...base, extensions: { jini: null, tovu: legacy } };
    expect(parseAgentPluginManifest({ value }).ok).toBe(false);
    expect(validatePluginManifest({ value })).toBe(false);
  });

  test('a present empty jini extension does not inherit legacy identity or capabilities', () => {
    const value = { ...base, extensions: { jini: {}, tovu: legacy } };
    expect(parseAgentPluginManifest({ value })).toMatchObject({ ok: true, manifest: { id: 'unknown/stock', provides: [] } });
  });

  test('existing plugins retain their legacy identity and compatibility metadata when jini is absent', () => {
    const value = { ...base, extensions: { tovu: legacy } };
    expect(parseAgentPluginManifest({ value }, { legacyIdentity: fixtureLegacyIdentity })).toMatchObject({ ok: true, manifest: legacy });
    expect(validatePluginManifest({ value }, { legacyIdentity: fixtureLegacyIdentity })).toBe(true);
  });

  test('legacy fallback identity is still validated', () => {
    const value = { ...base, extensions: { tovu: { id: 'invalid identity' } } };
    expect(parseAgentPluginManifest({ value }, { legacyIdentity: fixtureLegacyIdentity }).ok).toBe(false);
    expect(validatePluginManifest({ value }, { legacyIdentity: fixtureLegacyIdentity })).toBe(false);
  });

  test('an explicit host namespace reads only its own key, including an explicit jini host', () => {
    const value = { ...base, extensions: { tovu: legacy } };
    for (const identityNamespace of ['jini', 'another-host']) {
      expect(parseAgentPluginManifest({ value }, { identityNamespace })).toMatchObject({ ok: true, manifest: { id: 'unknown/stock', provides: [] } });
    }
  });

  test.each(['charts-recharts', 'charts-echarts'])('%s keeps both shipped legacy manifest formats readable', (pluginId) => {
    const agentManifest: unknown = JSON.parse(readFileSync(new URL(`../../../../${pluginId}/plugin.json`, import.meta.url), 'utf8'));
    expect(parseAgentPluginManifest({ value: agentManifest }, { legacyIdentity: fixtureLegacyIdentity })).toMatchObject({ ok: true, manifest: { id: `jini/${pluginId}-agent`, provides: ['chart'] } });
    const providerManifest: unknown = JSON.parse(readFileSync(new URL(`../../../../../provider-plugins/src/${pluginId}/jini.plugin.json`, import.meta.url), 'utf8'));
    expect(validatePluginManifest({ value: providerManifest })).toBe(true);
  });
});

test('the same installed document is legacy metadata only for its bound host', () => {
  const value = { ...base, extensions: { alpha: { id: 'publisher/alpha', summary: 'Alpha' }, beta: { id: 'publisher/beta', summary: 'Beta' } } };
  const hostA = { legacyIdentity: { namespace: 'alpha', warning: 'Alpha legacy' } };
  const hostB = { legacyIdentity: { namespace: 'beta', warning: 'Beta legacy' } };
  expect(readAgentPluginMetadata({ value })).toEqual({ metadata: {}, warnings: [] });
  expect(parseAgentPluginManifest({ value }, hostA)).toMatchObject({ ok: true, manifest: { id: 'publisher/alpha', summary: 'Alpha' }, warnings: ['Alpha legacy'] });
  expect(parseAgentPluginManifest({ value }, hostB)).toMatchObject({ ok: true, manifest: { id: 'publisher/beta', summary: 'Beta' }, warnings: ['Beta legacy'] });
  expect(readAgentPluginCompatibilityWarnings({ value }, { legacyIdentity: { namespace: 'absent', warning: 'Absent' } })).toEqual([]);
  const inherited = { ...base, extensions: Object.create({ alpha: { id: 'publisher/alpha' } }) };
  expect(readAgentPluginPortableExtension({ value: inherited }, hostA)).toBeUndefined();
  const inheritedCanonical = { ...base, extensions: Object.assign(Object.create({ jini: null }), { alpha: { id: 'publisher/alpha' } }) };
  expect(parseAgentPluginManifest({ value: inheritedCanonical }, hostA)).toMatchObject({ ok: true, manifest: { id: 'publisher/alpha' } });
});

test('an own canonical key wins even when null or invalid', () => {
  for (const canonical of [null, { id: 'invalid identity' }]) {
    const value = { ...base, extensions: { jini: canonical, alpha: { id: 'publisher/alpha' } } };
    const options = { legacyIdentity: { namespace: 'alpha', warning: 'Alpha legacy' } };
    expect(parseAgentPluginManifest({ value }, options).ok).toBe(false);
    expect(parseAgentPluginManifest({ value }, { ...options, identityNamespace: 'alpha' }).ok).toBe(false);
    expect(readAgentPluginCompatibilityWarnings({ value }, options)).toEqual([]);
  }
});

test('an explicit custom namespace keeps its existing isolation', () => {
  const options = { legacyIdentity: { namespace: 'alpha', warning: 'Alpha legacy' } };
  const value = { ...base, extensions: { alpha: { id: 'publisher/alpha' }, custom: { id: 'publisher/custom' } } };
  expect(parseAgentPluginManifest({ value }, { ...options, identityNamespace: 'custom' })).toMatchObject({ ok: true, manifest: { id: 'publisher/custom' }, warnings: [] });
  expect(resolveAgentPluginLifecycleNamespace({ value: { ...base, extensions: { alpha: { id: 'publisher/alpha' } } }, extensionNamespace: 'custom' }, options)).toBe('alpha');
  expect(resolveAgentPluginLifecycleNamespace({ value, extensionNamespace: 'custom' }, options)).toBe('custom');
});

test('a malformed legacy extension cannot usurp an explicitly chosen lifecycle scope', () => {
  const options = { legacyIdentity: { namespace: 'former-host', warning: 'Legacy extension' } };
  const value = { ...base, extensions: { 'former-host': ['not an identity'], irrelevant: { id: 'different/package' } } };
  expect(resolveAgentPluginLifecycleNamespace({ value, extensionNamespace: 'custom' }, options)).toBe('custom');
  expect(resolveAgentPluginLifecycleNamespace({ value, extensionNamespace: 'custom' })).toBe('custom');
  expect(readAgentPluginPortableExtension({ value }, { ...options, identityNamespace: 'former-host' })).toBeUndefined();
});
