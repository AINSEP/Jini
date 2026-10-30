import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkPluginPackages, inspectPluginPackageTarball } from '../check-plugin-packages.js';
import { checkPackageLayers } from '../check-package-layers.js';
import type { JiniPackageEntry } from '../lib/pack-jini-packages.js';

type InspectionInput = { entry: JiniPackageEntry };

const names = ['plugin-ai-trace-langfuse', 'plugin-analytics-posthog', 'plugin-fixture-provider',
  'plugin-observability-opentelemetry', 'plugin-observability-sentry', 'plugin-payments-stripe',
  'plugin-ui-ux-design', 'plugin-catalog'];
const documents = ['package.json', 'README.md', 'LICENSE', 'NOTICE'];
let root: string;

function write({ file, content }: { file: string; content: string }): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

function manifest({ name, fields = {} }: { name: string; fields?: Record<string, unknown> }): void {
  write({ file: `packages/${name}/package.json`, content: JSON.stringify({ name: `@jini-ai/${name}`, version: '0.6.15', ...fields }) });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jini-plugin-gate-test-'));
  write({ file: 'pnpm-workspace.yaml', content: 'packages:\n  - packages/*\n' });
  for (const name of [...names, 'core', 'agent-plugins']) manifest({ name });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('registers all seven distribution leaves and the catalog without allowing core imports of them', () => {
  expect(checkPluginPackages({ repoRoot: root })).toEqual([]);
  expect(checkPackageLayers({ repoRoot: root })).toEqual([]);
  manifest({ name: 'core', fields: { dependencies: { '@jini-ai/plugin-fixture-provider': '^0.6.15' } } });
  expect(checkPackageLayers({ repoRoot: root })).toEqual([{
    rule: 'L1-layer-edge', file: 'packages/core/package.json',
    reason: 'core → @jini-ai/plugin-fixture-provider: L0 cannot depend on L7',
  }]);
});

it('checks workspace dependency aliases and resolves local targets by their manifest identity', () => {
  manifest({ name: 'plugin-fixture-provider', fields: { devDependencies: { innocent: 'file:../../aliases/innocent' } } });
  write({ file: 'aliases/innocent/package.json', content: '{"name":"@jini-ai/plugin-payments-stripe"}' });
  expect(checkPluginPackages({ repoRoot: root })).toEqual([{
    rule: 'P1-plugin-isolation', file: 'packages/plugin-fixture-provider/package.json',
    reason: '@jini-ai/plugin-fixture-provider: forbidden local plugin dependency innocent: @jini-ai/plugin-payments-stripe',
  }]);
});

it('rejects a dependency hidden by a clean packed manifest before any inspector runs', () => {
  manifest({ name: 'plugin-fixture-provider', fields: { optionalDependencies: { alias: 'npm:@jini-ai/plugin-payments-stripe@0.6.15' } } });
  const inspectPackage = vi.fn(({ entry }: InspectionInput) => ({ manifest: { name: entry.pkg.name! }, packedPaths: documents }));
  const violations = checkPluginPackages({ repoRoot: root }, { inspectPackage });
  expect(violations).toHaveLength(1);
  expect(violations[0]!.reason).toContain('forbidden plugin dependency alias');
  expect(inspectPackage.mock.calls.some(([{ entry }]) => entry.pkg.name === '@jini-ai/plugin-fixture-provider')).toBe(false);
});

it.each([
  ['plugin-catalog', 'dist/index.js', 'catalog must be metadata-only'],
  ['agent-plugins', 'ui-ux-design/plugin.json', "another plugin's payload"],
  ['core', 'dist/content/future-plugin/plugin.json', 'core package publishes plugin payload'],
])('rejects %s packed payload contamination', (name, payload, reason) => {
  const violations = checkPluginPackages({ repoRoot: root }, { inspectPackage: ({ entry }) => ({
    manifest: { name: entry.pkg.name! }, packedPaths: [...documents, ...(entry.pkg.name === `@jini-ai/${name}` ? [payload] : [])],
  }) });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatchObject({ file: `packages/${name}/package.json`, reason: expect.stringContaining(reason) });
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
  manifest({ name: 'provider-plugins', fields: { private: true } });
  manifest({ name: 'plugin-fixture-provider', fields: { private: true, dependencies: { '@jini-ai/plugin-payments-stripe': '^0.6.15' } } });
  const inspectPackage = vi.fn(({ entry }: InspectionInput) => ({ manifest: { name: entry.pkg.name! }, packedPaths: documents }));
  const violations = checkPluginPackages({ repoRoot: root }, { inspectPackage });
  expect(violations).toHaveLength(1);
  expect(violations[0]!.reason).toContain('forbidden plugin dependency @jini-ai/plugin-payments-stripe');
  expect(inspectPackage.mock.calls.map(([{ entry }]) => entry.pkg.name)).not.toContain('@jini-ai/provider-plugins');
  expect(inspectPackage.mock.calls.map(([{ entry }]) => entry.pkg.name)).not.toContain('@jini-ai/plugin-fixture-provider');
});

it('rejects missing published exports and attribution even when isolation alone accepts the archive', () => {
  const violations = checkPluginPackages({ repoRoot: root }, { inspectPackage: ({ entry }) => ({
    manifest: { name: entry.pkg.name!, ...(entry.pkg.name === '@jini-ai/plugin-fixture-provider' ? { exports: { './plugins/*': './plugins/*' } } : {}) },
    packedPaths: entry.pkg.name === '@jini-ai/plugin-catalog' ? documents.filter(file => file !== 'NOTICE') : documents,
  }) });
  expect(violations.map(value => value.reason).sort()).toEqual([
    '@jini-ai/plugin-catalog: missing packed NOTICE',
    '@jini-ai/plugin-fixture-provider: exported paths missing from tarball: ./plugins/*',
  ]);
});

it('inspects actual tar bytes without executing package lifecycle hooks', () => {
  const name = 'plugin-fixture-provider';
  manifest({ name, fields: { files: ['plugins', ...documents.slice(1)], exports: { './plugins/*': './plugins/*' },
    scripts: { prepack: 'node -e "throw new Error(\'prepack must not run\')"' } } });
  for (const file of documents.slice(1)) write({ file: `packages/${name}/${file}`, content: file });
  const payload = 'plugins/fixture-provider/0.6.15/server/index.mjs';
  write({ file: `packages/${name}/${payload}`, content: 'export const fixture = true;' });
  write({ file: `packages/${name}/src/private.ts`, content: 'unpublished source' });
  const entry = { dir: join(root, 'packages', name), pkg: JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')) };
  const packed = inspectPluginPackageTarball({ entry });
  expect(packed.manifest.name).toBe('@jini-ai/plugin-fixture-provider');
  expect([...packed.packedPaths].sort()).toEqual([...documents, payload].map(file => `package/${file}`).sort());
}, 30_000);
