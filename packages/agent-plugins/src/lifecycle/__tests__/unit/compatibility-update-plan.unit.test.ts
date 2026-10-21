import { describe, expect, test } from 'vitest';
import { parseAgentPluginManifest } from '../../manifest.js';
import { AGENT_PLUGIN_CONTRACT_VERSION, checkAgentPluginCompatibility, describeAgentPluginCompatibility, agentPluginDependentWarnings, AgentPluginHostIncompatibleError } from '../../compatibility.js';
import { planAgentPluginUpdate } from '../../update-plan.js';
import type { InstalledAgentPlugin } from '../../types.js';

const manifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'sample' };
const revision = { pluginId: 'sample', version: '1.0.0', archiveDigest: 'a'.repeat(64) };
const candidate = { ...revision, version: '2.0.0', archiveDigest: 'b'.repeat(64) };
const installed = (id: string, provides: string[] = [], requires: string[] = []): InstalledAgentPlugin => ({
  pluginId: id, provides, requires, archiveDigest: id, packageRoot: '/fixture', files: [], skills: [],
});
const activations = { schemaVersion: 1 as const, plugins: { off: { enabled: false, origin: 'operator-installed' as const, updatedAt: '', updatedBy: '' } } };

describe('compatibility contract', () => {
  test.each(['*', '1', '1.x', '^1.0.0', '~1.0.0', '>=1', '>=1 <2', '1.0.0 - 2.0.0', '>=2 || 1.0.0', '1.0.0'])('uses full semver range %s', hostRange => {
    expect(checkAgentPluginCompatibility({ manifest: { hostRange }, hostVersion: AGENT_PLUGIN_CONTRACT_VERSION, activeProvides: [] })).toEqual({ hostOk: true, missingRequires: [] });
  });
  test.each(['>=99', '', 'wat', '>=1.1.0-beta.1'])('refuses unsatisfied or malformed range %s', hostRange => {
    expect(checkAgentPluginCompatibility({ manifest: { hostRange }, hostVersion: '1.0.0', activeProvides: [] }).hostOk).toBe(false);
  });
  test('deduplicates advisory requirements and accepts an absent range', () => {
    expect(checkAgentPluginCompatibility({ manifest: { requires: ['a', 'b', 'a'] }, hostVersion: '1.0.0', activeProvides: ['b'] })).toEqual({ hostOk: true, missingRequires: ['a'] });
  });
  test('normalizes only the selected host namespace and warns for malformed metadata', () => {
    const parsed = parseAgentPluginManifest({ value: { ...manifest, extensions: { other: { hostRange: '>=99' }, host: { hostRange: '^1', requires: ['a', 'a'] } } } }, { identityNamespace: 'host' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('manifest rejected');
    expect(parsed.manifest.hostRange).toBe('^1'); expect(parsed.manifest.requires).toEqual(['a']);
    for (const hostRange of [42, null, '', 'wat']) {
      const invalid = parseAgentPluginManifest({ value: { ...manifest, extensions: { host: { hostRange, requires: [null] } } } }, { identityNamespace: 'host' });
      expect(invalid.ok).toBe(true);
      if (!invalid.ok) throw new Error('invalid metadata must stay listable');
      expect(invalid.warnings.join(' ')).toContain('requires');
      expect(invalid.warnings.join(' ')).toContain('hostRange');
      expect(checkAgentPluginCompatibility({ manifest: invalid.manifest, hostVersion: '1.0.0', activeProvides: [] }).hostOk).toBe(false);
    }
    expect(parseAgentPluginManifest({ value: manifest }).ok).toBe(true);
  });
  test('excludes disabled and self providers; other providers can satisfy dependents', () => {
    const self = installed('self', ['a'], ['a', 'b', 'c']);
    const on = installed('on', ['b']); const off = installed('off', ['c']);
    expect(describeAgentPluginCompatibility({ plugin: self, installed: [self, on, off], activations })).toEqual({ origin: 'operator-installed', hostOk: true, missingRequires: ['a', 'c'] });
    const dependent = installed('dependent', [], ['a']);
    expect(agentPluginDependentWarnings({ plugin: self, installed: [self, dependent, off], activations, nextProvides: [] })).toEqual(['dependent needs a']);
    expect(agentPluginDependentWarnings({ plugin: self, installed: [self, dependent, installed('other', ['a'])], activations, nextProvides: [] })).toEqual([]);
    expect(agentPluginDependentWarnings({ plugin: self, installed: [self, installed('off', [], ['a'])], activations, nextProvides: [] })).toEqual([]);
    expect(agentPluginDependentWarnings({ plugin: self, installed: [self, dependent], activations, nextProvides: ['a'] })).toEqual([]);
    expect(new AgentPluginHostIncompatibleError({ pluginId: 'self' }).code).toBe('PLUGIN_HOST_INCOMPATIBLE');
  });
});

test('update planning distinguishes bytes, semver, prereleases, and explicit replacements', () => {
  expect(planAgentPluginUpdate({ installed: { ...revision, enabled: true }, candidate })).toEqual({ action: 'update', enabled: true, warnings: [] });
  expect(planAgentPluginUpdate({ installed: revision, candidate: revision }).action).toBe('none');
  expect(planAgentPluginUpdate({ installed: candidate, candidate: revision }).action).toBe('downgrade-refused');
  expect(planAgentPluginUpdate({ installed: revision, candidate: { ...candidate, pluginId: 'different' } }).action).toBe('id-mismatch');
  expect(planAgentPluginUpdate({ installed: revision, candidate: { ...candidate, version: '1.0.0-beta.1' } }).action).toBe('downgrade-refused');
  expect(planAgentPluginUpdate({ installed: { ...revision, version: '1.0.0-beta.1' }, candidate: { ...candidate, version: '1.0.0' } }).action).toBe('update');
  expect(planAgentPluginUpdate({ installed: revision, candidate: { ...candidate, version: '1.0.0+build' } }).warnings).toEqual(['Same version with different bytes; explicit replacement required.']);
  for (const version of [undefined, 'invalid']) {
    expect(planAgentPluginUpdate({ installed: { ...revision, version }, candidate }).warnings).toEqual(['Unknown release version; explicit replacement required.']);
    expect(planAgentPluginUpdate({ installed: revision, candidate: { ...candidate, version } }).warnings).toEqual(['Unknown release version; explicit replacement required.']);
  }
});
