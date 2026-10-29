/** `scripts/build.ts` failure and license paths against throwaway package roots (no network, no workspace writes). */
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProviderPlugins } from '../../scripts/build.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

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
  const [entry] = await buildProviderPlugins({ packageRoot: root });
  const licenses = path.join(root, entry!.path, 'licenses', 'bare');
  expect(await readFile(path.join(licenses, 'COPYING'), 'utf8')).toBe('shared MIT text');
  expect(await readFile(path.join(licenses, 'LICENSE-SOURCE'), 'utf8'))
    .toBe('License text copied from licensed@1.0.0 (same repository and declared license).\n');
  expect(JSON.parse(await readFile(path.join(licenses, 'package-license.json'), 'utf8')))
    .toEqual({ name: 'bare', version: '1.0.0', license: 'MIT' });
});

it('builds into the package root by default, versioning each artifact from the distribution', async () => {
  const root = await packageRoot({ id: 'alpha' });
  const catalog = await buildProviderPlugins({ packageRoot: root });
  expect(catalog).toEqual([{ id: 'alpha', version: '1.2.3', path: 'plugins/alpha/1.2.3' }]);
  expect(JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'))).toEqual(catalog);
  const manifest = JSON.parse(await readFile(path.join(root, 'plugins/alpha/1.2.3/jini.plugin.json'), 'utf8')) as { version: string; integrity: Record<string, string> };
  expect(manifest.version).toBe('1.2.3');
  expect(Object.keys(manifest.integrity).sort()).toEqual(['licenses/fixture-distribution/LICENSE', 'licenses/fixture-distribution/package-license.json', 'server/index.mjs']);
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it('refuses a plugin directory whose manifest names another id, and leaves no staging behind', async () => {
  const root = await packageRoot({ id: 'alpha', manifestId: 'beta' });
  await expect(buildProviderPlugins({ packageRoot: root })).rejects.toThrow('Plugin directory and manifest id must agree');
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it('refuses to ship a bundled package with no license text', async () => {
  const root = await packageRoot({ id: 'alpha', license: false });
  await expect(buildProviderPlugins({ packageRoot: root })).rejects.toThrow('Missing license text for bundled package fixture-distribution');
});

it('takes a reviewed supplement for a bundled package that ships no license, recording where it came from', async () => {
  const root = await packageRoot({ id: 'alpha', entry: "import { value } from 'licenseless';\nexport default { definition: { setup() { void value; } } };\n" });
  const vendored = path.join(root, 'node_modules', 'licenseless');
  await mkdir(vendored, { recursive: true });
  await writeFile(path.join(vendored, 'package.json'), JSON.stringify({ name: 'licenseless', version: '9.0.0', license: 'MIT', main: 'index.js', repository: 'git+https://github.com/example/licenseless.git' }));
  await writeFile(path.join(vendored, 'index.js'), 'exports.value = 1;\n');
  await expect(buildProviderPlugins({ packageRoot: root })).rejects.toThrow('Missing license text for bundled package licenseless');
  const supplement = path.join(root, 'license-supplements', 'github.com_example_licenseless');
  await mkdir(supplement, { recursive: true });
  await writeFile(path.join(supplement, 'LICENSE'), 'MIT upstream');
  await writeFile(path.join(supplement, 'SOURCE'), 'fixture');
  const [entry] = await buildProviderPlugins({ packageRoot: root }, { outputRoot: path.join(root, 'out') });
  const licenses = path.join(root, 'out', entry!.path, 'licenses', 'licenseless');
  expect(await readFile(path.join(licenses, 'LICENSE'), 'utf8')).toBe('MIT upstream');
  expect(await readFile(path.join(licenses, 'LICENSE-SOURCE'), 'utf8')).toMatch(/^License text copied from https:\/\/github\.com\/example\/licenseless \(license supplement\)@reviewed/);
});

it('a supplement directory without a LICENSE grants nothing; a package with no repository cannot use one', async () => {
  const root = await packageRoot({ id: 'alpha', entry: "import { value } from 'norepo';\nexport default { definition: { setup() { void value; } } };\n" });
  const vendored = path.join(root, 'node_modules', 'norepo');
  await mkdir(vendored, { recursive: true });
  await writeFile(path.join(vendored, 'package.json'), JSON.stringify({ name: 'norepo', version: '1.0.0', license: 'MIT', main: 'index.js' }));
  await writeFile(path.join(vendored, 'index.js'), 'exports.value = 1;\n');
  await expect(buildProviderPlugins({ packageRoot: root })).rejects.toThrow('Missing license text for bundled package norepo');
  await writeFile(path.join(vendored, 'package.json'), JSON.stringify({ name: 'norepo', version: '1.0.0', license: 'MIT', main: 'index.js', repository: { url: 'https://github.com/example/norepo' } }));
  await mkdir(path.join(root, 'license-supplements', 'github.com_example_norepo'), { recursive: true });
  await expect(buildProviderPlugins({ packageRoot: root })).rejects.toThrow('Missing license text for bundled package norepo');
});
