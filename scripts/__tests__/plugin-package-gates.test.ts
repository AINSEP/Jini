import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkPluginPackages, inspectPluginPackageTarball } from '../check-plugin-packages.js';
import { checkPackageLayers } from '../check-package-layers.js';
import type { JiniPackageEntry } from '../lib/pack-jini-packages.js';
import { agentPluginExports, agentPluginPackages } from '../lib/agent-plugin-packages.js';

type InspectionInput = { entry: JiniPackageEntry };

const names = ['provider-plugins', 'plugin-catalog'];
const subpathExports = Object.assign({}, ...agentPluginPackages.map(row => agentPluginExports(row)));
const documents = ['package.json', 'README.md', 'LICENSE', 'NOTICE'];
let root: string;

function write({ file, content }: { file: string; content: string }): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

function manifest({ name, fields = {} }: { name: string; fields?: Record<string, unknown> }): void {
  write({ file: `packages/${name}/package.json`, content: JSON.stringify({ name: `@jini-ai/${name}`, version: '0.6.17', ...fields }) });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jini-plugin-gate-test-'));
  write({ file: 'pnpm-workspace.yaml', content: 'packages:\n  - packages/*\n' });
  for (const name of [...names, 'core']) manifest({ name });
  manifest({ name: 'agent-plugins', fields: { exports: subpathExports } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('registers every distribution leaf and the catalog without allowing core imports of them', () => {
  expect(checkPluginPackages({ repoRoot: root })).toEqual([]);
  expect(checkPackageLayers({ repoRoot: root })).toEqual([]);
  manifest({ name: 'core', fields: { dependencies: { '@jini-ai/provider-plugins': '^0.6.17' } } });
  expect(checkPackageLayers({ repoRoot: root })).toEqual([{
    rule: 'L1-layer-edge', file: 'packages/core/package.json',
    reason: 'core → @jini-ai/provider-plugins: L0 cannot depend on L7',
  }]);
});

it('treats a new plugin package as a leaf by rule, while an unlisted core package still needs a layer', () => {
  manifest({ name: 'plugin-brand-new' });
  manifest({ name: 'brand-new-core' });
  expect(checkPackageLayers({ repoRoot: root })).toEqual([{
    rule: 'L0-unlisted-package', file: 'packages/brand-new-core/package.json', reason: 'package missing from the approved layer table',
  }]);
  rmSync(join(root, 'packages/brand-new-core'), { recursive: true });
  manifest({ name: 'agent-plugins', fields: { exports: subpathExports, dependencies: { '@jini-ai/plugin-brand-new': '^0.6.19' } } });
  expect(checkPackageLayers({ repoRoot: root })).toContainEqual({
    rule: 'L1-layer-edge', file: 'packages/agent-plugins/package.json',
    reason: 'agent-plugins → @jini-ai/plugin-brand-new: L4 cannot depend on L7',
  });
  manifest({ name: 'plugin-brand-new', fields: { dependencies: { '@jini-ai/core': '^0.6.19' } } });
  expect(checkPackageLayers({ repoRoot: root }).filter(violation => violation.file === 'packages/plugin-brand-new/package.json')).toEqual([]);
});

it('checks workspace dependency aliases and resolves local targets by their manifest identity', () => {
  manifest({ name: 'provider-plugins', fields: { devDependencies: { innocent: 'file:../../aliases/innocent' } } });
  write({ file: 'aliases/innocent/package.json', content: '{"name":"@jini-ai/plugin-payments-stripe"}' });
  expect(checkPluginPackages({ repoRoot: root })).toEqual([{
    rule: 'P1-plugin-isolation', file: 'packages/provider-plugins/package.json',
    reason: '@jini-ai/provider-plugins: forbidden local plugin dependency innocent: @jini-ai/plugin-payments-stripe',
  }]);
});

it('rejects a dependency hidden by a clean packed manifest before any inspector runs', () => {
  manifest({ name: 'provider-plugins', fields: { optionalDependencies: { alias: 'npm:@jini-ai/plugin-payments-stripe@0.6.17' } } });
  const inspectPackage = vi.fn(({ entry }: InspectionInput) => ({ manifest: { name: entry.pkg.name! }, packedPaths: documents }));
  const violations = checkPluginPackages({ repoRoot: root }, { inspectPackage });
  expect(violations).toHaveLength(1);
  expect(violations[0]!.reason).toContain('forbidden plugin dependency alias');
  expect(inspectPackage.mock.calls.some(([{ entry }]) => entry.pkg.name === '@jini-ai/provider-plugins')).toBe(false);
});

it.each([
  ['plugin-catalog', 'dist/index.js', 'catalog must be metadata-only'],
  ['agent-plugins', 'ui-ux-design/__tests__/bundled-package.test.mjs', 'unpublished file'],
  ['agent-plugins', 'vercel/netlify/plugin.json', "another plugin's payload"],
  ['agent-plugins', 'dist/content/future-agent/plugin.json', 'core package publishes plugin payload'],
  ['core', 'dist/content/future-plugin/plugin.json', 'core package publishes plugin payload'],
])('rejects %s packed payload contamination', (name, payload, reason) => {
  const violations = checkPluginPackages({ repoRoot: root }, { inspectPackage: ({ entry }) => ({
    manifest: { name: entry.pkg.name! }, packedPaths: [...documents, ...(entry.pkg.name === `@jini-ai/${name}` ? [payload] : [])],
  }) });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatchObject({ file: `packages/${name}/package.json`, reason: expect.stringContaining(reason) });
});

it('the source guard refuses an agent-plugins export that reaches into a sibling plugin folder', () => {
  manifest({ name: 'agent-plugins', fields: { exports: { ...subpathExports, './hosting/*': './vercel/*' } } });
  expect(checkPluginPackages({ repoRoot: root })).toEqual([{
    rule: 'P1-plugin-isolation', file: 'packages/agent-plugins/package.json',
    reason: '@jini-ai/agent-plugins: export ./hosting/* reaches into vercel/',
  }]);
});

it('fails closed on archive inspection errors and continues inspecting the release set', () => {
  const inspectPackage = vi.fn(({ entry }: InspectionInput) => {
    if (entry.pkg.name === '@jini-ai/plugin-catalog') throw new Error('tar failed');
    return { manifest: { name: entry.pkg.name! }, packedPaths: documents };
  });
  expect(checkPluginPackages({ repoRoot: root }, { inspectPackage })).toEqual([{
    rule: 'P1-plugin-isolation', file: 'packages/plugin-catalog/package.json', reason: 'tar failed',
  }]);
  expect(inspectPackage).toHaveBeenCalledTimes(names.length + 2);
});

it('omits private development tooling from tarball inspection without exempting its dependencies', () => {
  manifest({ name: 'provider-plugins', fields: { private: true, dependencies: { '@jini-ai/plugin-payments-stripe': '^0.6.17' } } });
  const inspectPackage = vi.fn(({ entry }: InspectionInput) => ({ manifest: { name: entry.pkg.name! }, packedPaths: documents }));
  const violations = checkPluginPackages({ repoRoot: root }, { inspectPackage });
  expect(violations).toHaveLength(1);
  expect(violations[0]!.reason).toContain('forbidden plugin dependency @jini-ai/plugin-payments-stripe');
  expect(inspectPackage.mock.calls.map(([{ entry }]) => entry.pkg.name)).not.toContain('@jini-ai/provider-plugins');
});

it('rejects missing published exports and attribution even when isolation alone accepts the archive', () => {
  const violations = checkPluginPackages({ repoRoot: root }, { inspectPackage: ({ entry }) => ({
    manifest: { name: entry.pkg.name!, ...(entry.pkg.name === '@jini-ai/provider-plugins' ? { exports: { './plugins/*': './plugins/*' } } : {}) },
    packedPaths: entry.pkg.name === '@jini-ai/plugin-catalog' ? documents.filter(file => file !== 'NOTICE') : documents,
  }) });
  expect(violations.map(value => value.reason).sort()).toEqual([
    '@jini-ai/plugin-catalog: missing packed NOTICE',
    '@jini-ai/provider-plugins: exported paths missing from tarball: ./plugins/*',
  ]);
});

it('inspects actual tar bytes without executing package lifecycle hooks', () => {
  const name = 'provider-plugins';
  manifest({ name, fields: { files: ['plugins', ...documents.slice(1)], exports: { './plugins/*': './plugins/*' },
    scripts: { prepack: 'node -e "throw new Error(\'prepack must not run\')"' } } });
  for (const file of documents.slice(1)) write({ file: `packages/${name}/${file}`, content: file });
  const payload = 'plugins/fixture-provider/0.6.17/server/index.mjs';
  write({ file: `packages/${name}/${payload}`, content: 'export const fixture = true;' });
  write({ file: `packages/${name}/src/private.ts`, content: 'unpublished source' });
  const entry = { dir: join(root, 'packages', name), pkg: JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')) };
  const packed = inspectPluginPackageTarball({ entry });
  expect(packed.manifest.name).toBe('@jini-ai/provider-plugins');
  expect([...packed.packedPaths].sort()).toEqual([...documents, payload].map(file => `package/${file}`).sort());
}, 30_000);
