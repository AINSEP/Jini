import { expect, test } from 'vitest';
import {
  createPluginContributionLoader, defineExecutablePluginContribution,
  type PluginContributionDefinition, type PluginContributionPorts,
} from '../contribution-loader.js';
import type { TrustedPluginPackage, TrustedPluginPackagesQuery } from '../trusted-plugin-files.js';

type Descriptor = { id: string; module: string };
type Module = { run: () => void };
const plugin = { pluginId: 'fixture', packageRoot: '/fixture' };
const descriptor = { id: 'one', module: 'one.mjs' };
const executable = defineExecutablePluginContribution<Descriptor, Module>({
  filename: 'fixture-executables.json', contribution: 'executables',
  parse: ({ raw }) => raw === 'invalid' ? { ok: false, reason: 'not valid JSON' } : { ok: true, descriptors: [descriptor] },
  modulePath: ({ descriptor }) => descriptor.module,
  validate: ({ exported }) => {
    const candidate = exported as Partial<Module> | null;
    return candidate && typeof candidate.run === 'function' ? candidate as Module : 'missing run()';
  },
  refusal: ({ plugin, descriptor, reason }) => `executable '${descriptor.id}' from '${plugin.pluginId}' was not loaded: ${reason}`,
});
const data: PluginContributionDefinition<Descriptor, Descriptor> = {
  filename: 'fixture-rules.json', contribution: 'rules', kind: 'data',
  parse: () => ({ ok: true, descriptors: [descriptor] }), load: ({ descriptor }) => descriptor,
};

function fixture(overrides: Partial<PluginContributionPorts> = {}) {
  const queries: TrustedPluginPackagesQuery[] = [];
  const reads: string[] = [];
  const imports: string[] = [];
  const module: Module = { run() {} };
  const loader = createPluginContributionLoader({
    findPackages: async query => { queries.push(query); return [{ trusted: plugin }]; },
    readFile: async ({ plugin, filename }) => { reads.push(`${plugin.pluginId}/${filename}`); return 'valid'; },
    importModule: async ({ plugin, modulePath }) => { imports.push(`${plugin.pluginId}/${modulePath}`); return { exported: module }; },
    ...overrides,
  });
  return { ...loader, queries, reads, imports, module };
}

test('executable discovery requires activation even when the caller asks to skip it; data can opt out', async () => {
  const loader = fixture();
  const result = await loader.loadPluginContributions({ workspaceId: 'ws', definition: executable }, { requireActive: false, orderByPluginId: true });
  expect(loader.queries).toEqual([{
    workspaceId: 'ws', filename: 'fixture-executables.json', contribution: 'executables', requireActive: true, orderByPluginId: true,
  }]);
  expect(result).toEqual({ items: [{ descriptor, pluginId: 'fixture', module: loader.module }], refusals: [] });
  await loader.loadPluginContributions({ workspaceId: 'ws', definition: data }, { requireActive: false });
  expect(loader.queries[1]).toEqual({ workspaceId: 'ws', filename: 'fixture-rules.json', contribution: 'rules', requireActive: false });
  expect(loader.imports).toEqual(['fixture/one.mjs']);
});

test('trust, package-policy, parse and module refusals stay interleaved; valid siblings survive', async () => {
  const packages = ['blocked', 'malformed', 'bad-module', 'healthy'].map(pluginId => ({ pluginId, packageRoot: `/${pluginId}` }));
  const reads: string[] = [];
  const module: Module = { run() {} };
  const loader = fixture({
    findPackages: async () => [{ refusal: 'trust refused first' }, ...packages.map(trusted => ({ trusted })), { refusal: 'trust refused last' }],
    readFile: async ({ plugin }) => { reads.push(plugin.pluginId); return plugin.pluginId === 'malformed' ? 'invalid' : 'valid'; },
    importModule: async ({ plugin }) => plugin.pluginId === 'bad-module' ? 'import refused' : { exported: module },
  });
  const result = await loader.loadPluginContributions({ workspaceId: 'ws', definition: executable }, {
    packageRefusal: ({ plugin }) => plugin.pluginId === 'blocked' ? 'package policy refused' : undefined,
  });
  expect(reads).toEqual(['malformed', 'bad-module', 'healthy']);
  expect(result).toEqual({
    items: [{ descriptor, pluginId: 'healthy', module }],
    refusals: ['trust refused first', 'package policy refused',
      "executables from 'malformed' were not loaded: fixture-executables.json is invalid: not valid JSON",
      "executable 'one' from 'bad-module' was not loaded: import refused", 'trust refused last'],
  });
});

test('declaration order and partial module failures survive within a package, with fresh reads each time', async () => {
  const loader = fixture({ importModule: async ({ modulePath }) => modulePath === 'bad.mjs' ? 'broken module' : { exported: { run() {} } } });
  const definition = { ...executable, parse: () => ({ ok: true as const, descriptors: [
    { id: 'first', module: 'first.mjs' }, { id: 'bad', module: 'bad.mjs' }, { id: 'last', module: 'last.mjs' },
  ] }) };
  for (let call = 0; call < 2; call++) {
    const result = await loader.loadPluginContributionsFromSource({ plugin, definition });
    expect(result.items.map(item => item.descriptor.id)).toEqual(['first', 'last']);
    expect(result.refusals).toEqual(["executable 'bad' from 'fixture' was not loaded: broken module"]);
  }
  expect(loader.reads).toEqual(['fixture/fixture-executables.json', 'fixture/fixture-executables.json']);
  expect(loader.queries).toEqual([]);
});

test('source missing-file tolerance is selective; unexpected reads propagate unless explicitly refused', async () => {
  const missing = Object.assign(new Error('missing fixture'), { code: 'ENOENT' });
  const denied = Object.assign(new Error('fixture read denied'), { code: 'EACCES' });
  const definition = { ...data, onReadError: ({ error }: { error: unknown }) => (error as { code?: string }).code === 'ENOENT' ? [] : undefined };
  const loader = fixture({ readFile: async () => { throw missing; } });
  expect(await loader.loadPluginContributionsFromSource({ plugin, definition })).toEqual({ items: [], refusals: [] });
  await expect(loader.loadPluginContributionsFromSource({ plugin, definition: data })).rejects.toBe(missing);
  const deniedLoader = fixture({ readFile: async () => { throw denied; } });
  await expect(deniedLoader.loadPluginContributionsFromSource({ plugin, definition })).rejects.toBe(denied);
  const refusal = { ...data, onReadError: () => ['fixture manifest could not be read'] };
  expect(await deniedLoader.loadPluginContributionsFromSource({ plugin, definition: refusal })).toEqual({ items: [], refusals: ['fixture manifest could not be read'] });
  expect(loader.imports).toEqual([]);
  expect(deniedLoader.imports).toEqual([]);
});

test('invalid exports and contained-import refusals are reported; import exceptions preserve each seam policy', async () => {
  const invalid = fixture({ importModule: async () => ({ exported: {} }) });
  expect((await invalid.loadPluginContributionsFromSource({ plugin, definition: executable })).refusals).toEqual(["executable 'one' from 'fixture' was not loaded: missing run()"]);
  const fault = new Error('fixture module unavailable');
  const failing = fixture({ importModule: async () => { throw fault; } });
  await expect(failing.loadPluginContributionsFromSource({ plugin, definition: executable })).rejects.toBe(fault);
  const definition = defineExecutablePluginContribution<Descriptor, Module>({
    filename: executable.filename, contribution: executable.contribution, parse: executable.parse,
    modulePath: ({ descriptor }) => descriptor.module, validate: () => { throw fault; },
    refusal: ({ reason }) => `safe refusal: ${reason}`,
  }, { importRefusalReason: 'module could not be imported', importErrorReason: 'module could not be read or imported' });
  expect((await failing.loadPluginContributionsFromSource({ plugin, definition })).refusals).toEqual(['safe refusal: module could not be read or imported']);
  expect((await fixture({ importModule: async () => 'fixture import error' }).loadPluginContributionsFromSource({ plugin, definition })).refusals).toEqual(['safe refusal: module could not be imported']);
  expect((await fixture().loadPluginContributionsFromSource({ plugin, definition })).refusals).toEqual(['safe refusal: module could not be read or imported']);
});

test('inactive discovery callbacks remain data-only and finish before active modules import', async () => {
  const events: string[] = [];
  const inactive: TrustedPluginPackage = { pluginId: 'inactive', packageRoot: '/inactive' };
  const loader = fixture({
    findPackages: async query => { await query.onInactive?.({ plugin: inactive }); events.push('discovered'); return [{ trusted: plugin }]; },
    importModule: async () => { events.push('imported'); return { exported: { run() {} } }; },
  });
  await loader.loadPluginContributions({ workspaceId: 'ws', definition: executable }, {
    onInactive: async ({ plugin }) => { events.push(`data:${plugin.pluginId}`); },
  });
  expect(events).toEqual(['data:inactive', 'discovered', 'imported']);
});

test('discovery faults propagate without reading or importing a source fallback', async () => {
  const fault = new Error('fixture package directory unavailable');
  const loader = fixture({ findPackages: async () => { throw fault; } });
  await expect(loader.loadPluginContributions({ workspaceId: 'ws', definition: executable })).rejects.toBe(fault);
  expect(loader.reads).toEqual([]);
  expect(loader.imports).toEqual([]);
});
