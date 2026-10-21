import { expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAgentPluginLifecycle, createAgentPluginLayout, type AgentPluginArchiveReaderPort, type AgentPluginLifecyclePorts } from '../../index.js';
import { createAgentPluginUpdateStore, AgentPluginUpdateError, isMissing, type AgentPluginUpdateJournal } from '../../update-store.js';
import { createUpdateModule } from '../../update.js';
import { createInstallModule } from '../../install.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

const workspaceId = 'workspace-a';
const pluginId = 'operator-plugin';
type Layout = ReturnType<typeof createAgentPluginLayout>;
type Harness = Awaited<ReturnType<typeof harness>>;

function archiveInput(layout: Layout, version: string | undefined, extension: Record<string, unknown> = {}, { name = pluginId, salt = '' } = {}) {
  const manifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name, ...(version ? { version } : {}),
    extensions: { 'org.example.host': extension } };
  const files = { 'plugin.json': JSON.stringify(manifest), [`skills/${name}/SKILL.md`]: `# Version ${version}\nGuidance for ${version}${salt}` };
  const archive = Buffer.from(JSON.stringify(files));
  const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
    for (const [entryPath, text] of Object.entries(files)) yield { kind: 'file', entryPath, openReadStream: async function* () { yield Buffer.from(text); } };
  } };
  return { archive, archiveReader, expectedSha256: createHash('sha256').update(archive).digest('hex'), layout, workspaceId };
}
async function fixture(run: (h: Harness) => Promise<void>, options: Partial<AgentPluginLifecyclePorts> = {}) {
  const h = await harness(options);
  try { await run(h); } finally { await forceRemove(h.temp); }
}
async function harness(options: Partial<AgentPluginLifecyclePorts> = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-update-'));
  const layout = createAgentPluginLayout({ root: path.join(temp, 'plugins') });
  const events: string[] = [];
  const warnings: string[] = [];
  const context: AgentPluginLifecyclePorts = { ...ports, layout, onEvent: ({ event }) => { if (event.startsWith('agent-plugin-update')) warnings.push(event); }, mcpProvisioning: { ...ports.mcpProvisioning,
    provision: async ({ installed }) => { events.push(`provision:${installed.version}`); },
    notifyRosterChanged: async () => { events.push('notify'); },
  }, ...options };
  const api = createAgentPluginLifecycle(context);
  const previous = await api.installAgentPlugin(archiveInput(layout, '1.0.0', { provides: ['cap:old'] }));
  await api.setAgentPluginActivation({ workspaceRoot: layout.forWorkspace({ workspaceId }).root, pluginId, enabled: true, actor: 'owner' });
  const settingsSnapshot = { definitions: [{ key: 'example' }], values: [{ value: 'before' }] };
  const input = { ...archiveInput(layout, '2.0.0'), pluginId, expectedOldDigest: previous.archiveDigest, actor: 'operator:alice',
    snapshotSettings: async () => settingsSnapshot };
  const store = createAgentPluginUpdateStore({ ports: context, workspaceId, pluginId });
  const workspace = layout.forWorkspace({ workspaceId });
  return { api, context, input, previous, settingsSnapshot, store, layout, temp, events, warnings, workspace, workspaceRoot: workspace.root,
    pluginRoot: workspace.pluginRootDir({ pluginId }) };
}
/** A lifecycle over the same layout whose filesystem fails the operations `faults` selects. */
function faulty(h: Harness, faults: { rename?: (to: string) => boolean; readdir?: (dir: string) => boolean; lstat?: (target: string) => boolean }, overrides: Partial<AgentPluginLifecyclePorts> = {}) {
  const filesystem = { ...fs,
    rename: (async (from, to) => { if (faults.rename?.(String(to))) throw Object.assign(new Error(`rename refused: ${path.basename(String(to))}`), { code: 'EIO' }); return fs.rename(from, to); }) as typeof fs.rename,
    readdir: (async (dir: string, options: never) => { if (faults.readdir?.(String(dir))) throw Object.assign(new Error('readdir refused'), { code: 'EACCES' }); return fs.readdir(dir, options); }) as typeof fs.readdir,
    lstat: (async (target: string) => { if (faults.lstat?.(String(target))) throw Object.assign(new Error('lstat refused'), { code: 'EACCES' }); return fs.lstat(target); }) as typeof fs.lstat,
  };
  return createAgentPluginLifecycle({ ...h.context, filesystem, ...overrides });
}
/** Fails only the `nth` matching call, counted from 1. */
function nth(predicate: (value: string) => boolean, n: number) {
  let seen = 0;
  return (value: string) => predicate(value) && ++seen === n;
}
async function liveDigests(h: Harness): Promise<string[]> {
  return (await fs.readdir(h.workspace.pluginPackagesDir({ pluginId }))).sort();
}
async function history(h: Harness): Promise<AgentPluginUpdateJournal[]> {
  const directory = path.join(h.pluginRoot, 'update-history');
  return Promise.all((await fs.readdir(directory)).map(async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))));
}
async function verdict(h: Harness) {
  return (await h.api.resolveAgentPluginActivation({ workspaceRoot: h.workspaceRoot, pluginId })).verdict;
}
/** The old revision is the only live digest, its guidance resolves, and one rolled-back audit exists. */
async function expectRestored(h: Harness, expectedVerdict: 'active' | 'inactive') {
  expect(await liveDigests(h)).toEqual([h.previous.archiveDigest]);
  expect(await verdict(h)).toBe(expectedVerdict);
  expect(await h.store.read({})).toBeUndefined();
  expect(await history(h)).toEqual([expect.objectContaining({ result: 'rolled-back', actor: 'operator:alice', fromDigest: h.previous.archiveDigest, toDigest: h.input.expectedSha256 })]);
  expect(await fs.readdir(path.join(h.pluginRoot, 'rollback'))).toEqual([]);
  expect((await fs.stat(path.join(h.workspace.pluginPackagesDir({ pluginId }), h.previous.archiveDigest))).mode & 0o777).toBe(0o555);
}

test('enabled update keeps memory and a single live digest; audit is filed at commit; boot collects frozen rollback', async () => {
  await fixture(async h => {
    const memory = h.api.pluginMemory({ workspaceId, pluginId });
    await memory.writeNote({ entryPath: 'preferences.md', text: 'Keep these notes.' });
    const result = await h.api.updateAgentPlugin(h.input);
    expect(result.plugin.version).toBe('2.0.0'); expect(result.enabled).toBe(true); expect(result.alreadyInstalled).toBe(false);
    expect(h.events).toEqual(['provision:2.0.0', 'notify']);
    expect(await liveDigests(h)).toEqual([result.plugin.archiveDigest]);
    expect((await h.api.listInstalledPlugins({ workspaceRoot: h.workspaceRoot })).map(p => p.archiveDigest)).toEqual([result.plugin.archiveDigest]);
    expect(await fs.readFile(path.join(h.workspace.pluginMemoryDir({ pluginId, kind: 'notes' }), 'preferences.md'), 'utf8')).toContain('Keep these notes.');
    // Audit lands at commit, not at the next update or boot.
    expect(await h.store.read({})).toBeUndefined();
    const [audit] = await history(h);
    expect(audit).toMatchObject({ state: 'committed', actor: 'operator:alice', pluginId, fromVersion: '1.0.0', toVersion: '2.0.0',
      fromDigest: h.previous.archiveDigest, toDigest: result.plugin.archiveDigest, result: 'updated', settingsSnapshot: h.settingsSnapshot });
    const historyFile = path.join(h.pluginRoot, 'update-history', `${audit!.transactionId}.json`);
    expect((await fs.stat(historyFile)).mode & 0o777).toBe(0o600);
    // Rollback bytes are retained (frozen, outside package/sha256) until boot.
    const rollbackRoot = h.store.rollbackRoot({ digest: h.previous.archiveDigest });
    expect(rollbackRoot).not.toContain(`${path.sep}sha256${path.sep}`); expect((await fs.stat(rollbackRoot)).mode & 0o777).toBe(0o555);
    const refs = await h.api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout: h.workspace });
    expect(refs.ok && refs.promptPrefix).toContain('Version 2.0.0');
    await h.api.reconcileAgentPluginUpdates({ workspaceId });
    await h.api.reconcileAgentPluginUpdates({ workspaceId });
    await expect(fs.stat(rollbackRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await history(h)).toHaveLength(1);
    expect((await h.api.listInstalledPlugins({ workspaceRoot: h.workspaceRoot }))[0]?.version).toBe('2.0.0');
  });
});

test('rollback on MCP activation failure restores old guidance and activation, reprovisions and audits', async () => {
  const provisioned: string[] = [];
  await fixture(async h => {
    await expect(h.api.updateAgentPlugin(h.input)).rejects.toThrow('candidate activation failed');
    expect((await h.api.listInstalledPlugins({ workspaceRoot: h.workspaceRoot })).map(p => p.version)).toEqual(['1.0.0']);
    expect(provisioned).toEqual(['2.0.0', '1.0.0']);
    await expectRestored(h, 'active');
    const refs = await h.api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout: h.workspace });
    expect(refs.ok && refs.promptPrefix).toContain('Version 1.0.0');
  }, { mcpProvisioning: { ...ports.mcpProvisioning, provision: async ({ installed }) => {
    provisioned.push(installed.version!); if (installed.version === '2.0.0') throw new Error('candidate activation failed');
  } } });
});

test('downgrade, changed digest, bundled provenance and mismatched id refuse without modifying state', async () => {
  await fixture(async h => {
    await expect(h.api.updateAgentPlugin({ ...h.input, expectedOldDigest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'PLUGIN_CHANGED' });
    await expect(h.api.updateAgentPlugin({ ...h.input, pluginId: 'other' })).rejects.toMatchObject({ code: 'PLUGIN_ID_MISMATCH' });
    await expect(h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '0.9.0') })).rejects.toMatchObject({ code: 'PLUGIN_DOWNGRADE_REFUSED' });
    await expect(h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '2.0.0', { hostRange: '>=99' }) })).rejects.toMatchObject({ code: 'PLUGIN_HOST_INCOMPATIBLE' });
    await h.api.setAgentPluginActivation({ workspaceRoot: h.workspaceRoot, pluginId, enabled: true, actor: 'system:seed' }, { origin: 'bundled' });
    const activationsBefore = await fs.readFile(path.join(h.workspaceRoot, 'activations.json'), 'utf8');
    await expect(h.api.updateAgentPlugin(h.input)).rejects.toMatchObject({ code: 'PLUGIN_BUNDLED' });
    // A bundled plugin never changes state through this path, not even its activation record.
    expect(await fs.readFile(path.join(h.workspaceRoot, 'activations.json'), 'utf8')).toBe(activationsBefore);
    expect(await liveDigests(h)).toEqual([h.previous.archiveDigest]);
    expect(await h.store.read({})).toBeUndefined();
    await expect(fs.stat(path.join(h.pluginRoot, 'rollback'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(h.events).toEqual([]);
  });
});

test('a plugin that is not installed, or has two live digests, refuses as changed', async () => {
  await fixture(async h => {
    await expect(h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '1.0.0', {}, { name: 'absent-plugin' }), pluginId: 'absent-plugin' }))
      .rejects.toMatchObject({ code: 'PLUGIN_CHANGED' });
    const stray = path.join(h.workspace.pluginPackagesDir({ pluginId }), 'f'.repeat(64));
    await fs.cp(h.previous.packageRoot, stray, { recursive: true });
    await expect(h.api.updateAgentPlugin(h.input)).rejects.toMatchObject({ code: 'PLUGIN_CHANGED' });
    expect(await liveDigests(h)).toEqual([h.previous.archiveDigest, 'f'.repeat(64)].sort());
    expect(await h.store.read({})).toBeUndefined();
  });
});

test('an unreadable activation decision refuses before any mutation', async () => {
  await fixture(async h => {
    const file = path.join(h.workspaceRoot, 'activations.json');
    const document = JSON.parse(await fs.readFile(file, 'utf8'));
    document.plugins[pluginId] = 'garbled';
    await fs.writeFile(file, JSON.stringify(document));
    await expect(h.api.updateAgentPlugin(h.input)).rejects.toMatchObject({ code: 'PLUGIN_ACTIVATION_UNKNOWN' });
    expect(await liveDigests(h)).toEqual([h.previous.archiveDigest]);
    expect(await h.store.read({})).toBeUndefined();
  });
});

test('same bytes are a no-op, disabled updates remain off, and missing capabilities warn', async () => {
  await fixture(async h => {
    const same = await h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '1.0.0', { provides: ['cap:old'] }) });
    expect(same).toMatchObject({ alreadyInstalled: true, enabled: true, warnings: [] });
    expect(same.plugin.archiveDigest).toBe(h.previous.archiveDigest);
    expect(h.events).toEqual([]); expect(await h.store.read({})).toBeUndefined();
    await h.api.setAgentPluginEnabled({ workspaceId, pluginId, enabled: false, actor: 'owner' });
    const result = await h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '2.0.0', { requires: ['missing'] }) });
    expect(result.enabled).toBe(false); expect(result.warnings).toEqual(['Needs missing']);
    expect(await verdict(h)).toBe('inactive');
  });
});

test('a disabled plugin may update to a host-incompatible candidate and stays off; plan warnings pass through', async () => {
  await fixture(async h => {
    await h.api.setAgentPluginEnabled({ workspaceId, pluginId, enabled: false, actor: 'owner' });
    const incompatible = archiveInput(h.layout, '2.0.0', { hostRange: '>=99' });
    const updated = await h.api.updateAgentPlugin({ ...h.input, ...incompatible });
    expect(updated).toMatchObject({ enabled: false, alreadyInstalled: false, warnings: [] });
    const sameVersion = archiveInput(h.layout, '2.0.0', { provides: ['cap:old'] }, { salt: ' rebuilt' });
    const rebuilt = await h.api.updateAgentPlugin({ ...h.input, ...sameVersion, expectedOldDigest: incompatible.expectedSha256 });
    expect(rebuilt.warnings).toEqual(['Same version with different bytes; explicit replacement required.']);
    expect(await verdict(h)).toBe('inactive');
    expect(await liveDigests(h)).toEqual([sameVersion.expectedSha256]);
  });
});

test('dependents that lose a provided capability are named; a candidate that keeps it warns nothing', async () => {
  await fixture(async h => {
    const dependent = await h.api.installAgentPlugin(archiveInput(h.layout, '1.0.0', { requires: ['cap:old'] }, { name: 'dependent-plugin' }));
    expect(dependent.pluginId).toBe('dependent-plugin');
    const keeps = archiveInput(h.layout, '1.5.0', { provides: ['cap:old'] });
    expect((await h.api.updateAgentPlugin({ ...h.input, ...keeps })).warnings).toEqual([]);
    const drops = await h.api.updateAgentPlugin({ ...h.input, expectedOldDigest: keeps.expectedSha256 });
    expect(drops.warnings).toEqual(['dependent-plugin needs cap:old']);
  });
});

test('a host-supplied candidate without a provides list is treated as providing nothing', async () => {
  await fixture(async h => {
    await h.api.installAgentPlugin(archiveInput(h.layout, '1.0.0', { requires: ['cap:old'] }, { name: 'dependent-plugin' }));
    const install = createInstallModule(h.context).installAgentPlugin;
    const update = createUpdateModule(h.context, { installAgentPlugin: (required, optional) => install(required, {
      publishGuard: ({ plugin, publish }) => optional.publishGuard!({ plugin: { ...plugin, provides: undefined }, publish }, {}),
    }) });
    const result = await update.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '2.0.0', { provides: ['cap:old'] }) });
    expect(result.warnings).toEqual(['dependent-plugin needs cap:old']);
  });
});

test('snapshot failure happens before intent or activation mutation', async () => {
  await fixture(async h => {
    await expect(h.api.updateAgentPlugin({ ...h.input, snapshotSettings: async () => { throw new Error('snapshot unavailable'); } })).rejects.toThrow('snapshot unavailable');
    expect(await h.store.read({})).toBeUndefined();
    expect(await verdict(h)).toBe('active');
    expect(await liveDigests(h)).toEqual([h.previous.archiveDigest]);
  });
});

test('failure moving the old revision aside keeps it live and enabled', async () => {
  await fixture(async h => {
    const api = faulty(h, { rename: to => to.includes(`${path.sep}rollback${path.sep}`) });
    await expect(api.updateAgentPlugin(h.input)).rejects.toThrow('rename refused');
    await expectRestored(h, 'active');
    expect(h.events).toEqual([]);
  });
});

test('failure publishing the candidate restores the old revision with its disabled decision', async () => {
  await fixture(async h => {
    await h.api.setAgentPluginEnabled({ workspaceId, pluginId, enabled: false, actor: 'owner' });
    const api = faulty(h, { rename: to => to === path.join(h.workspace.pluginPackagesDir({ pluginId }), h.input.expectedSha256) });
    const failure = await api.updateAgentPlugin(h.input).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: expect.stringContaining('failed to publish') });
    await expectRestored(h, 'inactive');
  });
});

test('failure recording the published state, after publish, removes the candidate without MCP churn', async () => {
  await fixture(async h => {
    const api = faulty(h, { rename: nth(to => to.endsWith('update-journal.json'), 2) });
    await expect(api.updateAgentPlugin(h.input)).rejects.toThrow('rename refused');
    await expectRestored(h, 'active');
    expect(h.events).toEqual([]);
  });
});

test('failure re-activating the candidate, and failure committing, both roll back and reprovision the old revision', async () => {
  await fixture(async h => {
    const activation = faulty(h, { rename: nth(to => to.endsWith('activations.json'), 2) });
    await expect(activation.updateAgentPlugin(h.input)).rejects.toThrow('rename refused');
    await expectRestored(h, 'active');
    expect(h.events).toEqual(['provision:1.0.0', 'notify']);
  });
  await fixture(async h => {
    const commit = faulty(h, { rename: nth(to => to.endsWith('update-journal.json'), 3) });
    await expect(commit.updateAgentPlugin(h.input)).rejects.toThrow('rename refused');
    await expectRestored(h, 'active');
    expect(h.events).toEqual(['provision:2.0.0', 'notify', 'provision:1.0.0', 'notify']);
  });
});

test('an incomplete rollback keeps the journal, blocks updates until boot, and boot recovers; a malformed journal refuses recovery', async () => {
  let failRestore = false;
  await fixture(async h => {
    const instrumented = faulty(h, { rename: to => failRestore && to.includes(path.join(h.workspace.pluginPackagesDir({ pluginId }), h.previous.archiveDigest)) },
      { mcpProvisioning: { ...ports.mcpProvisioning, provision: async () => { failRestore = true; throw new Error('activate failed'); } } });
    const failure = await instrumented.updateAgentPlugin(h.input).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'PLUGIN_ROLLBACK_INCOMPLETE' });
    const causes = ((failure as Error).cause as AggregateError).errors.map((error: Error) => error.message);
    expect(causes).toEqual(['activate failed', expect.stringContaining('rename refused')]);
    expect((await h.store.read({}))?.state).toBe('published');
    await expect(instrumented.updateAgentPlugin(h.input)).rejects.toMatchObject({ code: 'PLUGIN_UPDATE_PENDING' });
    failRestore = false;
    await h.api.reconcileAgentPluginUpdates({ workspaceId });
    expect((await h.api.listInstalledPlugins({ workspaceRoot: h.workspaceRoot })).map(p => p.version)).toEqual(['1.0.0']);
    await expectRestored(h, 'active');
    expect((await h.api.updateAgentPlugin(h.input)).plugin.version).toBe('2.0.0');
    const journalPath = path.join(h.pluginRoot, 'update-journal.json');
    for (const value of ['{', 'null', '{}']) {
      await fs.writeFile(journalPath, value);
      await expect(h.api.reconcileAgentPluginUpdates({ workspaceId })).rejects.toMatchObject({ code: 'UPDATE_JOURNAL_INVALID' });
      await expect(h.api.updateAgentPlugin(h.input)).rejects.toMatchObject({ code: 'UPDATE_JOURNAL_INVALID' });
    }
  });
});

test('a stale rollback copy of the same digest is replaced, not collided with', async () => {
  await fixture(async h => {
    const stale = h.store.rollbackRoot({ digest: h.previous.archiveDigest });
    await fs.mkdir(path.join(stale, 'leftover'), { recursive: true });
    await fs.writeFile(path.join(stale, 'leftover', 'junk.txt'), 'stale');
    await fs.chmod(path.join(stale, 'leftover'), 0o555); await fs.chmod(stale, 0o555);
    const result = await h.api.updateAgentPlugin(h.input);
    expect(result.plugin.version).toBe('2.0.0');
    expect((await fs.readdir(stale)).sort()).toEqual(['plugin.json', 'skills']);
    expect(JSON.parse(await fs.readFile(path.join(stale, 'plugin.json'), 'utf8')).version).toBe('1.0.0');
  });
});

test('unversioned revisions update, then a later update freezes a fresh rollback over the retained one', async () => {
  await fixture(async h => {
    const first = archiveInput(h.layout, undefined, {}, { salt: ' a' });
    const a = await h.api.updateAgentPlugin({ ...h.input, ...first });
    expect(a.warnings).toEqual(['Unknown release version; explicit replacement required.']);
    const second = archiveInput(h.layout, undefined, {}, { salt: ' b' });
    await h.api.updateAgentPlugin({ ...h.input, ...second, expectedOldDigest: first.expectedSha256 });
    const back = await h.api.updateAgentPlugin({ ...h.input, ...first, expectedOldDigest: second.expectedSha256 });
    expect(back.plugin.archiveDigest).toBe(first.expectedSha256);
    // rollback/<first> is now a stale copy of the live digest; updating from it must still work.
    const third = archiveInput(h.layout, '3.0.0');
    expect((await h.api.updateAgentPlugin({ ...h.input, ...third, expectedOldDigest: first.expectedSha256 })).plugin.version).toBe('3.0.0');
    expect(await liveDigests(h)).toEqual([third.expectedSha256]);
    await h.api.reconcileAgentPluginUpdates({ workspaceId });
    expect(await fs.readdir(path.join(h.pluginRoot, 'rollback'))).toEqual([]);
    expect((await history(h)).map(entry => entry.result)).toEqual(['updated', 'updated', 'updated', 'updated']);
  });
});

test('an audit filing failure after commit keeps the update and defers filing to the next update or boot', async () => {
  for (const withEvents of [true, false]) {
    await fixture(async h => {
      const overrides = withEvents ? {} : { onEvent: undefined };
      const api = faulty(h, { rename: to => to.includes(`${path.sep}update-history${path.sep}`) }, overrides);
      const result = await api.updateAgentPlugin(h.input);
      expect(result.plugin.version).toBe('2.0.0');
      expect(h.warnings).toEqual(withEvents ? ['agent-plugin-update-audit-deferred'] : []);
      expect(await h.store.read({})).toMatchObject({ state: 'committed', result: 'updated' });
      if (withEvents) {
        // The next update files the committed record before it starts its own transaction.
        await h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '3.0.0'), expectedOldDigest: result.plugin.archiveDigest });
        expect((await history(h)).map(entry => entry.toVersion).sort()).toEqual(['2.0.0', '3.0.0']);
      } else {
        await h.api.reconcileAgentPluginUpdates({ workspaceId });
        expect(await history(h)).toEqual([expect.objectContaining({ toVersion: '2.0.0', result: 'updated' })]);
      }
      expect(await h.store.read({})).toBeUndefined();
    });
  }
});

test('an installer that never runs the publish guard is reported, not returned as undefined', async () => {
  await fixture(async h => {
    const update = createUpdateModule(h.context, { installAgentPlugin: async () => h.previous });
    await expect(update.updateAgentPlugin(h.input)).rejects.toMatchObject({ code: 'PLUGIN_UPDATE_NOT_RUN' });
  });
});

test('boot skips reserved and invalid workspace entries instead of crashing', async () => {
  await fixture(async h => {
    for (const name of ['staging', 'packages', 'memory', 'data', 'Bad_Name', 'x'.repeat(65)]) await fs.mkdir(path.join(h.workspaceRoot, name), { recursive: true });
    await fs.writeFile(path.join(h.workspaceRoot, 'loose-file'), '');
    await expect(h.api.reconcileAgentPluginUpdates({ workspaceId })).resolves.toBeUndefined();
    await expect(h.api.reconcileAgentPluginUpdates({ workspaceId: 'never-used' })).resolves.toBeUndefined();
  });
});

test('boot files a committed journal, keeps non-digest rollback entries, and recovers other plugins past a broken one', async () => {
  await fixture(async h => {
    await h.api.installAgentPlugin(archiveInput(h.layout, '1.0.0', {}, { name: 'second-plugin' }));
    const second = createAgentPluginUpdateStore({ ports: h.context, workspaceId, pluginId: 'second-plugin' });
    const committed: AgentPluginUpdateJournal = { schemaVersion: 1, state: 'committed', transactionId: 'tx-1', pluginId: 'second-plugin', actor: 'owner',
      enabled: true, fromDigest: 'a'.repeat(64), toDigest: 'b'.repeat(64), settingsSnapshot: null, startedAt: 'now', result: 'updated' };
    await second.write({ journal: committed });
    await second.prepare({});
    await fs.writeFile(path.join(second.rollbackDir, 'notes.txt'), 'kept');
    await fs.mkdir(path.join(second.rollbackDir, 'not-a-digest'));
    await fs.writeFile(path.join(h.pluginRoot, 'update-journal.json'), '{');
    await expect(h.api.reconcileAgentPluginUpdates({ workspaceId })).rejects.toMatchObject({ code: 'UPDATE_JOURNAL_INVALID' });
    expect(h.warnings).toEqual(['agent-plugin-update-recovery-failed']);
    expect(await second.read({})).toBeUndefined();
    expect(JSON.parse(await fs.readFile(path.join(h.workspace.pluginRootDir({ pluginId: 'second-plugin' }), 'update-history', 'tx-1.json'), 'utf8'))).toEqual(committed);
    expect((await fs.readdir(second.rollbackDir)).sort()).toEqual(['not-a-digest', 'notes.txt']);
  });
  await fixture(async h => {
    await fs.writeFile(path.join(h.pluginRoot, 'update-journal.json'), '{');
    const { onEvent: _observed, ...required } = h.context;
    const quiet = createAgentPluginLifecycle(required);
    await expect(quiet.reconcileAgentPluginUpdates({ workspaceId })).rejects.toMatchObject({ code: 'UPDATE_JOURNAL_INVALID' });
    expect(h.warnings).toEqual([]);
  });
});

test('boot refuses a journal whose previous bytes are gone and keeps it for repair', async () => {
  await fixture(async h => {
    const journal: AgentPluginUpdateJournal = { schemaVersion: 1, state: 'pending', transactionId: 'tx-missing', pluginId, actor: 'owner',
      enabled: true, fromDigest: 'c'.repeat(64), toDigest: h.previous.archiveDigest, settingsSnapshot: null, startedAt: 'now' };
    await h.store.write({ journal });
    await expect(h.api.reconcileAgentPluginUpdates({ workspaceId })).rejects.toMatchObject({ code: 'PLUGIN_ROLLBACK_MISSING' });
    expect(await h.store.read({})).toEqual(journal);
    expect(await liveDigests(h)).toEqual([h.previous.archiveDigest]);
  });
});

test('boot surfaces filesystem faults other than a missing directory', async () => {
  await fixture(async h => {
    await expect(faulty(h, { readdir: dir => dir === h.workspaceRoot }).reconcileAgentPluginUpdates({ workspaceId })).rejects.toThrow('readdir refused');
    await h.store.prepare({});
    await expect(faulty(h, { readdir: dir => dir.endsWith(`${path.sep}rollback`) }).reconcileAgentPluginUpdates({ workspaceId })).rejects.toThrow('readdir refused');
    const journal: AgentPluginUpdateJournal = { schemaVersion: 1, state: 'pending', transactionId: 'tx-lstat', pluginId, actor: 'owner',
      enabled: true, fromDigest: h.previous.archiveDigest, toDigest: 'd'.repeat(64), settingsSnapshot: null, startedAt: 'now' };
    await h.store.write({ journal });
    await expect(faulty(h, { lstat: () => true }).reconcileAgentPluginUpdates({ workspaceId })).rejects.toThrow('lstat refused');
    expect(await h.store.read({})).toEqual(journal);
    await h.api.reconcileAgentPluginUpdates({ workspaceId });
    expect(await h.store.read({})).toBeUndefined();
    expect(await liveDigests(h)).toEqual([h.previous.archiveDigest]);
  });
});

test('the journal store validates every field it later trusts', async () => {
  await fixture(async h => {
    const valid = { schemaVersion: 1, state: 'pending', transactionId: 'tx-ok', pluginId, actor: 'owner', enabled: false,
      fromDigest: 'a'.repeat(64), toDigest: 'b'.repeat(64), settingsSnapshot: null, startedAt: 'now' };
    const journalPath = path.join(h.pluginRoot, 'update-journal.json');
    await fs.writeFile(journalPath, JSON.stringify(valid));
    expect(await h.store.read({})).toEqual(valid);
    const invalid: unknown[] = ['text', null, { ...valid, schemaVersion: 2 }, { ...valid, pluginId: 'other' }, { ...valid, actor: 1 },
      { ...valid, enabled: 'yes' }, { ...valid, toDigest: valid.fromDigest }, { ...valid, fromDigest: '../escape' }, { ...valid, toDigest: 7 },
      { ...valid, state: 'done' }, { ...valid, transactionId: '../x' }, { ...valid, transactionId: 5 }, { ...valid, startedAt: 1 }];
    for (const value of invalid) {
      await fs.writeFile(journalPath, JSON.stringify(value));
      await expect(h.store.read({})).rejects.toMatchObject({ code: 'UPDATE_JOURNAL_INVALID' });
    }
    await fs.writeFile(journalPath, '{');
    const parseFailure = await h.store.read({}).catch((error: unknown) => error);
    expect(parseFailure).toBeInstanceOf(AgentPluginUpdateError);
    expect((parseFailure as Error).cause).toBeInstanceOf(SyntaxError);
    await fs.rm(journalPath); await fs.mkdir(journalPath);
    await expect(h.store.read({})).rejects.toMatchObject({ code: 'EISDIR' });
  });
});

test('isMissing recognizes only ENOENT-coded errors', () => {
  expect([undefined, 'ENOENT', null, {}, { code: 'EACCES' }, { code: 'ENOENT' }].map(error => isMissing({ error }))).toEqual([false, false, false, false, false, true]);
});
