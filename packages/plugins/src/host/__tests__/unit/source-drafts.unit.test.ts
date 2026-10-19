import { PLUGIN_MANIFEST_FILENAME, LEGACY_PLUGIN_MANIFEST_FILENAME } from '../../plugin-format.js';
import assert from 'node:assert/strict';
import { cp, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { afterEach, test } from 'vitest';
import { createPluginSourceService, PLUGIN_SOURCE_LIMITS } from '../../node/source-drafts.js';
import { computePluginIntegrity, installSitePlugin, previewSitePluginInstall, pruneSitePluginVersions, snapshotSitePluginPackage, type PluginInstallerPort } from '../../node/install.js';
import { addedPluginCapabilities, createPluginSourcePolicy, pluginCapabilitySet } from '../../source-policy.js';
import { discoverPlugins, siteEntryPath } from '../../node/discovery.js';
import { manifestHost, tierPolicy, createInvocationCoreDeps } from '../support/fixture-bindings.js';
import { InMemoryPluginActivationRepo } from '../support/repo.memory.js';
import { loadPlugin } from '../support/loader.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const id = 'site-rules';
const entry = 'export default { definition: { setup(sdk) {} } };\n';
async function fixture(options: { hosted?: boolean; optIn?: boolean; reload?: () => Promise<boolean>; lockProcess?: { pid: number; isAlive: (required: { pid: number }) => boolean } } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-source-test-')); roots.push(root);
  const installDir = path.join(root, 'plugins');
  const repo = new InMemoryPluginActivationRepo();
  const deps = { ...manifestHost, tierPolicy, installDir, builtInIds: ['bundled'], repo,
    archiveReader: async () => { throw new Error('Folder sealing must reuse the folder installer.'); }, conflicts: async () => [] };
  const calls: string[] = [];
  const installer: PluginInstallerPort = {
    preview: async (input, options = {}) => { calls.push('preview'); return previewSitePluginInstall({ ...input, deps: { ...deps, ...options } }); },
    install: async (input, options = {}) => { calls.push('install'); return installSitePlugin({ ...input, deps: { ...deps, ...options } }); },
  };
  const sourceDeps = { ...manifestHost, installDir, builtInIds: ['bundled'], installer,
    policy: createPluginSourcePolicy({ hosted: options.hosted ?? false, localInstallOptIn: options.optIn ?? false }), scaffoldEntry: entry,
    reload: async () => { calls.push('reload'); return options.reload ? options.reload() : false; } };
  const retainedSourceDeps = { ...sourceDeps, pruneVersions: ({ id }: { id: string }) => pruneSitePluginVersions({ id, installDir, repo }) };
  const service = createPluginSourceService(retainedSourceDeps, { temporaryDir: root, ...(options.lockProcess ? { lockPorts: { process: options.lockProcess } } : {}) });
  const draft = path.join(installDir, '.drafts', id);
  const create = () => service.create({ id, name: 'Site rules', description: 'Content rules for this site.' });
  return { root, installDir, repo, deps, installer, sourceDeps: retainedSourceDeps, service, draft, create, calls };
}

test('scaffold has the host SDK contract and loads through real discovery and loader without imports from npm', async () => {
  const f = await fixture(); await f.create();
  assert.equal((await f.service.list({ id })).files.some(file => file.path === PLUGIN_MANIFEST_FILENAME), true);
  assert.equal((await f.service.list({ id })).files.some(file => file.path === LEGACY_PLUGIN_MANIFEST_FILENAME), false); // legacy alias
  const manifest = JSON.parse((await f.service.read({ id, path: PLUGIN_MANIFEST_FILENAME })).content);
  assert.equal(manifest.sdkRange, '^0.1.0'); assert.equal(manifest.engine, 1); assert.equal(manifest.tier, 'tier-3');
  assert.deepEqual(manifest.capabilities, []); assert.deepEqual(manifest.hooks, []); assert.deepEqual(manifest.fields, []);
  assert.deepEqual(manifest.integrity, await computePluginIntegrity({ sourceDir: f.draft }));
  assert.match((await f.service.read({ id, path: 'README.md' })).content, /Content rules for this site/);
  assert.deepEqual(await discoverPlugins({ ...manifestHost, tierPolicy, installDir: f.installDir, builtIns: [] }), [], 'drafts are ignored');
  // Prove the scaffold itself is a valid package before sealing changes it.
  await mkdir(path.join(f.installDir, id), { recursive: true });
  await cp(f.draft, path.join(f.installDir, id, '0.1.0'), { recursive: true });
  const [record] = await discoverPlugins({ ...manifestHost, tierPolicy, installDir: f.installDir, builtIns: [] });
  assert.ok(record);
  assert.equal(record.status, 'valid'); assert.ok(record.manifest);
  const loaded = await loadPlugin({ record, manifest: record.manifest, entryPath: siteEntryPath({ installDir: f.installDir, id, version: '0.1.0' }), coreDeps: createInvocationCoreDeps({ pluginId: id, declaredHooks: [] }).coreDeps });
  assert.equal(loaded.loaded, true);
});

test('draft reads accept legacy manifests, prefer canonical bytes, and write only the canonical filename', async () => {
  const f = await fixture(); await f.create();
  const canonical = (await f.service.read({ id, path: PLUGIN_MANIFEST_FILENAME })).content;
  await writeFile(path.join(f.draft, LEGACY_PLUGIN_MANIFEST_FILENAME), '{'); // legacy alias
  assert.equal((await f.service.read({ id, path: LEGACY_PLUGIN_MANIFEST_FILENAME })).content, canonical); // legacy alias
  await rm(path.join(f.draft, PLUGIN_MANIFEST_FILENAME));
  await writeFile(path.join(f.draft, LEGACY_PLUGIN_MANIFEST_FILENAME), canonical); // legacy alias
  assert.equal((await f.service.read({ id, path: PLUGIN_MANIFEST_FILENAME })).content, canonical);
  await f.service.write({ id, path: LEGACY_PLUGIN_MANIFEST_FILENAME, content: canonical }); // legacy alias
  assert.equal(await readFile(path.join(f.draft, PLUGIN_MANIFEST_FILENAME), 'utf8'), canonical);
  await assert.rejects(readFile(path.join(f.draft, LEGACY_PLUGIN_MANIFEST_FILENAME)), { code: 'ENOENT' }); // legacy alias
});

test('opening and sealing a legacy installed package writes canonical drafts and releases', async () => {
  const f = await fixture(); await f.create();
  const first = await f.service.seal({ id });
  const release = path.join(f.installDir, id, first.plugin.version);
  const content = await readFile(path.join(release, PLUGIN_MANIFEST_FILENAME), 'utf8');
  await rm(path.join(release, PLUGIN_MANIFEST_FILENAME));
  await writeFile(path.join(release, LEGACY_PLUGIN_MANIFEST_FILENAME), content); // legacy alias
  await rm(f.draft, { recursive: true });
  await f.service.open({ id });
  assert.equal(await readFile(path.join(f.draft, PLUGIN_MANIFEST_FILENAME), 'utf8'), content);
  await assert.rejects(readFile(path.join(f.draft, LEGACY_PLUGIN_MANIFEST_FILENAME)), { code: 'ENOENT' }); // legacy alias
  // Existing legacy drafts remain readable and can publish without an explicit reopen.
  await rm(path.join(f.draft, PLUGIN_MANIFEST_FILENAME));
  await writeFile(path.join(f.draft, LEGACY_PLUGIN_MANIFEST_FILENAME), content); // legacy alias
  const second = await f.service.seal({ id });
  const published = path.join(f.installDir, id, second.plugin.version);
  assert.equal(JSON.parse(await readFile(path.join(published, PLUGIN_MANIFEST_FILENAME), 'utf8')).version, second.plugin.version);
  await assert.rejects(readFile(path.join(published, LEGACY_PLUGIN_MANIFEST_FILENAME)), { code: 'ENOENT' }); // legacy alias
  assert.equal(await f.service.isSealedHere({ id, version: second.plugin.version }), true);
});

test('read, write, edit and delete reject traversal, absolute paths and invalid ids without touching outside files', async () => {
  const f = await fixture(); await f.create();
  const secret = path.join(f.root, 'secret.txt'); await writeFile(secret, 'untouched');
  for (const file of ['../secret.txt', 'server/../../secret.txt', secret, '/etc/passwd', 'C:\\secret.txt', '\\\\host\\share', 'server\\..\\secret.txt', './README.md', 'server//index.mjs']) {
    await assert.rejects(f.service.read({ id, path: file }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
    await assert.rejects(f.service.write({ id, path: file, content: 'bad' }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
    await assert.rejects(f.service.edit({ id, path: file, oldString: 'untouched', newString: 'bad' }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
    await assert.rejects(f.service.delete({ id, path: file }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
  }
  for (const invalid of ['..', '../other', secret, 'a/b', 'A', 'a'.repeat(51)]) await assert.rejects(f.service.open({ id: invalid }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
  await assert.rejects(f.service.write({ id, path: 'README.md/child.txt', content: 'bad' }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
  await assert.rejects(f.service.write({ id, path: 'server', content: 'bad' }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
  assert.equal(await readFile(secret, 'utf8'), 'untouched');
});

test('authoring accepts the existing manifest id grammar, including adjacent and edge hyphens', async () => {
  const f = await fixture();
  for (const pluginId of ['-rules', 'rules-', 'rules--extra']) {
    await f.service.create({ id: pluginId, name: 'Site rules', description: '' });
    assert.equal((await f.service.seal({ id: pluginId })).plugin.id, pluginId);
    assert.equal((await f.service.list({ id: pluginId })).files.length, 3);
  }
});

test('symlink and hardlink files, linked directories, draft roots and install roots are refused', async () => {
  for (const kind of ['file', 'directory', 'draft', 'install', 'hardlink']) {
    const f = await fixture(); await f.create();
    const secret = path.join(f.root, 'secret'); await writeFile(secret, 'untouched');
    if (kind === 'file') await symlink(secret, path.join(f.draft, 'leak'));
    if (kind === 'hardlink') await link(secret, path.join(f.draft, 'leak'));
    if (kind === 'directory') await symlink(f.root, path.join(f.draft, 'linked'));
    if (kind === 'draft') { await rm(f.draft, { recursive: true }); await symlink(f.root, f.draft); }
    if (kind === 'install') { await renameForLink(f.installDir); }
    await assert.rejects(f.service.read({ id, path: 'README.md' }));
    await assert.rejects(f.service.write({ id, path: 'leak', content: 'bad' }));
    await assert.rejects(f.service.seal({ id }));
    assert.equal(await readFile(secret, 'utf8'), 'untouched');
  }
});
async function renameForLink(installDir: string) {
  const { rename } = await import('node:fs/promises');
  await rename(installDir, installDir + '-real'); await symlink(installDir + '-real', installDir);
}

test('exact edits refuse no/multiple matches and replacement dollar signs are literal', async () => {
  const f = await fixture(); await f.create();
  await f.service.write({ id, path: 'server/helpers.mjs', content: 'same same' });
  await assert.rejects(f.service.edit({ id, path: 'server/helpers.mjs', oldString: 'missing', newString: 'x' }), { code: 'PLUGIN_SOURCE_EDIT_MISMATCH' });
  await assert.rejects(f.service.edit({ id, path: 'server/helpers.mjs', oldString: 'same', newString: 'x' }), { code: 'PLUGIN_SOURCE_EDIT_MISMATCH' });
  assert.equal((await f.service.read({ id, path: 'server/helpers.mjs' })).content, 'same same');
  assert.deepEqual(await f.service.edit({ id, path: 'server/helpers.mjs', oldString: 'same', newString: '$&', replaceAll: true }), { bytesWritten: 5, replacements: 2 });
  assert.equal((await f.service.read({ id, path: 'server/helpers.mjs' })).content, '$& $&');
  await f.service.delete({ id, path: 'server/helpers.mjs' });
  await assert.rejects(f.service.read({ id, path: 'server/helpers.mjs' }), { code: 'PLUGIN_SOURCE_FILE_MISSING' });
});

test('delete verifies the approved byte digest inside the source lock, including binary decode collisions', async () => {
  const f = await fixture(); await f.create();
  await writeFile(path.join(f.draft, 'bytes.bin'), Buffer.from([0x80]));
  const prior = await f.service.read({ id, path: 'bytes.bin' });
  await writeFile(path.join(f.draft, 'bytes.bin'), Buffer.from([0x81]));
  assert.equal((await f.service.read({ id, path: 'bytes.bin' })).content, prior.content);
  await assert.rejects(f.service.delete({ id, path: 'bytes.bin' }, { expectedDigest: prior.digest }), { code: 'PLUGIN_SOURCE_CHANGED' });
  assert.deepEqual(await readFile(path.join(f.draft, 'bytes.bin')), Buffer.from([0x81]));
});

test('file and aggregate size caps refuse writes before any mutation', async () => {
  const f = await fixture(); await f.create();
  await assert.rejects(f.service.write({ id, path: 'README.md', content: 'x'.repeat(PLUGIN_SOURCE_LIMITS.maxFileBytes + 1) }), { code: 'PLUGIN_SOURCE_TOO_LARGE' });
  await f.service.write({ id, path: 'expansion.txt', content: 'x'.repeat(1000) });
  await assert.rejects(f.service.edit({ id, path: 'expansion.txt', oldString: 'x', newString: 'y'.repeat(2000), replaceAll: true }), { code: 'PLUGIN_SOURCE_TOO_LARGE' });
  assert.equal((await f.service.read({ id, path: 'expansion.txt' })).content, 'x'.repeat(1000));
  for (let i = 0; i < 7; i++) await f.service.write({ id, path: `large-${i}.txt`, content: 'x'.repeat(PLUGIN_SOURCE_LIMITS.maxFileBytes) });
  await assert.rejects(f.service.write({ id, path: 'over-limit.txt', content: 'x'.repeat(PLUGIN_SOURCE_LIMITS.maxFileBytes) }), { code: 'PLUGIN_SOURCE_TOO_LARGE' });
  assert.equal((await f.service.list({ id })).files.some(file => file.path === 'over-limit.txt'), false);
  await assert.rejects(f.service.write({ id, path: Array(514).fill('x').join('/'), content: 'x' }), { code: 'PLUGIN_SOURCE_TOO_LARGE' });
});

test('entry caps include pre-existing empty directories and refuse a write before it exceeds the limit', async () => {
  const f = await fixture(); await f.create();
  for (let i = 0; i < 507; i++) await mkdir(path.join(f.draft, 'empty-' + i));
  await assert.rejects(f.service.write({ id, path: 'new/too-many/entries.txt', content: 'x' }), { code: 'PLUGIN_SOURCE_TOO_LARGE' });
  assert.equal((await readdir(f.draft)).includes('new'), false);
});

test('snapshot caps cannot disable the installer bounds using NaN, infinity, negative or fractional limits', async () => {
  const f = await fixture(); await f.create();
  for (const key of ['maxEntries', 'maxFileBytes', 'maxTotalBytes']) {
    for (const limit of [NaN, Infinity, 0, -1, 1.5]) await assert.rejects(snapshotSitePluginPackage({ sourceDir: f.draft }, { [key]: limit }), { code: 'PLUGIN_SNAPSHOT_LIMIT_INVALID' });
  }
  await assert.rejects(snapshotSitePluginPackage({ sourceDir: f.draft }, { maxEntries: 1 }), { code: 'PLUGIN_PACKAGE_TOO_LARGE' });
  await assert.rejects(snapshotSitePluginPackage({ sourceDir: f.draft }, { maxFileBytes: 1 }), { code: 'PLUGIN_PACKAGE_TOO_LARGE' });
  await assert.rejects(snapshotSitePluginPackage({ sourceDir: f.draft }, { maxTotalBytes: 1 }), { code: 'PLUGIN_PACKAGE_TOO_LARGE' });
});

test('seal hashes all files, pins the installer digest, bumps patches, preserves prior versions and calls reload last', async () => {
  const f = await fixture({ reload: async () => true }); await f.create();
  await f.service.write({ id, path: 'server/helper.mjs', content: 'export const value = 1;' });
  const first = await f.service.seal({ id });
  assert.deepEqual(f.calls, ['preview', 'install', 'reload']);
  assert.equal(first.plugin.version, '0.1.0'); assert.equal(first.reloaded, true);
  assert.equal(await f.service.isSealedHere({ id, version: '0.1.0' }), true);
  const firstRoot = path.join(f.installDir, id, '0.1.0');
  const manifest = JSON.parse(await readFile(path.join(firstRoot, PLUGIN_MANIFEST_FILENAME), 'utf8'));
  assert.deepEqual(Object.keys(manifest.integrity).sort(), ['README.md', 'server/helper.mjs', 'server/index.mjs']);
  assert.deepEqual(manifest.integrity, await computePluginIntegrity({ sourceDir: firstRoot }));
  await f.service.write({ id, path: 'server/helper.mjs', content: 'export const value = 2;' });
  const second = await f.service.seal({ id });
  assert.equal(second.plugin.version, '0.1.1');
  assert.deepEqual((await readdir(path.join(f.installDir, id))).sort(), ['0.1.0', '0.1.1']);
  assert.equal(await readFile(path.join(firstRoot, 'server/helper.mjs'), 'utf8'), 'export const value = 1;');
  assert.deepEqual(await f.repo.listAll(), [], 'authoring does not enable a plugin');
  const latest = await discoverPlugins({ ...manifestHost, tierPolicy, installDir: f.installDir, builtIns: [] });
  assert.equal(latest[0]?.version, '0.1.1');
  const pinned = await discoverPlugins({ ...manifestHost, tierPolicy, installDir: f.installDir, builtIns: [] }, { versions: new Map([[id, '0.1.0']]) });
  assert.equal(pinned[0]?.version, '0.1.0'); assert.equal(pinned[0]?.status, 'valid');
  const missing = await discoverPlugins({ ...manifestHost, tierPolicy, installDir: f.installDir, builtIns: [] }, { versions: new Map([[id, '9.0.0']]) });
  assert.equal(missing[0]?.status, 'invalid'); assert.equal(missing[0]?.version, '9.0.0');
  await assert.rejects(discoverPlugins({ ...manifestHost, tierPolicy, installDir: f.installDir, builtIns: [] }, { versions: new Map([[id, '../outside']]) }));
});

test('seal can append for enabled workspaces; ordinary installs and same-version replacement still refuse enabled packages', async () => {
  const f = await fixture(); await f.create(); await f.service.seal({ id });
  await f.repo.save({ pluginId: id, workspaceId: 'workspace', version: '0.1.0', enabled: true, updatedAt: '2026-10-09' });
  assert.equal((await f.service.seal({ id })).plugin.version, '0.1.1');
  const external = path.join(f.root, 'external'); await cp(path.join(f.installDir, id, '0.1.1'), external, { recursive: true });
  await assert.rejects(f.installer.preview({ sourceDir: external, replace: true }), { code: 'PLUGIN_ENABLED' });
  await assert.rejects(f.installer.preview({ sourceDir: external, replace: true }, { versionAppend: true }), { code: 'PLUGIN_ENABLED' });
  await f.repo.save({ pluginId: id, workspaceId: 'workspace', version: '0.1.0', enabled: false, updatedAt: '2026-10-09' });
  await assert.rejects(f.installer.preview({ sourceDir: external, replace: true }, { versionAppend: true }), { code: 'PLUGIN_VERSION_EXISTS' });
});

test('manifest and missing entry errors surface without installation or reload', async () => {
  const f = await fixture(); await f.create();
  await f.service.write({ id, path: PLUGIN_MANIFEST_FILENAME, content: '{' });
  await assert.rejects(f.service.seal({ id }), { code: 'PLUGIN_MANIFEST_INVALID', message: `A valid ${PLUGIN_MANIFEST_FILENAME} is required.` });
  assert.deepEqual(f.calls, []);
  const manifest = { id, name: 'Bad', version: '0.1.0', engine: 99, sdkRange: '^0.1.0', tier: 'tier-3', capabilities: [], hooks: [], fields: [], integrity: {} };
  await f.service.write({ id, path: PLUGIN_MANIFEST_FILENAME, content: JSON.stringify(manifest) });
  await assert.rejects(f.service.seal({ id }), error => (error as Error).message.includes('engine'));
  assert.deepEqual(f.calls, []);
  manifest.engine = 1; await f.service.write({ id, path: PLUGIN_MANIFEST_FILENAME, content: JSON.stringify(manifest) });
  await f.service.delete({ id, path: 'server/index.mjs' });
  await assert.rejects(f.service.seal({ id }), { code: 'PLUGIN_MANIFEST_INVALID', message: 'server/index.mjs is required.' });
  assert.deepEqual(f.calls, ['preview']);
});

test('open copies the latest installed package once and never overwrites unsealed edits', async () => {
  const f = await fixture(); await f.create(); await f.service.seal({ id });
  await f.service.write({ id, path: 'README.md', content: 'second package' }); await f.service.seal({ id });
  await rm(f.draft, { recursive: true });
  assert.deepEqual(await f.service.open({ id }), { created: true });
  assert.equal((await f.service.read({ id, path: 'README.md' })).content, 'second package');
  await f.service.write({ id, path: 'README.md', content: 'unsealed edits' });
  assert.deepEqual(await f.service.open({ id }), { created: false });
  assert.deepEqual(await f.create(), { created: false });
  assert.equal((await f.service.read({ id, path: 'README.md' })).content, 'unsealed edits');
});

test('rollback seals prior bytes as a new version, reloads and leaves draft edits alone', async () => {
  const f = await fixture({ reload: async () => true }); await f.create();
  await assert.rejects(f.service.rollback({ id }), { code: 'PLUGIN_SOURCE_NO_ROLLBACK' });
  await f.service.write({ id, path: 'README.md', content: 'version one' }); await f.service.seal({ id });
  await f.service.write({ id, path: 'README.md', content: 'version two' }); await f.service.seal({ id });
  await f.service.write({ id, path: 'README.md', content: 'unsealed' });
  const result = await f.service.rollback({ id });
  assert.equal(result.rollbackFrom, '0.1.0'); assert.equal(result.plugin.version, '0.1.2'); assert.equal(result.reloaded, true);
  assert.equal(await readFile(path.join(f.installDir, id, '0.1.2/README.md'), 'utf8'), 'version one');
  assert.equal((await f.service.read({ id, path: 'README.md' })).content, 'unsealed');
  assert.deepEqual((await readdir(path.join(f.installDir, id))).sort(), ['0.1.0', '0.1.1', '0.1.2']);
});

test('local sealing needs no switch; hosted sealing requires opt-in and returns no partial install', async () => {
  const f = await fixture({ hosted: true }); await f.create();
  await assert.rejects(f.service.seal({ id }), { code: 'PLUGIN_LOCAL_INSTALL_DISABLED', message: 'Local plugin install is disabled by the host.' }); assert.deepEqual(f.calls, []);
  const hostMessage = 'Enable local installs in the host settings.';
  const withHint = createPluginSourceService({ ...f.sourceDeps, localInstallDisabledMessage: hostMessage }, { temporaryDir: f.root });
  await assert.rejects(withHint.seal({ id }), { code: 'PLUGIN_LOCAL_INSTALL_DISABLED', message: hostMessage }); assert.deepEqual(f.calls, []);
  const optedIn = createPluginSourceService({ ...f.sourceDeps, policy: createPluginSourcePolicy({ hosted: true, localInstallOptIn: true }) }, { temporaryDir: f.root });
  assert.equal((await optedIn.seal({ id })).installed, true);
});

test('reload failures report installation honestly and leave rollback bytes intact', async () => {
  const f = await fixture({ reload: async () => { throw new Error('bad export'); } }); await f.create();
  const first = await f.service.seal({ id });
  assert.equal(first.installed, true); assert.equal(first.reloaded, false); assert.equal(first.reloadError, 'bad export');
  assert.equal((await f.service.seal({ id })).plugin.version, '0.1.1');
  assert.deepEqual((await readdir(path.join(f.installDir, id))).sort(), ['0.1.0', '0.1.1']);
});

test('provenance is bound to every byte including the manifest, and cannot be forged from a draft path', async () => {
  const f = await fixture(); await f.create(); await f.service.seal({ id });
  assert.equal(await f.service.isSealedHere({ id, version: '0.1.0' }), true);
  assert.equal(await f.service.isSealedHere({ id, version: '0.1.1' }), false);
  await assert.rejects(f.service.write({ id, path: '../.sealed/site-rules/0.1.0.json', content: '{}' }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
  const live = path.join(f.installDir, id, '0.1.0');
  await writeFile(path.join(live, 'README.md'), 'tampered');
  assert.equal(await f.service.isSealedHere({ id, version: '0.1.0' }), false);
});

test('built-ins and missing drafts refuse, and source lock serializes concurrent seal/edit without leaking a temporary tree', async () => {
  let release!: () => void;
  const waiting = new Promise<boolean>(resolve => { release = () => resolve(true); });
  let reached!: () => void; const started = new Promise<void>(resolve => { reached = resolve; });
  const f = await fixture({ reload: () => { reached(); return waiting; } });
  await assert.rejects(f.service.create({ id: 'bundled', name: 'x', description: 'x' }), { code: 'PLUGIN_SHADOWS_BUILT_IN' });
  assert.equal(await f.service.isSealedHere({ id: 'bundled', version: '0.1.0' }), false);
  await assert.rejects(f.service.read({ id, path: 'README.md' }), { code: 'PLUGIN_SOURCE_DRAFT_MISSING' });
  await f.create(); const sealing = f.service.seal({ id }); await started;
  try {
    const owner = JSON.parse(await readFile(f.installDir + '-source-lock', 'utf8'));
    assert.equal(owner.pid, process.pid); assert.ok(Number.isFinite(Date.parse(owner.acquiredAt)));
    assert.equal(await f.service.isSealedHere({ id, version: '0.1.0' }), true, 'enable provenance reads remain available during seal');
    await assert.rejects(f.service.write({ id, path: 'README.md', content: 'raced' }), { code: 'PLUGIN_SOURCE_BUSY' });
  }
  finally { release(); await sealing; }
  assert.deepEqual((await readdir(f.root)).sort(), ['plugins', 'plugins-staging']);
});

test('source lock reclaims dead owners but never evicts a live owner merely because it is old', async () => {
  const f = await fixture({ lockProcess: { pid: 500, isAlive: ({ pid }) => pid !== 77 } }); await f.create();
  const lock = f.installDir + '-source-lock';
  const owner = { pid: 77, hostname: hostname(), token: 'dead-owner', acquiredAt: '2000-01-01T00:00:00.000Z' };
  await writeFile(lock, JSON.stringify(owner));
  await f.service.write({ id, path: 'README.md', content: 'recovered' });
  assert.equal((await f.service.read({ id, path: 'README.md' })).content, 'recovered');
  await writeFile(lock, JSON.stringify({ ...owner, pid: 500, token: 'live-owner' }));
  await assert.rejects(f.service.write({ id, path: 'README.md', content: 'stolen' }), { code: 'PLUGIN_SOURCE_BUSY' });
  assert.equal(JSON.parse(await readFile(lock, 'utf8')).token, 'live-owner');
  assert.equal(await readFile(path.join(f.draft, 'README.md'), 'utf8'), 'recovered');
});

test('seal uses a higher manifest version exactly, then bumps it when the draft version is stale', async () => {
  const f = await fixture(); await f.create(); await f.service.seal({ id });
  const manifest = JSON.parse((await f.service.read({ id, path: PLUGIN_MANIFEST_FILENAME })).content);
  await f.service.write({ id, path: PLUGIN_MANIFEST_FILENAME, content: JSON.stringify({ ...manifest, version: '2.0.0' }) });
  assert.equal((await f.service.seal({ id })).plugin.version, '2.0.0');
  assert.equal((await f.service.seal({ id })).plugin.version, '2.0.1');
});

test('dotfiles in an installed plugin slot do not break open, seal or retention', async () => {
  const f = await fixture(); await f.create(); await f.service.seal({ id });
  await writeFile(path.join(f.installDir, id, '.DS_Store'), 'finder metadata');
  await mkdir(path.join(f.installDir, id, '.metadata'));
  await rm(f.draft, { recursive: true });
  assert.deepEqual(await f.service.open({ id }), { created: true });
  assert.equal((await f.service.seal({ id })).plugin.version, '0.1.1');
  assert.equal(await readFile(path.join(f.installDir, id, '.DS_Store'), 'utf8'), 'finder metadata');
});

test('successful reload keeps every active version and the newest three, and retires provenance too', async () => {
  const f = await fixture({ reload: async () => true }); await f.create(); await f.service.seal({ id });
  await f.repo.save({ pluginId: id, workspaceId: 'remote', version: '0.1.0', enabled: true, updatedAt: '2026-10-09' });
  for (let index = 0; index < 5; index++) await f.service.seal({ id });
  assert.deepEqual((await readdir(path.join(f.installDir, id))).sort(), ['0.1.0', '0.1.3', '0.1.4', '0.1.5']);
  assert.equal(await f.service.isSealedHere({ id, version: '0.1.0' }), true);
  assert.equal(await f.service.isSealedHere({ id, version: '0.1.1' }), false);
  assert.deepEqual((await readdir(path.join(f.installDir, '.drafts', '.sealed', id))).sort(), ['0.1.0', '0.1.3', '0.1.4', '0.1.5']);
  assert.equal((await f.service.rollback({ id })).rollbackFrom, '0.1.4');
});

test('failed reload never prunes recovery bytes', async () => {
  const f = await fixture({ reload: async () => { throw new Error('broken generation'); } }); await f.create();
  for (let index = 0; index < 5; index++) assert.equal((await f.service.seal({ id })).reloadError, 'broken generation');
  assert.deepEqual((await readdir(path.join(f.installDir, id))).sort(), ['0.1.0', '0.1.1', '0.1.2', '0.1.3', '0.1.4']);
});

test('retention refuses unsafe ids, concurrent installs and malformed slots before deleting anything', async () => {
  const f = await fixture(); await f.create(); await f.service.seal({ id });
  const prune = () => pruneSitePluginVersions({ id, installDir: f.installDir, repo: f.repo });
  await assert.rejects(pruneSitePluginVersions({ id: '../outside', installDir: f.installDir, repo: f.repo }), { code: 'PLUGIN_PACKAGE_UNSAFE' });
  await mkdir(f.installDir + '-install-lock');
  await assert.rejects(prune(), { code: 'PLUGIN_INSTALL_BUSY' });
  await rm(f.installDir + '-install-lock', { recursive: true });
  await mkdir(path.join(f.installDir, id, 'not-a-version'));
  await assert.rejects(prune(), { code: 'PLUGIN_ID_CONFLICT' });
  assert.equal(await readFile(path.join(f.installDir, id, '0.1.0/server/index.mjs'), 'utf8'), entry);
});

test('policy always confirms unsealed plugins; a package sealed here enables directly only when it adds nothing beyond the last approval', () => {
  const policy = createPluginSourcePolicy({ hosted: false, localInstallOptIn: false });
  assert.equal(policy.localInstallEnabled(), true);
  // Consent gap (2026-10-12): sealed here with no prior approval must still ask.
  assert.equal(policy.confirmEnable({ sealedHere: true, added: addedPluginCapabilities({ approved: undefined, next: ['tier:tier-3'] }) }), true);
  assert.equal(policy.confirmEnable({ sealedHere: true, added: [] }), false);
  assert.equal(policy.confirmEnable({ sealedHere: true, added: ['route:GET /x'] }), true);
  assert.equal(policy.confirmEnable({ sealedHere: false, added: [] }), true);
  assert.equal(createPluginSourcePolicy({ hosted: true, localInstallOptIn: false }).localInstallEnabled(), false);
  assert.equal(createPluginSourcePolicy({ hosted: true, localInstallOptIn: true }).localInstallEnabled(), true);
});

test('capability sets name every declared surface and widen only on additions', () => {
  const base = { tier: 'tier-3' as const, capabilities: ['hooks.attach'], hooks: ['content.entry.beforeSave'], fields: [{ path: 'ext.x.v', type: 'integer' as const, queryable: false }] };
  const caps = pluginCapabilitySet({ manifest: { ...base, contentTypes: [{ key: 'event' }], contributes: { routes: ['GET /hello'], tools: ['echo'], tables: ['p_x__t'], settings: ['s'], widgets: ['w'], permissions: ['x.read'] } } });
  assert.deepEqual(caps, ['capability:hooks.attach', 'content-type:event', 'field:ext.x.v', 'hook:content.entry.beforeSave', 'permission:x.read', 'route:GET /hello', 'setting:s', 'table:p_x__t', 'tier:tier-3', 'tool:echo', 'widget:w']);
  const plain = pluginCapabilitySet({ manifest: base });
  assert.deepEqual(addedPluginCapabilities({ approved: caps, next: plain }), [], 'narrowing is not widening');
  assert.deepEqual(addedPluginCapabilities({ approved: plain, next: caps }), ['content-type:event', 'permission:x.read', 'route:GET /hello', 'setting:s', 'table:p_x__t', 'tool:echo', 'widget:w']);
  assert.deepEqual(addedPluginCapabilities({ approved: plain, next: pluginCapabilitySet({ manifest: { ...base, tier: 'tier-1' } }) }), ['tier:tier-1']);
});

test('approvals persist beside provenance, survive pruning, ignore damage and cannot be written through a draft path', async () => {
  const f = await fixture(); await f.create();
  assert.equal(await f.service.readApproval({ id }), undefined);
  await f.service.recordApproval({ id, capabilities: ['tier:tier-3', 'hook:a'] });
  assert.deepEqual(await f.service.readApproval({ id }), ['tier:tier-3', 'hook:a']);
  for (let i = 0; i < 5; i++) { await f.service.write({ id, path: 'README.md', content: String(i) }); await f.service.seal({ id }); }
  assert.deepEqual(await f.service.readApproval({ id }), ['tier:tier-3', 'hook:a']);
  await assert.rejects(f.service.write({ id, path: '../.sealed/' + id + '/approved.json', content: '{"capabilities":[]}' }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
  await writeFile(path.join(f.installDir, '.drafts/.sealed', id, 'approved.json'), '{not json');
  assert.equal(await f.service.readApproval({ id }), undefined);
  await assert.rejects(f.service.readApproval({ id: '../x' }), { code: 'PLUGIN_SOURCE_PATH_INVALID' });
});

test('input guards refuse bad scaffold metadata, edits, content and versions before any write', async () => {
  const f = await fixture();
  await assert.rejects(f.service.create({ id, name: ' ', description: 'x' }), { code: 'PLUGIN_SOURCE_INPUT_INVALID' });
  await assert.rejects(f.service.create({ id, name: 'n', description: 'x'.repeat(64 * 1024) }), { code: 'PLUGIN_SOURCE_TOO_LARGE' });
  await f.create();
  await assert.rejects(f.service.edit({ id, path: 'README.md', oldString: '', newString: 'x' }), { code: 'PLUGIN_SOURCE_INPUT_INVALID' });
  await assert.rejects(f.service.edit({ id, path: 'README.md', oldString: 'Site', newString: 'x', replaceAll: 'yes' as unknown as boolean }), { code: 'PLUGIN_SOURCE_INPUT_INVALID' });
  await assert.rejects(f.service.write({ id, path: 'README.md', content: 42 as unknown as string }), { code: 'PLUGIN_SOURCE_INPUT_INVALID' });
  assert.equal(await f.service.isSealedHere({ id, version: 'not-semver' }), false);
  assert.equal(await f.service.isSealedHere({ id, version: '=1.0.0' }), false);
});

test('missing drafts, installs and manifests are typed refusals', async () => {
  const f = await fixture(); await f.create();
  await assert.rejects(f.service.list({ id: 'other' }), { code: 'PLUGIN_SOURCE_DRAFT_MISSING' });
  await assert.rejects(f.service.open({ id: 'other' }), { code: 'PLUGIN_SOURCE_NOT_INSTALLED' });
  await f.service.delete({ id, path: PLUGIN_MANIFEST_FILENAME });
  await assert.rejects(f.service.read({ id, path: PLUGIN_MANIFEST_FILENAME }), { code: 'PLUGIN_SOURCE_FILE_MISSING' });
  await assert.rejects(f.service.seal({ id }), { code: 'PLUGIN_MANIFEST_INVALID', message: `A valid ${PLUGIN_MANIFEST_FILENAME} is required.` });
});

test('seal refuses a manifest id that differs from the draft id and an unrecognized installed version', async () => {
  const f = await fixture(); await f.create();
  const manifest = JSON.parse((await f.service.read({ id, path: PLUGIN_MANIFEST_FILENAME })).content);
  const otherId = 'other-rules';
  await f.service.write({ id, path: PLUGIN_MANIFEST_FILENAME, content: JSON.stringify({ ...manifest, id: otherId }) });
  await assert.rejects(f.service.seal({ id }), { code: 'PLUGIN_MANIFEST_INVALID' });
  await f.service.write({ id, path: PLUGIN_MANIFEST_FILENAME, content: JSON.stringify(manifest) });
  await mkdir(path.join(f.installDir, id, 'abc'), { recursive: true });
  await assert.rejects(f.service.seal({ id }), { code: 'PLUGIN_SOURCE_VERSION_INVALID' });
});

test('a non-Error reload failure is stringified and a failed rollback reload names its source version', async () => {
  let fail = false;
  const f = await fixture({ reload: async () => { if (fail) throw 'plain failure'; return true; } }); await f.create();
  await f.service.seal({ id }); await f.service.seal({ id });
  fail = true;
  const result = await f.service.rollback({ id });
  assert.equal(result.reloadError, 'plain failure');
  assert.equal(result.rollbackFrom, '0.1.0');
});

test('sealing stages in the OS temp directory by default', async () => {
  const f = await fixture(); await f.create();
  const defaultTemp = createPluginSourceService(f.sourceDeps);
  assert.equal((await defaultTemp.seal({ id })).installed, true);
});

test('approvals read as absent without a site root or with a malformed record', async () => {
  const f = await fixture();
  assert.equal(await f.service.readApproval({ id }), undefined);
  await f.service.recordApproval({ id, capabilities: ['tier:tier-3'] });
  const record = path.join(f.installDir, '.drafts/.sealed', id, 'approved.json');
  await writeFile(record, JSON.stringify({ capabilities: 'tier:tier-3' }));
  assert.equal(await f.service.readApproval({ id }), undefined);
  await writeFile(record, JSON.stringify({ capabilities: ['ok', 1] }));
  assert.equal(await f.service.readApproval({ id }), undefined);
});

test('a filesystem fault other than ENOENT while probing a path propagates', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'file'), 'x');
  const blocked = createPluginSourceService({ ...f.sourceDeps, installDir: path.join(f.root, 'file', 'plugins') }, { temporaryDir: f.root });
  await assert.rejects(blocked.readApproval({ id }), { code: 'ENOTDIR' });
});
