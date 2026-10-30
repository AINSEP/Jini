import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { computePluginIntegrity } from '@jini-ai/plugins/host/node';
import type { PluginManifest } from '@jini-ai/plugins/host';
import { buildProviderPlugin } from '../../provider-plugins/scripts/build.js';
import { assertPluginPackageIsolation } from '../../../scripts/check-plugin-isolation.js';
import { createHash } from 'node:crypto';
import { ADAPTER_FILE, POSTHOG_SDK_INTEGRITY, SDK_FILE } from '../../provider-plugins/src/analytics-posthog/consent.js';

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../../provider-plugins/', import.meta.url));
const id = 'analytics-posthog';
const packageName = '@jini-ai/plugin-analytics-posthog';
const documents = ['package.json', 'README.md', 'LICENSE', 'NOTICE'];
let root: string;
let installed: string;
let artifact: string;
let artifactPath: string;
let packedFiles: string[];
let manifest: PluginManifest;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'analytics-posthog-pack-'));
  const distribution = path.join(root, 'distribution');
  await mkdir(distribution);
  for (const name of documents) await copyFile(path.join(packageRoot, name), path.join(distribution, name));
  const entry = await buildProviderPlugin({ packageRoot: sourceRoot, id, destinationPackageRoot: distribution });
  artifactPath = entry.path;
  // Build in scratch first; lifecycle suppression keeps pack inspection from rewriting the checkout.
  const packed = await exec('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache')], { cwd: distribution });
  const [result] = JSON.parse(packed.stdout) as { filename: string }[];
  const tarball = path.join(distribution, result!.filename);
  const inventory = await exec('tar', ['-tzf', tarball]);
  packedFiles = inventory.stdout.trim().split('\n').filter(name => !name.endsWith('/')).map(name => name.replace(/^package\//, '')).sort();
  installed = path.join(root, 'node_modules', packageName);
  await mkdir(installed, { recursive: true });
  await exec('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1']);
  artifact = path.join(installed, artifactPath);
  manifest = JSON.parse(await readFile(path.join(artifact, 'jini.plugin.json'), 'utf8')) as PluginManifest;
}, 120_000);
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('packs exactly its own sealed artifact and provenance without sibling code or runtime dependencies', async () => {
  const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  expect(pkg.name).toBe(packageName);
  expect(artifactPath).toBe(`plugins/${id}/${pkg.version}`);
  expect(packedFiles).toEqual([...documents, `${artifactPath}/jini.plugin.json`,
    ...Object.keys(manifest.integrity).map(file => `${artifactPath}/${file}`)].sort());
  assertPluginPackageIsolation({ manifest: pkg, packedPaths: packedFiles, pluginIds: [id] });
  expect(packedFiles.filter(file => /(?:^|\/)(?:src|tests|__tests__|node_modules|coverage|\.cache)(?:\/|$)|\.(?:map|ts|tsx|tsbuildinfo)$/.test(file))).toEqual([]);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) expect(pkg[field]).toBeUndefined();
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(pkg.scripts[hook]).toBeUndefined();
  const command = `node --import tsx ../provider-plugins/scripts/build.ts ${id} .`;
  expect(pkg.scripts.build).toBe(command);
  expect(pkg.scripts.prepack).toBe(command);
});

it('preserves the source contract and retains only this distribution attribution under verified integrity', async () => {
  const source = JSON.parse(await readFile(path.join(sourceRoot, 'src', id, 'jini.plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  expect(manifest).toEqual({ ...source, version: pkg.version, integrity: manifest.integrity });
  expect(manifest.integrity).toEqual(await computePluginIntegrity({ sourceDir: artifact }));
  expect(manifest.integrity['server/index.mjs']).toMatch(/^sha256-[a-f0-9]{64}$/);
  const owner = `licenses/${packageName.replace(/[^a-z0-9._-]/gi, '_')}`;
  for (const name of ['LICENSE', 'NOTICE']) {
    expect(await readFile(path.join(artifact, owner, name), 'utf8')).toBe(await readFile(path.join(packageRoot, name), 'utf8'));
  }
  expect(await readFile(path.join(installed, 'NOTICE'), 'utf8')).not.toContain('Open SaaS');
});

it('resolves the package manifest and artifact export outside the workspace with no sibling plugin installed', async () => {
  const resolve = createRequire(path.join(root, 'host.cjs')).resolve;
  expect(resolve(`${packageName}/package.json`)).toBe(path.join(installed, 'package.json'));
  expect(resolve(`${packageName}/${artifactPath}/server/index.mjs`)).toBe(path.join(artifact, 'server/index.mjs'));
  expect(await readdir(path.join(root, 'node_modules/@jini-ai'))).toEqual([`plugin-${id}`]);
});

it('ships the unchanged pinned browser SDK and consent adapter in the selected artifact', async () => {
  const sdk = await readFile(path.join(artifact, 'server', SDK_FILE));
  expect(`sha256-${createHash('sha256').update(sdk).digest('base64')}`).toBe(POSTHOG_SDK_INTEGRITY);
  expect(manifest.integrity[`server/${ADAPTER_FILE}`]).toMatch(/^sha256-[a-f0-9]{64}$/);
  expect(Object.keys(manifest.integrity).some(file => file.startsWith('licenses/posthog-js/'))).toBe(true);
  expect(Object.keys(manifest.integrity).some(file => file.startsWith('licenses/posthog-node/'))).toBe(true);
});
