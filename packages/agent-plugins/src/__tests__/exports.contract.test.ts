import { test, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import * as root from '../index.js';
import * as manifest from '../lifecycle/manifest.js';
import * as lifecycle from '../lifecycle/index.js';
import * as node from '../lifecycle/node.js';
import * as zip from '../lifecycle/yauzl-archive-reader.js';

test('runtime metadata and export targets agree for every code entry', async () => {
  const packageRoot = new URL('../../', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  for (const [subpath, entry, runtime] of [
    ['.', 'index', 'universal'],
    ['./manifest', 'lifecycle/manifest', 'universal'],
    ['./lifecycle', 'lifecycle/index', 'node'],
    ['./lifecycle/node', 'lifecycle/node', 'node'],
    ['./lifecycle/yauzl', 'lifecycle/yauzl-archive-reader', 'node'],
  ] as const) {
    expect(pkg.exports[subpath]).toEqual({ types: `./dist/${entry}.d.ts`, import: `./dist/${entry}.js`, default: `./dist/${entry}.js` });
    expect(pkg.jini.entries[subpath]).toBe(runtime);
    await access(new URL(`src/${entry}.ts`, packageRoot));
  }
  expect(Object.keys(pkg.jini.entries).sort()).toEqual(Object.keys(pkg.exports).sort());
  expect(pkg.peerDependencies.yauzl).toBe('^3.4.0');
  expect(pkg.peerDependenciesMeta.yauzl.optional).toBe(true);
});

test('barrels expose callable facades without leaking internal composition factories', () => {
  expect(typeof root.validatePluginManifest).toBe('function');
  expect(typeof root.validateMcpManifest).toBe('function');
  expect(typeof manifest.parseAgentPluginManifest).toBe('function');
  expect(typeof manifest.parseAgentPluginMcpConfig).toBe('function');
  expect(typeof manifest.validatePluginManifest).toBe('function');
  expect(typeof lifecycle.createAgentPluginLifecycle).toBe('function');
  expect(typeof node.createNodeAgentPluginEffects).toBe('function');
  expect(node).not.toHaveProperty('createNodeAgentPluginFilesystem');
  expect(lifecycle).not.toHaveProperty('withExclusiveFileLock');
  expect(typeof zip.createYauzlAgentPluginArchiveReader).toBe('function');
  expect(lifecycle).not.toHaveProperty('createInstallModule');
  expect(lifecycle).not.toHaveProperty('createActivationModule');
});
