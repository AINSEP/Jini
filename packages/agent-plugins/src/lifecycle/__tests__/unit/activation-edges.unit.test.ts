import { afterEach, describe, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACTIVATIONS_FILENAME, AgentPluginActivationsBusyError, createAgentPluginActivations } from '../../activation.js';
import type { FilesystemPort } from '../../ports.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/**
 * @file `createAgentPluginActivations` — the activation-only object API a host binds without the
 * rest of the lifecycle — plus the unreadable-file, platform and best-effort-fsync paths of the
 * shared activation module, driven through injected filesystem/process ports.
 */

const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });
async function workspace(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'activation-edges-')));
  temporaries.push(dir);
  return dir;
}
const { filesystem, clock, ids, process: hostProcess } = ports;
/** Each call gets a fresh port object, so each gets its own activation module instance. */
function activations(overrides: { filesystem?: FilesystemPort; platform?: NodeJS.Platform } = {}, onEvent?: (event: { message: string }) => void) {
  const required = { filesystem: overrides.filesystem ?? filesystem, clock, ids,
    process: overrides.platform ? { ...hostProcess, platform: overrides.platform } : hostProcess };
  return onEvent ? createAgentPluginActivations(required, { onEvent }) : createAgentPluginActivations(required);
}

describe('createAgentPluginActivations object API', () => {
  test('writes, reads, resolves, filters and deletes decisions for one workspace', async () => {
    const root = await workspace();
    const api = activations({}, () => undefined);
    await api.assertAgentPluginActivationsWritable({ workspaceRoot: root });
    const written = await api.setAgentPluginActivation({ workspaceRoot: root, pluginId: 'off-plugin', enabled: false, actor: 'operator' },
      { now: () => new Date('2026-03-04T05:06:07.000Z') });
    expect(written.plugins['off-plugin']).toEqual({ enabled: false, origin: 'operator-installed', updatedAt: '2026-03-04T05:06:07.000Z', updatedBy: 'operator' });
    const read = await api.readAgentPluginActivations({ workspaceRoot: root });
    expect(api.normalizeActivations({ value: JSON.parse(await fs.readFile(path.join(root, ACTIVATIONS_FILENAME), 'utf8')) })).toEqual(read);
    expect(api.isAgentPluginActive({ activations: read, pluginId: 'off-plugin' })).toBe(false);
    expect(api.filterActiveAgentPlugins({ activations: read, items: ['off-plugin', 'unrecorded'], pluginIdOf: ({ item }) => item })).toEqual(['unrecorded']);
    expect((await api.resolveAgentPluginActivation({ workspaceRoot: root, pluginId: 'off-plugin' })).verdict).toBe('inactive');
    expect(await api.isAgentPluginRecordedAsBundled({ workspaceRoot: root, pluginId: 'off-plugin' })).toBe(false);
    await api.deleteAgentPluginActivation({ workspaceRoot: root, pluginId: 'off-plugin' });
    expect((await api.readAgentPluginActivations({ workspaceRoot: root })).plugins).toEqual({});
  });

  test('bundled seeding records the given time, origin and seed actor', async () => {
    const root = await workspace();
    const api = activations();
    const now = () => new Date('2026-05-06T07:08:09.000Z');
    expect(await api.recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: 'bundled-one' }, { now, enabled: true })).toMatchObject({ recorded: true });
    const read = await api.readAgentPluginActivations({ workspaceRoot: root });
    expect(read.plugins['bundled-one']).toMatchObject({ enabled: true, origin: 'bundled', updatedAt: '2026-05-06T07:08:09.000Z' });
    expect(await api.isAgentPluginRecordedAsBundled({ workspaceRoot: root, pluginId: 'bundled-one' })).toBe(true);
  });
});

describe('unreadable activation files', () => {
  test('a read fault other than ENOENT makes the decision undetermined, naming the fault', async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, ACTIVATIONS_FILENAME));
    const verdict = await activations().resolveAgentPluginActivation({ workspaceRoot: root, pluginId: 'any' });
    expect(verdict).toMatchObject({ verdict: 'undetermined' });
    expect((verdict as { reason: string }).reason).toContain(`${ACTIVATIONS_FILENAME} could not be read (`);
    expect((verdict as { reason: string }).reason).toContain('EISDIR');
  });
  test.each([
    ['a thrown string', 'disk on fire', '(disk on fire)'],
    ['an object with a numeric code', { code: 5 }, '([object Object])'],
  ])('%s from the filesystem is still reported as unreadable, not as absent', async (_label, thrown, rendered) => {
    const root = await workspace();
    const failing = { ...filesystem, readFile: (async () => { throw thrown; }) as FilesystemPort['readFile'] } as FilesystemPort;
    const verdict = await activations({ filesystem: failing }).resolveAgentPluginActivation({ workspaceRoot: root, pluginId: 'any' });
    expect(verdict).toEqual({ verdict: 'undetermined', reason: `${ACTIVATIONS_FILENAME} could not be read ${rendered}` });
  });
});

describe('durable write platform handling', () => {
  test('win32 skips the directory fsync, which cannot open a directory there', async () => {
    const root = await workspace();
    const opened: string[] = [];
    const tracking = { ...filesystem, open: (async (target: string, ...rest: [string?, number?]) => {
      opened.push(target);
      return filesystem.open(target, ...rest);
    }) as FilesystemPort['open'] } as FilesystemPort;
    await activations({ filesystem: tracking, platform: 'win32' }).setAgentPluginActivation({ workspaceRoot: root, pluginId: 'p', enabled: true, actor: 'operator' });
    expect(opened).not.toContain(root);
    expect((await activations().readAgentPluginActivations({ workspaceRoot: root })).plugins['p']).toMatchObject({ enabled: true });
  });
  test('a directory fsync failure is swallowed because the rename already landed', async () => {
    const root = await workspace();
    const failingDirOpen = { ...filesystem, open: (async (target: string, ...rest: [string?, number?]) => {
      if (target === root) throw Object.assign(new Error('EPERM: no directory handles'), { code: 'EPERM' });
      return filesystem.open(target, ...rest);
    }) as FilesystemPort['open'] } as FilesystemPort;
    const written = await activations({ filesystem: failingDirOpen, platform: 'linux' }).setAgentPluginActivation({ workspaceRoot: root, pluginId: 'p', enabled: false, actor: 'operator' });
    expect(written.plugins['p']).toMatchObject({ enabled: false });
    expect((await activations().readAgentPluginActivations({ workspaceRoot: root })).plugins['p']).toMatchObject({ enabled: false });
  });
});

test('a busy-lock error without a readable holder says the holder is unknown and that nothing was written', () => {
  const error = new AgentPluginActivationsBusyError({ lockPath: '/ws/activations.json.lock', holder: undefined, lost: false });
  expect(error.message).toContain('could not take the write lock (/ws/activations.json.lock) within 15s — holder unknown.');
  expect(error.message).toContain('Nothing was written');
  expect(error).toMatchObject({ lockPath: '/ws/activations.json.lock', holder: undefined, lost: false });
});
