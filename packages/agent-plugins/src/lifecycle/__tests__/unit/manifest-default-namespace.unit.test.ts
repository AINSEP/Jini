import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseAgentPluginManifest } from '../../manifest.js';
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
    expect(parseAgentPluginManifest({ value })).toMatchObject({ ok: true, manifest: legacy });
    expect(validatePluginManifest({ value })).toBe(true);
  });

  test('legacy fallback identity is still validated', () => {
    const value = { ...base, extensions: { tovu: { id: 'invalid identity' } } };
    expect(parseAgentPluginManifest({ value }).ok).toBe(false);
    expect(validatePluginManifest({ value })).toBe(false);
  });

  test('an explicit host namespace reads only its own key, including an explicit jini host', () => {
    const value = { ...base, extensions: { tovu: legacy } };
    for (const identityNamespace of ['jini', 'another-host']) {
      expect(parseAgentPluginManifest({ value }, { identityNamespace })).toMatchObject({ ok: true, manifest: { id: 'unknown/stock', provides: [] } });
    }
  });

  test.each(['charts-recharts', 'charts-echarts'])('%s keeps both shipped legacy manifest formats readable', (pluginId) => {
    const agentManifest: unknown = JSON.parse(readFileSync(new URL(`../../../../${pluginId}/plugin.json`, import.meta.url), 'utf8'));
    expect(parseAgentPluginManifest({ value: agentManifest })).toMatchObject({ ok: true, manifest: { id: `jini/${pluginId}-agent`, provides: ['chart'] } });
    const providerManifest: unknown = JSON.parse(readFileSync(new URL(`../../../../../provider-plugins/src/${pluginId}/jini.plugin.json`, import.meta.url), 'utf8'));
    expect(validatePluginManifest({ value: providerManifest })).toBe(true);
  });
});
