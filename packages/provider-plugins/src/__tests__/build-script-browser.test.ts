/** `scripts/build.ts` manifest-driven `browserProviders` bundling against throwaway package roots
 * (no network, no workspace writes). Server-only builds keep their exact integrity maps in build-script.test.ts. */
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateBrowserProviders } from '@jini-ai/plugins/host';
import { buildProviderPlugin } from '../../scripts/build.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const ID = 'charts-fixture';
const MANIFEST = { id: ID, name: 'Chart fixture', version: '0.0.0', sdkRange: '^0.1.0', engine: 1, tier: 'tier-3', capabilities: [], hooks: [], fields: [], integrity: {} };
const CHART = { id: 'plugin.fixture', kind: 'chart', contractVersion: 1, kinds: ['bar'], javascript: 'client/provider.js', stylesheet: 'client/styles.css' };
const PROVIDER = "import { draw } from 'tiny-chart';\nimport { label } from './helper';\nexport const mode = process.env.NODE_ENV;\n"
  + 'export class Provider { #secret = 1; read() { return [draw, label, this.#secret]; } }\n';

/** A distribution root with one browser-only source: a no-op server entry plus the given client files. */
async function browserPackage(required: { client: Record<string, string>; browserProviders?: readonly object[] }, _optional = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'provider-browser-build-')); roots.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-distribution', version: '1.2.3', license: 'MIT' }));
  await writeFile(path.join(root, 'LICENSE'), 'MIT fixture');
  const source = path.join(root, 'src', ID);
  await mkdir(path.join(source, 'client'), { recursive: true });
  await writeFile(path.join(source, 'jini.plugin.json'), JSON.stringify({ ...MANIFEST, browserProviders: required.browserProviders ?? [CHART] }));
  await writeFile(path.join(source, 'index.ts'), 'export default { definition: { setup() {} } };\n');
  for (const [file, text] of Object.entries(required.client)) await writeFile(path.join(source, 'client', file), text);
  const vendored = path.join(root, 'node_modules', 'tiny-chart');
  await mkdir(vendored, { recursive: true });
  await writeFile(path.join(vendored, 'package.json'), JSON.stringify({ name: 'tiny-chart', version: '2.0.0', license: 'MIT', main: 'index.js' }));
  await writeFile(path.join(vendored, 'index.js'), 'exports.draw = function draw() { return 1; };\n');
  await writeFile(path.join(vendored, 'LICENSE'), 'tiny-chart MIT text');
  return root;
}

/** An existing completed payload whose exact bytes must survive any failed build. */
async function previousPayload(required: { root: string }, _optional = {}): Promise<string> {
  const previous = path.join(required.root, `plugins/${ID}/0.0.1/server/index.mjs`);
  await mkdir(path.dirname(previous), { recursive: true });
  await writeFile(previous, 'previous completed payload');
  return previous;
}

const VALID_CLIENT = { 'provider.ts': PROVIDER, 'helper.ts': "export const label = 'fixture';\n",
  'styles.css': "@import './palette.css';\n[data-chart-provider=\"plugin.fixture\"] { color: var(--chart-1); }\n",
  'palette.css': '[data-chart-provider="plugin.fixture"] { --chart-1: red; }\n' };

it('bundles every declared client asset for the browser, retains its licenses and pins it in the integrity map', async () => {
  const second = { id: 'plugin.second', kind: 'chart', contractVersion: 1, kinds: ['line'], javascript: 'client/second.js' };
  const root = await browserPackage({ client: { ...VALID_CLIENT, 'second.tsx': "export const kind: string = 'tsx';\n" }, browserProviders: [CHART, second] });
  const entry = await buildProviderPlugin({ packageRoot: root, id: ID, destinationPackageRoot: root });
  const artifact = path.join(root, entry.path);
  expect((await readdir(path.join(artifact, 'client'))).sort()).toEqual(['provider.js', 'second.js', 'styles.css']);
  const manifest = JSON.parse(await readFile(path.join(artifact, 'jini.plugin.json'), 'utf8')) as typeof MANIFEST & { browserProviders: unknown; integrity: Record<string, string> };
  expect(manifest.browserProviders).toEqual([CHART, second]);
  expect(Object.keys(manifest.integrity).sort()).toEqual(['client/provider.js', 'client/second.js', 'client/styles.css',
    'licenses/fixture-distribution/LICENSE', 'licenses/fixture-distribution/package-license.json',
    'licenses/tiny-chart/LICENSE', 'licenses/tiny-chart/package-license.json', 'server/index.mjs']);
  for (const [file, digest] of Object.entries(manifest.integrity)) {
    expect(`sha256-${createHash('sha256').update(await readFile(path.join(artifact, file))).digest('hex')}`).toBe(digest);
  }
  // The host's own admission check accepts what the builder sealed.
  expect(validateBrowserProviders({ browserProviders: manifest.browserProviders, integrity: manifest.integrity })).toEqual([]);
  expect(await readFile(path.join(artifact, 'licenses/tiny-chart/LICENSE'), 'utf8')).toBe('tiny-chart MIT text');
  const js = await readFile(path.join(artifact, 'client/provider.js'), 'utf8');
  expect(js).toMatch(/export\s*\{/);
  expect(js).toContain('"production"');
  expect(js).not.toContain('process.env');
  expect(js).not.toMatch(/\n\s{2,}/); // minified
  // es2022 keeps native private fields; an older target would lower them to WeakMap helpers.
  expect(js).toMatch(/#[A-Za-z_$]/);
  expect(js).not.toContain('WeakMap');
  expect(js).not.toMatch(/\bfrom\s*["']|\bimport\s*\(|\brequire\s*\(/);
  const css = await readFile(path.join(artifact, 'client/styles.css'), 'utf8');
  expect(css).toContain('--chart-1');
  expect(css).not.toContain('@import');
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it.each([
  ['a script URL import', { 'provider.ts': "export const load = () => import('https://cdn.example/chart.js');\n" },
    'Browser provider asset client/provider.js keeps a runtime import: https://cdn.example/chart.js'],
  ['a stylesheet URL import', { 'styles.css': '@import "https://fonts.example/a.css";\n.a { color: red; }\n' },
    'Browser provider asset client/styles.css keeps a runtime import: https://fonts.example/a.css'],
  // The server bundle's Node-builtin allowance never applies: esbuild cannot resolve one for the browser.
  ['a Node builtin', { 'provider.ts': "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n" }, 'Build failed'],
])('rejects %s and keeps the completed payload', async (_case, override, message) => {
  const root = await browserPackage({ client: { ...VALID_CLIENT, ...override } });
  const previous = await previousPayload({ root });
  await expect(buildProviderPlugin({ packageRoot: root, id: ID, destinationPackageRoot: root })).rejects.toThrow(message);
  expect(await readFile(previous, 'utf8')).toBe('previous completed payload');
  expect(await readdir(path.join(root, `plugins/${ID}`))).toEqual(['0.0.1']);
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it.each([
  ['client/../server/index.js', 'Browser provider asset must be a client/ script or stylesheet: client/../server/index.js'],
  ['server/provider.js', 'Browser provider asset must be a client/ script or stylesheet: server/provider.js'],
  ['client/provider.ts', 'Browser provider asset must be a client/ script or stylesheet: client/provider.ts'],
  ['client/missing.js', 'No browser provider source for client/missing.js'],
])('refuses the declared script %s before publishing anything', async (javascript, message) => {
  const root = await browserPackage({ client: VALID_CLIENT, browserProviders: [{ ...CHART, javascript }] });
  const previous = await previousPayload({ root });
  await expect(buildProviderPlugin({ packageRoot: root, id: ID, destinationPackageRoot: root })).rejects.toThrow(message);
  expect(await readFile(previous, 'utf8')).toBe('previous completed payload');
  expect((await readdir(root)).filter(name => name.startsWith('.provider-build-'))).toEqual([]);
});

it('fails the build, not later admission, on a declaration the host would refuse', async () => {
  const root = await browserPackage({ client: VALID_CLIENT, browserProviders: [{ ...CHART, contractVersion: 2 }] });
  await expect(buildProviderPlugin({ packageRoot: root, id: ID, destinationPackageRoot: root }))
    .rejects.toThrow('Invalid browserProviders: Only chart contractVersion 1 is supported.');
  expect(await readdir(root)).not.toContain('plugins');
});
