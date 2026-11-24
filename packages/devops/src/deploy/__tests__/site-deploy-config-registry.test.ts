import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDeployConfigGeneratorSource, readBundledDeployConfigDescriptors, readDeployConfigTargetIdsFromSource,
  type DeployConfigContributionSpec, type DeployConfigPluginSource, type LoadDeployWorkflowContributions,
} from '../site/deploy-config-registry.js';
import type { DeployConfigGeneratorDescriptor, LoadedDeployConfigGenerator } from '../config-descriptors.js';

const filename = 'acme-deploy-configs.json';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Entry = Partial<DeployConfigGeneratorDescriptor> & { readonly id: string };
const manifest = (entries: readonly Entry[]) => JSON.stringify({ schemaVersion: 1, generators: entries.map(entry => ({ label: entry.id, module: `${entry.id}.mjs`, ...entry })) });

/** Writes one plugin directory per key (`null` = no manifest) and returns the source root. */
function bundle(plugins: Record<string, string | null>): { root: string; sources: DeployConfigPluginSource[] } {
  const root = mkdtempSync(path.join(tmpdir(), 'jini-deploy-registry-'));
  roots.push(root);
  const sources = Object.entries(plugins).map(([pluginId, raw]) => {
    const packageRoot = path.join(root, pluginId);
    mkdirSync(packageRoot, { recursive: true });
    if (raw !== null) writeFileSync(path.join(packageRoot, filename), raw);
    return { pluginId, packageRoot };
  });
  return { root, sources };
}

const generator = (pluginId: string, id: string): LoadedDeployConfigGenerator => ({
  pluginId, descriptor: { id, label: id, module: `${id}.mjs` }, module: { render: () => ({ filename: 'f', contents: '', notes: [] }) },
});

function source(sources: readonly DeployConfigPluginSource[], loaded: Record<string, readonly LoadedDeployConfigGenerator[]> = {}) {
  const specs: DeployConfigContributionSpec[] = [];
  const onReadErrors: ((input: { error: unknown }) => readonly string[] | undefined)[] = [];
  const warn = vi.fn<(line: string) => void>();
  const contributionSources = vi.fn(({ filename: name }: { sourceRoot: string; filename: string }) => { expect(name).toBe(filename); return sources; });
  const bound = createDeployConfigGeneratorSource({
    filename, contributionSources, warn,
    defineExecutableContribution: (spec, optional) => { specs.push(spec); onReadErrors.push(optional.onReadError); return 'definition' as const; },
    loadFromSource: async ({ plugin, definition }) => {
      expect(definition).toBe('definition');
      return { items: loaded[plugin.pluginId] ?? [], refusals: [`seen ${plugin.pluginId}`] };
    },
  });
  return { bound, specs, onReadErrors, warn, contributionSources };
}

describe('createDeployConfigGeneratorSource', () => {
  it('defines one executable contribution named by the injected manifest file', () => {
    const { specs, onReadErrors } = source([]);
    const [spec] = specs;
    expect(spec?.filename).toBe(filename);
    expect(spec?.contribution).toBe('deploy configs');
    expect(spec?.parse({ raw: manifest([{ id: 'a' }]) })).toEqual({ ok: true, descriptors: [{ id: 'a', label: 'a', module: 'a.mjs' }] });
    expect(spec?.modulePath({ descriptor: { id: 'a', label: 'a', module: 'x.mjs' } })).toBe('x.mjs');
    expect(spec?.validate({ exported: {} })).toBe('its module has no render() function');
    expect(spec?.refusal({ plugin: { pluginId: 'p' }, descriptor: { id: 'a', label: 'a', module: 'a.mjs' }, reason: 'bad' })).toBe("deploy config 'a' from 'p' was not loaded: bad");
    expect(onReadErrors[0]?.({ error: Object.assign(new Error('gone'), { code: 'ENOENT' }) })).toEqual([]);
    expect(onReadErrors[0]?.({ error: new Error('fault') })).toBeUndefined();
  });

  it('loads one source and every bundled source, refusing cross-package duplicate ids for all claimants', async () => {
    const { sources } = bundle({ one: null, two: null });
    const { bound } = source(sources, { one: [generator('one', 'a'), generator('one', 'dup')], two: [generator('two', 'dup')] });
    const single = await bound.loadDeployConfigGeneratorsFromSource(sources[0]!);
    expect(single.list().map(item => item.descriptor.id)).toEqual(['a', 'dup']);
    expect(single.get('a')?.pluginId).toBe('one');
    const all = await bound.loadBundledDeployConfigGenerators({ sourceRoot: '/r' });
    expect(all.list().map(item => item.descriptor.id)).toEqual(['a']);
    expect(all.get('dup')).toBeUndefined();
    expect(all.refusals).toEqual(['seen one', 'seen two', "deploy config 'dup' was not loaded: declared more than once"]);
  });

  it('reads bundled hints synchronously: ids, candidate paths and the one unambiguous workflow file', () => {
    const { sources } = bundle({
      a: manifest([{ id: 'x', candidatePaths: [{ path: 'x.toml', order: 2 }], workflowFile: 'ship.yml' }, { id: 'dup' }, { id: 'plain' }]),
      b: manifest([{ id: 'y', candidatePaths: [{ path: 'y.yaml', order: 1 }, { path: 'x.toml', order: 5 }] }, { id: 'dup' }]),
      bad: '{', none: null,
    });
    const { bound } = source(sources);
    expect(bound.readBundledDeployConfigTargetIds({ sourceRoot: '/r' })).toEqual(['x', 'plain', 'y']);
    expect(bound.readBundledDeployConfigDescriptors({ sourceRoot: '/r' }).map(entry => entry.id)).toEqual(['x', 'plain', 'y']);
    expect(bound.readBundledDeployConfigCandidatePaths({ sourceRoot: '/r' })).toEqual(['y.yaml', 'x.toml', 'app.json']);
    expect(bound.readBundledDeployWorkflowFile({ sourceRoot: '/r' })).toBe('ship.yml');
    expect(bound.readBundledDeployWorkflowFiles({ sourceRoot: '/r' })).toEqual(['ship.yml']);
    expect(bound.readDeployConfigTargetIdsFromSource(sources[0]!)).toEqual(['x', 'dup', 'plain']);
  });

  it('never guesses between several workflow files', () => {
    const { sources } = bundle({ a: manifest([{ id: 'x', workflowFile: 'one.yml' }]), b: manifest([{ id: 'y', workflowFile: 'two.yml' }]) });
    const { bound } = source(sources);
    expect(bound.readBundledDeployWorkflowFile({ sourceRoot: '/r' })).toBeUndefined();
    expect(bound.readBundledDeployWorkflowFiles({ sourceRoot: '/r' })).toEqual(['one.yml', 'two.yml']);
  });

  it('degrades a missing bundled root to no hints rather than a boot failure', () => {
    const { bound, contributionSources } = source([]);
    contributionSources.mockImplementation(() => { throw new Error('no root'); });
    expect(readBundledDeployConfigDescriptors({ sourceRoot: '/r', filename, contributionSources })).toEqual([]);
    expect(bound.readBundledDeployConfigCandidatePaths({ sourceRoot: '/r' })).toEqual(['app.json']);
  });

  it('loads installed workflow files through the active lifecycle and logs each refusal', async () => {
    const { bound, warn } = source([]);
    const loadContributions = vi.fn<LoadDeployWorkflowContributions>(async ({ definition }, optional) => {
      expect(optional).toEqual({ requireActive: true, orderByPluginId: true });
      expect(definition).toMatchObject({ filename, contribution: 'deploy workflow declarations', kind: 'data' });
      expect(definition.onReadError()).toEqual([]);
      expect(definition.parse({ raw: '{' })).toEqual({ ok: false, reason: 'not valid JSON' });
      const descriptor = { id: 'x', label: 'x', module: 'x.mjs', workflowFile: 'ship.yml' };
      expect(definition.load({ descriptor })).toBe(descriptor);
      return { items: [descriptor, { ...descriptor, id: 'y' }, { id: 'z', label: 'z', module: 'z.mjs' }], refusals: ['refused one'] };
    });
    expect(await bound.loadDeployWorkflowFiles({ workspaceId: 'ws', loadContributions })).toEqual(['ship.yml']);
    expect(loadContributions.mock.calls[0]?.[0].workspaceId).toBe('ws');
    expect(warn).toHaveBeenCalledWith('refused one');
  });
});

describe('readDeployConfigTargetIdsFromSource', () => {
  it('yields no ids for a missing or invalid manifest', () => {
    const { sources } = bundle({ none: null, bad: '{' });
    expect(readDeployConfigTargetIdsFromSource({ plugin: sources[0]!, filename })).toEqual([]);
    expect(readDeployConfigTargetIdsFromSource({ plugin: sources[1]!, filename })).toEqual([]);
  });
});
