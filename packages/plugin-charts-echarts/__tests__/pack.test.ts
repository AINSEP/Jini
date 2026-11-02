import { parseNpmPackJson } from '../../../scripts/lib/npm-pack-json.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { computePluginIntegrity } from '@jini-ai/plugins/host/node';
import type { PluginManifest } from '@jini-ai/plugins/host';
import { buildProviderPlugin } from '../../../scripts/testing/provider-plugin.js';
import { assertPluginPackageIsolation } from '../../../scripts/check-plugin-isolation.js';
import { assembleAgentPluginPackage } from '../../../scripts/assemble-agent-plugin-package.js';
import { agentPluginRowsForPackage, type AgentPluginPackageRow } from '../../../scripts/lib/agent-plugin-packages.js';
import { generateCatalog } from '../../plugin-catalog/scripts/generate.js';

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../../provider-plugins/', import.meta.url));
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const id = 'charts-echarts';
const packageName = '@jini-ai/plugin-charts-echarts';
const documents = ['package.json', 'README.md', 'LICENSE', 'NOTICE'];
// The face shares the provider's local id (a slot is family plus local id) and has its own publisher id.
const row: AgentPluginPackageRow = { name: id, sourceDir: `packages/agent-plugins/${id}` };
const faceFiles = ['plugin.json', `skills/${id}/SKILL.md`].map(file => `${id}/${file}`);
let root: string;
let distribution: string;
let installed: string;
let artifactPath: string;
let packedFiles: string[];
let manifest: PluginManifest;

beforeAll(async () => {
  // Match Node's canonical resolution when TMPDIR traverses symlinks (macOS /var).
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'charts-echarts-pack-')));
  distribution = path.join(root, 'distribution');
  await mkdir(distribution);
  for (const name of documents) await copyFile(path.join(packageRoot, name), path.join(distribution, name));
  // Both builders run, as in the package's build/prepack, into one scratch distribution.
  artifactPath = (await buildProviderPlugin({ packageRoot: sourceRoot, id, destinationPackageRoot: distribution })).path;
  await assembleAgentPluginPackage({ sourceDir: path.join(workspace, row.sourceDir), packageRoot }, { outputRoot: distribution, rows: [row] });
  // Lifecycle suppression keeps pack inspection from rewriting the checkout.
  const packed = await exec('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache')], { cwd: distribution });
  const tarball = path.join(distribution, parseNpmPackJson({ stdout: packed.stdout }).filename);
  const inventory = await exec('tar', ['-tzf', tarball]);
  packedFiles = inventory.stdout.trim().split('\n').filter(name => !name.endsWith('/')).map(name => name.replace(/^package\//, '')).sort();
  installed = path.join(root, 'node_modules', packageName);
  await mkdir(installed, { recursive: true });
  await exec('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1']);
  manifest = JSON.parse(await readFile(path.join(installed, artifactPath, 'jini.plugin.json'), 'utf8')) as PluginManifest;
}, 120_000);
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('packs exactly the provider artifact, the face and provenance, with no runtime dependency or install hook', async () => {
  const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  expect(pkg.name).toBe(packageName);
  expect(artifactPath).toBe(`plugins/${id}/${pkg.version}`);
  expect(packedFiles).toEqual([...documents, `${artifactPath}/jini.plugin.json`,
    ...Object.keys(manifest.integrity).map(file => `${artifactPath}/${file}`), ...faceFiles].sort());
  expect(packedFiles.filter(file => /(?:^|\/)(?:src|tests|__tests__|node_modules|coverage|\.cache)(?:\/|$)|\.(?:map|ts|tsx|tsbuildinfo)$/.test(file))).toEqual([]);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) expect(pkg[field]).toBeUndefined();
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(pkg.scripts[hook]).toBeUndefined();
  const command = `node --import tsx ../provider-plugins/scripts/build.ts ${id} . && node --import tsx ../../scripts/assemble-agent-plugin-package.ts ${id}`;
  expect(pkg.scripts.build).toBe(command);
  expect(pkg.scripts.prepack).toBe(command);
});

it('keeps the browser-only provider contract under verified integrity', async () => {
  const source = JSON.parse(await readFile(path.join(sourceRoot, 'src', id, 'jini.plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  expect(manifest).toEqual({ ...source, version: pkg.version, integrity: manifest.integrity });
  expect(manifest.integrity).toEqual(await computePluginIntegrity({ sourceDir: path.join(installed, artifactPath) }));
  expect(manifest.contributes).toBeUndefined();
  for (const file of ['client/provider.js', 'client/styles.css']) expect(manifest.integrity[file]).toMatch(/^sha256-[a-f0-9]{64}$/);
});

// ECharts (Apache-2.0, with its NOTICE), ZRender (BSD-3-Clause) and tslib (0BSD) are bundled into the client
// module; their texts must travel inside the artifact under the integrity map.
it('retains the bundled ECharts, ZRender and tslib license texts under integrity', () => {
  const licensed = Object.keys(manifest.integrity).filter(file => file.startsWith('licenses/'));
  for (const owner of ['echarts', 'zrender', 'tslib']) expect(licensed.some(file => file.startsWith(`licenses/${owner}/`)), owner).toBe(true);
  expect(licensed).toContain('licenses/echarts/NOTICE');
});

it('resolves the face through ./plugin.json and the provider through ./plugins/* with no sibling installed', async () => {
  const resolve = createRequire(path.join(root, 'host.cjs')).resolve;
  // Node resolves symlinks; macOS's /var scratch path aliases /private/var.
  expect(await realpath(resolve(`${packageName}/plugin.json`))).toBe(await realpath(path.join(installed, id, 'plugin.json')));
  const skill = `${id}/skills/${id}/SKILL.md`;
  expect(await realpath(resolve(`${packageName}/${skill}`))).toBe(await realpath(path.join(installed, skill)));
  expect(await realpath(resolve(`${packageName}/${artifactPath}/client/provider.js`))).toBe(await realpath(path.join(installed, artifactPath, 'client/provider.js')));
  const face = JSON.parse(await readFile(resolve(`${packageName}/plugin.json`), 'utf8'));
  expect(face).toEqual(JSON.parse(await readFile(path.join(workspace, row.sourceDir, 'plugin.json'), 'utf8')));
  expect(face.extensions.tovu.providerPlugin).toBe(id);
  expect(await readdir(path.join(root, 'node_modules/@jini-ai'))).toEqual([`plugin-${id}`]);
});

it('isolation accepts both payload roots and refuses another face or a third root', async () => {
  const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  const pluginIds = [id, 'charts-recharts'];
  const ports = { agentPluginPackages: [row] };
  expect(() => assertPluginPackageIsolation({ manifest: pkg, packedPaths: packedFiles, pluginIds }, ports)).not.toThrow();
  expect(() => assertPluginPackageIsolation({ manifest: pkg, packedPaths: [...packedFiles, 'charts-recharts/plugin.json'], pluginIds }, ports))
    .toThrow(/another plugin's payload/);
  expect(() => assertPluginPackageIsolation({ manifest: pkg, packedPaths: [...packedFiles, 'extras/notes.md'], pluginIds }, ports))
    .toThrow(/unexpected packed file/);
});

it('catalogs the face and the provider as two entries of this package with distinct publisher ids', async () => {
  // Real sources and package metadata; payload reads go to the scratch distribution built above.
  const built = (file: string) => (file.startsWith(packageRoot) ? path.join(distribution, path.relative(packageRoot, file)) : file);
  const entries = await generateCatalog({
    packagesRoot: path.dirname(packageRoot), providerIds: [id], agentPlugins: [row],
    ports: {
      readJson: async file => JSON.parse(await readFile(built(file), 'utf8')) as unknown,
      integrity: ({ sourceDir }) => computePluginIntegrity({ sourceDir: built(sourceDir) }),
    },
  });
  expect(entries.map(entry => [entry.kind, entry.id, entry.packageName, entry.path, entry.publisherIdentity, entry.contract])).toEqual([
    ['agent', id, packageName, id, 'jini/charts-echarts-agent', { id: 'agent-plugins', version: '1.0.0' }],
    ['provider', id, packageName, artifactPath, 'jini/charts-echarts', { id: 'browser-provider:chart', version: 1 }],
  ]);
});

// Fails until INT adds the layout row; the build script and the release catalog read the table.
it('the reviewed layout table ships this face from this package', () => {
  expect(agentPluginRowsForPackage({ packageId: id })).toEqual([row]);
});
