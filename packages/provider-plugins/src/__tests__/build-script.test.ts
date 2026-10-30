/** `scripts/build.ts` failure and license paths against throwaway package roots (no network, no workspace writes). */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildProviderPlugin } from '../../scripts/build.js';

vi.mock('node:fs/promises', async importOriginal => {
  const filesystem = await importOriginal<typeof import('node:fs/promises')>();
  return { ...filesystem, rename: vi.fn(filesystem.rename) };
});

const roots: string[] = [];
afterEach(async () => {
  const filesystem = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(filesystem.rename);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const MANIFEST = { name: 'X', version: '0.0.0', sdkRange: '^0.1.0', engine: 1, tier: 'tier-3', capabilities: [], hooks: [], fields: [], integrity: {} };

/** A minimal distribution root with one plugin source whose entry imports `entry`. */
async function packageRoot(required: { id: string; manifestId?: string; license?: boolean; entry?: string }): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'provider-build-')); roots.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-distribution', version: '1.2.3', license: 'MIT' }));
  if (required.license !== false) await writeFile(path.join(root, 'LICENSE'), 'MIT fixture');
  const source = path.join(root, 'src', required.id);
  await mkdir(source, { recursive: true });
  await mkdir(path.join(root, 'src', '__tests__'));
  await writeFile(path.join(source, 'jini.plugin.json'), JSON.stringify({ ...MANIFEST, id: required.manifestId ?? required.id }));
  await writeFile(path.join(source, 'index.ts'), required.entry ?? 'export default { definition: { setup() {} } };\n');
  return root;
}

it('retains a sibling license across string and object spellings of the same repository', async () => {
  const root = await packageRoot({ id: 'alpha', entry:
    "import { left } from 'licensed'; import { right } from 'bare'; export default { definition: { setup() { return [left, right]; } } };" });
  for (const [name, repository, symbol] of [
    ['licensed', 'git+https://github.com/example/shared.git', 'left'],
    ['bare', { url: 'https://github.com/example/shared' }, 'right'],
  ] as const) {
    const directory = path.join(root, 'node_modules', name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0',
      license: 'MIT', repository, main: 'index.js' }));
    await writeFile(path.join(directory, 'index.js'), `exports.${symbol} = 1;`);
  }
  await writeFile(path.join(root, 'node_modules/licensed/COPYING'), 'shared MIT text');
  // A nameless nearest manifest does not take ownership from the distribution manifest.
  await writeFile(path.join(root, 'src/alpha/package.json'), '{}');
  const entry = await buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root });
  const licenses = path.join(root, entry.path, 'licenses', 'bare');
  expect(await readFile(path.join(licenses, 'COPYING'), 'utf8')).toBe('shared MIT text');
  expect(await readFile(path.join(licenses, 'LICENSE-SOURCE'), 'utf8'))
    .toBe('License text copied from licensed@1.0.0 (same repository and declared license).\n');
  expect(JSON.parse(await readFile(path.join(licenses, 'package-license.json'), 'utf8')))
    .toEqual({ name: 'bare', version: '1.0.0', license: 'MIT' });
});

it('builds into the package root by default, versioning the selected artifact from the destination', async () => {
  const root = await packageRoot({ id: 'alpha' });
  const entry = await buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root });
  expect(entry).toEqual({ id: 'alpha', version: '1.2.3', path: 'plugins/alpha/1.2.3' });
  expect(await readdir(root)).not.toContain('catalog.json');
  const manifest = JSON.parse(await readFile(path.join(root, 'plugins/alpha/1.2.3/jini.plugin.json'), 'utf8')) as { version: string; integrity: Record<string, string> };
  expect(manifest.version).toBe('1.2.3');
  expect(Object.keys(manifest.integrity).sort()).toEqual(['licenses/fixture-distribution/LICENSE', 'licenses/fixture-distribution/package-license.json', 'server/index.mjs']);
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it('refuses a plugin directory whose manifest names another id, and leaves no staging behind', async () => {
  const root = await packageRoot({ id: 'alpha', manifestId: 'beta' });
  await expect(buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root })).rejects.toThrow('Plugin directory and manifest id must agree');
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it('refuses to ship a bundled package with no license text', async () => {
  const root = await packageRoot({ id: 'alpha', license: false });
  await expect(buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root })).rejects.toThrow('Missing license text for bundled package fixture-distribution');
});

it('takes a reviewed supplement for a bundled package that ships no license, recording where it came from', async () => {
  const root = await packageRoot({ id: 'alpha', entry: "import { value } from 'licenseless';\nexport default { definition: { setup() { void value; } } };\n" });
  const vendored = path.join(root, 'node_modules', 'licenseless');
  await mkdir(vendored, { recursive: true });
  await writeFile(path.join(vendored, 'package.json'), JSON.stringify({ name: 'licenseless', version: '9.0.0', license: 'MIT', main: 'index.js', repository: 'git+https://github.com/example/licenseless.git' }));
  await writeFile(path.join(vendored, 'index.js'), 'exports.value = 1;\n');
  await expect(buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root })).rejects.toThrow('Missing license text for bundled package licenseless');
  const supplement = path.join(root, 'license-supplements', 'github.com_example_licenseless');
  await mkdir(supplement, { recursive: true });
  await writeFile(path.join(supplement, 'LICENSE'), 'MIT upstream');
  await writeFile(path.join(supplement, 'SOURCE'), 'fixture');
  const entry = await buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root }, { outputRoot: path.join(root, 'out') });
  const licenses = path.join(root, 'out', entry.path, 'licenses', 'licenseless');
  expect(await readFile(path.join(licenses, 'LICENSE'), 'utf8')).toBe('MIT upstream');
  expect(await readFile(path.join(licenses, 'LICENSE-SOURCE'), 'utf8')).toMatch(/^License text copied from https:\/\/github\.com\/example\/licenseless \(license supplement\)@reviewed/);
});

it('a supplement directory without a LICENSE grants nothing; a package with no repository cannot use one', async () => {
  const root = await packageRoot({ id: 'alpha', entry: "import { value } from 'norepo';\nexport default { definition: { setup() { void value; } } };\n" });
  const vendored = path.join(root, 'node_modules', 'norepo');
  await mkdir(vendored, { recursive: true });
  await writeFile(path.join(vendored, 'package.json'), JSON.stringify({ name: 'norepo', version: '1.0.0', license: 'MIT', main: 'index.js' }));
  await writeFile(path.join(vendored, 'index.js'), 'exports.value = 1;\n');
  await expect(buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root })).rejects.toThrow('Missing license text for bundled package norepo');
  await writeFile(path.join(vendored, 'package.json'), JSON.stringify({ name: 'norepo', version: '1.0.0', license: 'MIT', main: 'index.js', repository: { url: 'https://github.com/example/norepo' } }));
  await mkdir(path.join(root, 'license-supplements', 'github.com_example_norepo'), { recursive: true });
  await expect(buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root })).rejects.toThrow('Missing license text for bundled package norepo');
});

it.each([false, true])('builds only the requested source with destination version and attribution (scratch: %s)', async scratch => {
  const root = await packageRoot({ id: 'alpha' });
  await writeFile(path.join(root, 'NOTICE'), 'Open SaaS attribution belongs only to Stripe');
  const sibling = path.join(root, 'src/beta');
  await mkdir(sibling);
  await writeFile(path.join(sibling, 'index.ts'), 'this is not valid TypeScript');
  const destinationPackageRoot = path.join(root, 'plugin-alpha');
  await mkdir(destinationPackageRoot);
  await writeFile(path.join(destinationPackageRoot, 'package.json'), JSON.stringify({ name: '@jini-ai/plugin-alpha', version: '0.7.0', license: 'MIT' }));
  await writeFile(path.join(destinationPackageRoot, 'LICENSE'), 'Alpha MIT text');
  await writeFile(path.join(destinationPackageRoot, 'NOTICE'), 'Alpha attribution');
  const outputRoot = scratch ? path.join(root, 'scratch') : destinationPackageRoot;
  const entry = await buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot }, scratch ? { outputRoot } : {});
  expect(entry).toEqual({ id: 'alpha', version: '0.7.0', path: 'plugins/alpha/0.7.0' });
  expect(await readdir(path.join(outputRoot, 'plugins'))).toEqual(['alpha']);
  expect(await readdir(path.join(outputRoot, 'plugins/alpha'))).toEqual(['0.7.0']);
  expect(await readdir(outputRoot)).not.toContain('catalog.json');
  const artifact = path.join(outputRoot, entry.path);
  const manifest = JSON.parse(await readFile(path.join(artifact, 'jini.plugin.json'), 'utf8')) as typeof MANIFEST & { id: string; integrity: Record<string, string> };
  expect(manifest).toEqual({ ...MANIFEST, id: 'alpha', version: '0.7.0', integrity: manifest.integrity });
  expect(Object.keys(manifest.integrity).sort()).toEqual(['licenses/_jini-ai_plugin-alpha/LICENSE', 'licenses/_jini-ai_plugin-alpha/NOTICE',
    'licenses/_jini-ai_plugin-alpha/package-license.json', 'server/index.mjs']);
  expect(await readFile(path.join(artifact, 'licenses/_jini-ai_plugin-alpha/NOTICE'), 'utf8')).toBe('Alpha attribution');
  expect(await readFile(path.join(artifact, 'licenses/_jini-ai_plugin-alpha/LICENSE'), 'utf8')).toBe('Alpha MIT text');
  expect(JSON.parse(await readFile(path.join(artifact, 'licenses/_jini-ai_plugin-alpha/package-license.json'), 'utf8')))
    .toEqual({ name: '@jini-ai/plugin-alpha', version: '0.7.0', license: 'MIT' });
  for (const [file, digest] of Object.entries(manifest.integrity)) {
    expect(`sha256-${createHash('sha256').update(await readFile(path.join(artifact, file))).digest('hex')}`).toBe(digest);
  }
  expect(await readFile(path.join(root, 'NOTICE'), 'utf8')).toBe('Open SaaS attribution belongs only to Stripe');
  expect((await readdir(outputRoot)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

/** An existing completed payload whose exact bytes must survive any failed build. */
async function previousPayload(required: { root: string }, _optional = {}): Promise<string> {
  const previous = path.join(required.root, 'plugins/alpha/0.0.1/server/index.mjs');
  await mkdir(path.dirname(previous), { recursive: true });
  await writeFile(previous, 'previous completed payload');
  return previous;
}

it.each(['bundle', 'license'])('preserves completed payloads on %s failure and cleans staging', async failure => {
  const root = await packageRoot({ id: 'alpha', license: failure !== 'license' });
  const previous = await previousPayload({ root });
  if (failure === 'bundle') await writeFile(path.join(root, 'src/alpha/index.ts'), 'not valid TypeScript');
  const pending = buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root });
  if (failure === 'license') await expect(pending).rejects.toThrow('Missing license text for bundled package fixture-distribution');
  else await expect(pending).rejects.toThrow('Build failed');
  expect(await readFile(previous, 'utf8')).toBe('previous completed payload');
  expect(await readdir(path.join(root, 'plugins/alpha'))).toEqual(['0.0.1']);
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it('replaces the completed payload on success without changing reviewed package files', async () => {
  const root = await packageRoot({ id: 'alpha' });
  await previousPayload({ root });
  const before = await readFile(path.join(root, 'package.json'), 'utf8');
  await buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root });
  expect(await readdir(path.join(root, 'plugins/alpha'))).toEqual(['1.2.3']);
  expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(before);
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it('leaves the old payload intact when the backup rename is refused', async () => {
  const root = await packageRoot({ id: 'alpha' });
  const previous = await previousPayload({ root });
  vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('backup refused'), { code: 'EACCES' }));
  await expect(buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root })).rejects.toThrow('backup refused');
  expect(await readFile(previous, 'utf8')).toBe('previous completed payload');
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it.each([false, true])('restores the old payload or retains its recoverable backup on publication failure (rollback fails: %s)', async rollbackFails => {
  const root = await packageRoot({ id: 'alpha' });
  const previous = await previousPayload({ root });
  const filesystem = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockImplementationOnce(filesystem.rename).mockRejectedValueOnce(new Error('publish refused'));
  if (rollbackFails) vi.mocked(rename).mockRejectedValueOnce(new Error('restore refused'));
  await expect(buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root }))
    .rejects.toThrow(rollbackFails ? 'Restore the previous payload from' : 'publish refused');
  const staging = (await readdir(root)).filter(name => name.startsWith('.provider-build-'));
  if (rollbackFails) {
    expect(staging).toHaveLength(1);
    expect(await readFile(path.join(root, staging[0]!, 'previous-plugins/alpha/0.0.1/server/index.mjs'), 'utf8')).toBe('previous completed payload');
  } else {
    expect(await readFile(previous, 'utf8')).toBe('previous completed payload');
    expect(staging).toEqual([]);
  }
});

it.each(['../alpha', 'alpha/beta', ''])('rejects an unsafe plugin id before touching existing output: %s', async id => {
  const root = await packageRoot({ id: 'alpha' });
  const previous = await previousPayload({ root });
  await expect(buildProviderPlugin({ packageRoot: root, id, destinationPackageRoot: root })).rejects.toThrow('Invalid plugin id');
  expect(await readFile(previous, 'utf8')).toBe('previous completed payload');
});

it('rejects a destination version that could escape the versioned directory', async () => {
  const root = await packageRoot({ id: 'alpha' });
  const previous = await previousPayload({ root });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '../escape' }));
  await expect(buildProviderPlugin({ packageRoot: root, id: 'alpha', destinationPackageRoot: root })).rejects.toThrow('Invalid destination package version');
  expect(await readFile(previous, 'utf8')).toBe('previous completed payload');
});
