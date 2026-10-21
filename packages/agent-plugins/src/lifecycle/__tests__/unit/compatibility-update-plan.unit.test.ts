import { describe, expect, test } from 'vitest';
import { parseAgentPluginManifest } from '../../manifest.js';
import {
  AGENT_PLUGIN_CONTRACT_VERSION, INVALID_AGENT_PLUGIN_HOST_RANGE, AgentPluginHostIncompatibleError, agentPluginDependentWarnings,
  checkAgentPluginCompatibility, describeAgentPluginCompatibility, isValidAgentPluginHostRange, readAgentPluginCompatibilityMetadata,
} from '../../compatibility.js';
import { planAgentPluginUpdate } from '../../update-plan.js';
import type { AgentPluginActivations } from '../../activation.js';
import type { InstalledAgentPlugin } from '../../types.js';

const id = 'example/sample';
const manifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'sample' };
const revision = { pluginId: 'sample', version: '1.0.0', archiveDigest: 'a'.repeat(64) };
const candidate = { ...revision, version: '2.0.0', archiveDigest: 'b'.repeat(64) };
const installed = (id: string, provides: string[] = [], requires: string[] = []): InstalledAgentPlugin => ({
  pluginId: id, provides, requires, archiveDigest: id, packageRoot: '/fixture', files: [], skills: [],
});
const record = (enabled: boolean, origin: 'bundled' | 'operator-installed' = 'operator-installed') => ({ enabled, origin, updatedAt: '', updatedBy: '' });
const activations: AgentPluginActivations = { schemaVersion: 1, plugins: { off: record(false), on: record(true) } };
const none: AgentPluginActivations = { schemaVersion: 1, plugins: {} };

describe('host contract range (semver.satisfies over AGENT_PLUGIN_CONTRACT_VERSION)', () => {
  test.each(['*', '1', '1.x', '^1.0.0', '~1.0.0', '>=1', '>=1 <2', '1.0.0 - 2.0.0', '>=2 || 1.0.0', '1.0.0'])('accepts satisfied range %s', hostRange => {
    expect(checkAgentPluginCompatibility({ manifest: { hostRange }, hostVersion: AGENT_PLUGIN_CONTRACT_VERSION, activeProvides: [] }))
      .toEqual({ hostOk: true, missingRequires: [] });
  });
  test.each(['>=99', '^2', '>=1.1.0-beta.1'])('refuses a valid but unsatisfied range %s', hostRange => {
    expect(checkAgentPluginCompatibility({ manifest: { hostRange }, hostVersion: '1.0.0', activeProvides: [] }).hostOk).toBe(false);
  });
  // A blank range is a semver wildcard; treating it as "any host" would silently allow a malformed manifest.
  test.each(['', '   ', 'wat', INVALID_AGENT_PLUGIN_HOST_RANGE])('refuses malformed range %j without throwing', hostRange => {
    expect(isValidAgentPluginHostRange({ range: hostRange })).toBe(false);
    expect(checkAgentPluginCompatibility({ manifest: { hostRange }, hostVersion: '1.0.0', activeProvides: [] }).hostOk).toBe(false);
  });
  test('an absent range is compatible and advisory requirements are deduplicated', () => {
    expect(checkAgentPluginCompatibility({ manifest: { requires: ['a', 'b', 'a'] }, hostVersion: '1.0.0', activeProvides: ['b'] }))
      .toEqual({ hostOk: true, missingRequires: ['a'] });
    expect(checkAgentPluginCompatibility({ manifest: {}, hostVersion: '1.0.0', activeProvides: [] })).toEqual({ hostOk: true, missingRequires: [] });
  });
  test('the refusal carries the stable PLUGIN_HOST_INCOMPATIBLE code', () => {
    const error = new AgentPluginHostIncompatibleError({ pluginId: 'self' });
    expect(error).toBeInstanceOf(Error);
    expect([error.code, error.name, error.message]).toEqual(['PLUGIN_HOST_INCOMPATIBLE', 'AgentPluginHostIncompatibleError',
      "Plugin 'self' is not compatible with this host's Agent Plugin contract."]);
  });
});

describe('manifest metadata in extensions.<namespace>', () => {
  test('reads only the host-selected namespace and deduplicates requires', () => {
    const parsed = parseAgentPluginManifest({ value: { ...manifest, extensions: { other: { hostRange: '>=99' }, host: { id, hostRange: '^1', requires: ['a', 'a'] } } } }, { identityNamespace: 'host' });
    if (!parsed.ok) throw new Error('manifest rejected');
    expect([parsed.manifest.hostRange, parsed.manifest.requires, parsed.warnings]).toEqual(['^1', ['a'], []]);
  });
  test('no metadata, or metadata only in another namespace, adds neither field nor a compatibility warning', () => {
    const identityOnly = ["Plugin 'sample' has no publisher-qualified id; using 'unknown/sample'."];
    for (const [extensions, warnings] of [[undefined, identityOnly], [{ other: { hostRange: '>=99', requires: [null] } }, identityOnly], [{ host: { id } }, []]] as const) {
      const parsed = parseAgentPluginManifest({ value: { ...manifest, ...(extensions ? { extensions } : {}) } }, { identityNamespace: 'host' });
      if (!parsed.ok) throw new Error('manifest rejected');
      expect('hostRange' in parsed.manifest || 'requires' in parsed.manifest).toBe(false);
      expect(parsed.warnings).toEqual(warnings);
    }
  });
  test.each([42, null, '', ' ', 'wat', ['^1']])('a malformed hostRange %j stays listable, warns, and is never compatible', hostRange => {
    const parsed = parseAgentPluginManifest({ value: { ...manifest, extensions: { host: { id, hostRange } } } }, { identityNamespace: 'host' });
    if (!parsed.ok) throw new Error('invalid metadata must stay listable');
    expect(parsed.manifest.hostRange).toBe(INVALID_AGENT_PLUGIN_HOST_RANGE);
    expect(parsed.warnings).toEqual(['hostRange is invalid; enabling this plugin is refused']);
    expect(checkAgentPluginCompatibility({ manifest: parsed.manifest, hostVersion: AGENT_PLUGIN_CONTRACT_VERSION, activeProvides: [] }).hostOk).toBe(false);
  });
  test.each([[[null]], [['']], [[' ']], ['a'], [{ a: true }], [[1]]])('malformed requires %j is dropped with a warning (advisory only)', requires => {
    expect(readAgentPluginCompatibilityMetadata({ extension: { requires } }))
      .toEqual({ warnings: ['requires must be an array of non-empty capability ids'] });
  });
  test('an empty requires list is valid', () => {
    expect(readAgentPluginCompatibilityMetadata({ extension: { requires: [] } })).toEqual({ requires: [], warnings: [] });
  });
});

describe('live requirement projection', () => {
  test('excludes disabled providers and self-satisfaction; absent activation record means active', () => {
    const self = installed('self', ['a'], ['a', 'b', 'c', 'd']);
    const plugins = [self, installed('on', ['b']), installed('off', ['c']), installed('unrecorded', ['d'])];
    expect(describeAgentPluginCompatibility({ plugin: self, installed: plugins, activations }))
      .toEqual({ origin: 'operator-installed', hostOk: true, missingRequires: ['a', 'c'] });
  });
  test('reports the recorded origin and honours an injected host contract version', () => {
    const bundled = { ...installed('kit'), hostRange: '^1' };
    const state: AgentPluginActivations = { schemaVersion: 1, plugins: { kit: record(true, 'bundled') } };
    expect(describeAgentPluginCompatibility({ plugin: bundled, installed: [bundled], activations: state }))
      .toEqual({ origin: 'bundled', hostOk: true, missingRequires: [] });
    expect(describeAgentPluginCompatibility({ plugin: bundled, installed: [bundled], activations: state }, { hostVersion: '2.0.0' }).hostOk).toBe(false);
  });
  test('names each active dependent left without a removed capability', () => {
    const self = installed('self', ['a', 'b']);
    const dependent = installed('dependent', [], ['a', 'a', 'b']);
    expect(agentPluginDependentWarnings({ plugin: self, installed: [self, dependent], activations: none, nextProvides: ['b'] }))
      .toEqual(['dependent needs a']);
  });
  test('another enabled provider satisfies the dependent; disabled providers and the dependent itself do not', () => {
    const self = installed('self', ['a']);
    const dependent = installed('dependent', ['a'], ['a']);
    expect(agentPluginDependentWarnings({ plugin: self, installed: [self, dependent, installed('other', ['a'])], activations: none, nextProvides: [] })).toEqual([]);
    expect(agentPluginDependentWarnings({ plugin: self, installed: [self, dependent, installed('off', ['a'])], activations, nextProvides: [] }))
      .toEqual(['dependent needs a']);
  });
  test('disabled dependents and retained capabilities produce no warning', () => {
    const self = installed('self', ['a']);
    expect(agentPluginDependentWarnings({ plugin: self, installed: [self, installed('off', [], ['a'])], activations, nextProvides: [] })).toEqual([]);
    expect(agentPluginDependentWarnings({ plugin: self, installed: [self, installed('dependent', [], ['a'])], activations, nextProvides: ['a'] })).toEqual([]);
    expect(agentPluginDependentWarnings({ plugin: installed('bare'), installed: [installed('dependent', [], ['a'])], activations, nextProvides: [] })).toEqual([]);
  });
  test('plugins without provides/requires metadata are treated as empty', () => {
    const bare: InstalledAgentPlugin = { pluginId: 'bare', archiveDigest: 'x', packageRoot: '/fixture', files: [], skills: [] };
    expect(describeAgentPluginCompatibility({ plugin: bare, installed: [bare, { ...bare, pluginId: 'peer' }], activations: none }))
      .toEqual({ origin: 'operator-installed', hostOk: true, missingRequires: [] });
    expect(agentPluginDependentWarnings({ plugin: bare, installed: [bare, { ...bare, pluginId: 'peer' }], activations: none, nextProvides: [] })).toEqual([]);
  });
});

describe('update planning: semver orders releases, digest identifies bytes', () => {
  test('a newer release updates and keeps the enabled state', () => {
    expect(planAgentPluginUpdate({ installed: { ...revision, enabled: true }, candidate })).toEqual({ action: 'update', enabled: true, warnings: [] });
    expect(planAgentPluginUpdate({ installed: revision, candidate }).enabled).toBe(false);
  });
  test('identical bytes are a no-op; a different plugin id is refused before digests are compared', () => {
    expect(planAgentPluginUpdate({ installed: revision, candidate: revision })).toEqual({ action: 'none', enabled: false, warnings: [] });
    expect(planAgentPluginUpdate({ installed: revision, candidate: { ...revision, pluginId: 'different' } }).action).toBe('id-mismatch');
    expect(planAgentPluginUpdate({ installed: revision, candidate: { ...candidate, pluginId: 'different' } }).action).toBe('id-mismatch');
  });
  test('older releases, including prereleases of the same version, are refused', () => {
    expect(planAgentPluginUpdate({ installed: candidate, candidate: revision }).action).toBe('downgrade-refused');
    expect(planAgentPluginUpdate({ installed: revision, candidate: { ...candidate, version: '1.0.0-beta.1' } }).action).toBe('downgrade-refused');
    expect(planAgentPluginUpdate({ installed: { ...revision, version: '1.0.0-beta.1' }, candidate: { ...candidate, version: '1.0.0' } }))
      .toEqual({ action: 'update', enabled: false, warnings: [] });
  });
  test('the same version with different bytes updates only with an explicit-replacement warning', () => {
    for (const version of ['1.0.0', '1.0.0+build']) {
      expect(planAgentPluginUpdate({ installed: revision, candidate: { ...candidate, version } }))
        .toEqual({ action: 'update', enabled: false, warnings: ['Same version with different bytes; explicit replacement required.'] });
    }
  });
  test.each([undefined, 'invalid', ''])('an absent or invalid version %j on either side is an explicit replacement', version => {
    const expected = { action: 'update', enabled: false, warnings: ['Unknown release version; explicit replacement required.'] };
    expect(planAgentPluginUpdate({ installed: { ...revision, version }, candidate })).toEqual(expected);
    expect(planAgentPluginUpdate({ installed: revision, candidate: { ...candidate, version } })).toEqual(expected);
  });
});
