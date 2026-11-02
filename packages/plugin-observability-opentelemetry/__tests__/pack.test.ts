import { parseNpmPackJson } from '../../../scripts/lib/npm-pack-json.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { computePluginIntegrity } from '@jini-ai/plugins/host/node';
import type { PluginManifest } from '@jini-ai/plugins/host';
import { buildProviderPlugin } from '../../../scripts/testing/provider-plugin.js';
import { assertPluginPackageIsolation } from '../../../scripts/check-plugin-isolation.js';
import { assembleAgentPluginPackage } from '../../../scripts/assemble-agent-plugin-package.js';
import { agentPluginRowsForPackage } from '../../../scripts/lib/agent-plugin-packages.js';
import { generateCatalog } from '../../plugin-catalog/scripts/generate.js';

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../../provider-plugins/', import.meta.url));
const id = 'observability-opentelemetry';
const packageName = '@jini-ai/plugin-observability-opentelemetry';
const documents = ['package.json', 'README.md', 'LICENSE', 'NOTICE'];
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
// The agent face this package ships next to its provider (layout table row, packageId = provider id).
const face = 'opentelemetry';
const faceFiles = ['mcp.json', 'plugin.json', `skills/${face}/SKILL.md`].map(file => `${face}/${file}`);
let root: string;
let distribution: string;
let installed: string;
let artifact: string;
let artifactPath: string;
let packedFiles: string[];
let manifest: PluginManifest;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'observability-opentelemetry-pack-'));
  distribution = path.join(root, 'distribution');
  await mkdir(distribution);
  for (const name of documents) await copyFile(path.join(packageRoot, name), path.join(distribution, name));
  const entry = await buildProviderPlugin({ packageRoot: sourceRoot, id, destinationPackageRoot: distribution });
  artifactPath = entry.path;
  // Both builders run, as in the package's build/prepack: the face lands in the same scratch distribution.
  for (const row of agentPluginRowsForPackage({ packageId: id })) {
    await assembleAgentPluginPackage({ sourceDir: path.join(workspace, row.sourceDir), packageRoot }, { outputRoot: distribution });
  }
  // Build in scratch first; lifecycle suppression keeps pack inspection from rewriting the checkout.
  const packed = await exec('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache')], { cwd: distribution });
  const result = parseNpmPackJson({ stdout: packed.stdout });
  const tarball = path.join(distribution, result.filename);
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
  expect(packedFiles).toEqual([...documents, ...faceFiles, `${artifactPath}/jini.plugin.json`,
    ...Object.keys(manifest.integrity).map(file => `${artifactPath}/${file}`)].sort());
  assertPluginPackageIsolation({ manifest: pkg, packedPaths: packedFiles, pluginIds: [id] });
  expect(packedFiles.filter(file => /(?:^|\/)(?:src|tests|__tests__|node_modules|coverage|\.cache)(?:\/|$)|\.(?:map|ts|tsx|tsbuildinfo)$/.test(file))).toEqual([]);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) expect(pkg[field]).toBeUndefined();
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(pkg.scripts[hook]).toBeUndefined();
  const command = `node --import tsx ../provider-plugins/scripts/build.ts ${id} . && node --import tsx ../../scripts/assemble-agent-plugin-package.ts ${id}`;
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
  // Node resolves symlinks; macOS's /var scratch path aliases /private/var.
  expect(await realpath(resolve(`${packageName}/package.json`))).toBe(await realpath(path.join(installed, 'package.json')));
  expect(await realpath(resolve(`${packageName}/${artifactPath}/server/index.mjs`))).toBe(await realpath(path.join(artifact, 'server/index.mjs')));
  expect(await readdir(path.join(root, 'node_modules/@jini-ai'))).toEqual([`plugin-${id}`]);
});


it.each([undefined, false, true])('installed OTel artifact gates injected export processors with exportEnabled=%s', async exportEnabled => {
  const { createOpenTelemetryProvider } = await import(pathToFileURL(path.join(artifact, 'server/index.mjs')).href);
  const spans: unknown[] = [];
  const resource = createOpenTelemetryProvider({ serviceName: 'fixture', endpoint: 'https://collector.invalid' }, {
    exportEnabled, metricReaders: [],
    spanProcessors: [{ onStart() {}, onEnd(span: unknown) { spans.push(span); }, async shutdown() {}, async forceFlush() {} }],
  });
  try {
    const op = resource.port.trackOperation({ name: 'telemetry.test' });
    op.run(() => resource.port.reportError({ error: new Error('test error'), context: { operation: 'telemetry.test' } }));
    op.end({ outcome: 'failed', failed: true });
    expect(resource.port.supportsMetric).toBe(true);
    resource.port.metric({ name: 'local.gauge', value: 1 });
  } finally { await resource.dispose({}); }
  expect(spans.length).toBe(exportEnabled === true ? 1 : 0);
});

it('ships its agent face from the layout table and resolves it through ./plugin.json with no sibling installed', async () => {
  expect(agentPluginRowsForPackage({ packageId: id }).map(row => row.name)).toEqual([face]);
  const resolve = createRequire(path.join(root, 'host.cjs')).resolve;
  // Node resolves symlinks; macOS's /var scratch path aliases /private/var.
  expect(await realpath(resolve(`${packageName}/plugin.json`))).toBe(await realpath(path.join(installed, face, 'plugin.json')));
  const skill = `${face}/skills/${face}/SKILL.md`;
  expect(await realpath(resolve(`${packageName}/${skill}`))).toBe(await realpath(path.join(installed, skill)));
  const faceManifest = JSON.parse(await readFile(resolve(`${packageName}/plugin.json`), 'utf8'));
  expect(faceManifest).toEqual(JSON.parse(await readFile(path.join(workspace, 'packages/agent-plugins', face, 'plugin.json'), 'utf8')));
  expect(faceManifest.extensions.tovu.providerPlugin).toBe(id);
});

it('isolation accepts both payload roots and refuses another face or a third root', async () => {
  const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  const pluginIds = [id, 'sentry'];
  expect(() => assertPluginPackageIsolation({ manifest: pkg, packedPaths: packedFiles, pluginIds })).not.toThrow();
  expect(() => assertPluginPackageIsolation({ manifest: pkg, packedPaths: [...packedFiles, 'sentry/plugin.json'], pluginIds }))
    .toThrow(/another plugin's payload/);
  expect(() => assertPluginPackageIsolation({ manifest: pkg, packedPaths: [...packedFiles, 'extras/notes.md'], pluginIds }))
    .toThrow(/unexpected packed file/);
});

it('catalogs the provider and its face as two entries of this one package with distinct publisher ids', async () => {
  // Real sources and package metadata; payload reads go to the scratch distribution built above.
  const built = (file: string) => (file.startsWith(packageRoot) ? path.join(distribution, path.relative(packageRoot, file)) : file);
  const entries = await generateCatalog({
    packagesRoot: path.dirname(packageRoot), providerIds: [id], agentPlugins: agentPluginRowsForPackage({ packageId: id }),
    ports: {
      readJson: async file => JSON.parse(await readFile(built(file), 'utf8')) as unknown,
      integrity: ({ sourceDir }) => computePluginIntegrity({ sourceDir: built(sourceDir) }),
    },
  });
  expect(entries.map(entry => [entry.kind, entry.id, entry.packageName, entry.path, entry.publisherIdentity])).toEqual([
    ['provider', id, packageName, artifactPath, `jini/${id}`],
    ['agent', face, packageName, face, `tovu/${face}`],
  ]);
  expect(Object.keys(entries[1]!.expectedDigests!)).toContain(`skills/${face}/SKILL.md`);
});
