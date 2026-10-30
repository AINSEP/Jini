/** Standalone publication contract: inspect the tarball built from the real selected source. */
import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePluginIntegrity } from '@jini-ai/plugins/host/node';
import { buildProviderPlugin } from '../../provider-plugins/scripts/build.js';

const id = 'fixture-provider';
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../../provider-plugins', import.meta.url));
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('declares only its artifact exports, build-time contracts, and publication hooks', async () => {
  const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  expect(pkg.name).toBe(`@jini-ai/plugin-${id}`);
  expect(pkg.version).toBe('0.7.0');
  expect(pkg.exports).toEqual({ './package.json': './package.json', './plugins/*': './plugins/*' });
  expect(pkg.files).toEqual(['plugins', 'README.md', 'LICENSE', 'NOTICE']);
  expect(pkg.scripts).toEqual({ build: `node --import tsx ../provider-plugins/scripts/build.ts ${id} .`,
    prepack: `node --import tsx ../provider-plugins/scripts/build.ts ${id} .`, test: 'vitest run' });
  expect(pkg.devDependencies).toEqual({ '@jini-ai/plugins': 'workspace:^', 'tsx': '^4.19.0' });
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) expect(pkg[field] ?? {}).toEqual({});
  expect(pkg.bundledDependencies ?? []).toEqual([]);
  expect(pkg.bundleDependencies ?? []).toEqual([]);
});

it('packs exactly the selected versioned payload with verified integrity and retained attribution', async () => {
  const root = await mkdtemp(path.join(tmpdir(), `${id}-pack-`)); roots.push(root);
  const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const entry = await buildProviderPlugin({ packageRoot: sourceRoot, id, destinationPackageRoot: packageRoot }, { outputRoot: root });
  expect(entry).toEqual({ id, version: pkg.version, path: `plugins/${id}/${pkg.version}` });
  expect(await readdir(path.join(root, 'plugins'))).toEqual([id]);
  for (const name of ['package.json', 'README.md', 'LICENSE', 'NOTICE']) await copyFile(path.join(packageRoot, name), path.join(root, name));
  // Include the real tests in staging so the publication allowlist must actively exclude them.
  await cp(path.join(packageRoot, '__tests__'), path.join(root, '__tests__'), { recursive: true });
  const packed = await exec('npm', ['pack', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache')], { cwd: root });
  const [tarball] = JSON.parse(packed.stdout) as Array<{ filename: string }>;
  const archive = path.join(root, tarball!.filename);
  const listing = await exec('tar', ['-tzf', archive]);
  await exec('tar', ['-xzf', archive, '-C', root]);
  const artifact = path.join(root, 'package', entry.path);
  const manifest = JSON.parse(await readFile(path.join(artifact, 'jini.plugin.json'), 'utf8'));
  const source = JSON.parse(await readFile(path.join(sourceRoot, 'src', id, 'jini.plugin.json'), 'utf8'));
  expect(manifest).toEqual({ ...source, version: pkg.version, integrity: expect.any(Object) });
  expect(manifest.integrity['server/index.mjs']).toMatch(/^sha256-[a-f0-9]{64}$/);
  expect(await computePluginIntegrity({ sourceDir: artifact })).toEqual(manifest.integrity);
  const expected = ['package.json', 'README.md', 'LICENSE', 'NOTICE', `${entry.path}/jini.plugin.json`,
    ...Object.keys(manifest.integrity).map(name => `${entry.path}/${name}`)];
  expect(listing.stdout.trim().split('\n').sort()).toEqual(expected.map(name => `package/${name}`).sort());
  const owner = pkg.name.replace(/[^a-z0-9._-]/gi, '_');
  for (const name of ['LICENSE', 'NOTICE']) {
    const reviewed = await readFile(path.join(packageRoot, name), 'utf8');
    expect(await readFile(path.join(root, 'package', name), 'utf8')).toBe(reviewed);
    expect(await readFile(path.join(artifact, 'licenses', owner, name), 'utf8')).toBe(reviewed);
  }
  expect(await readdir(path.join(artifact, 'licenses'))).toEqual([owner]);
  expect(await readFile(path.join(root, 'package/README.md'), 'utf8')).toContain('For conformance tests only');
  expect(await readFile(path.join(root, 'package/NOTICE'), 'utf8')).not.toContain('Open SaaS');
}, 120_000);
