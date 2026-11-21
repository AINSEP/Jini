/**
 * @file The lifecycle takes its file lock and its atomic journal writer as required ports, and passes
 * them exactly the options it passed to the platform functions before: argument shapes, the
 * `filesystem` (lock) versus `fs` (writer) option names, and the error a lock refusal becomes.
 */
import { afterEach, describe, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileLockTimeoutError, type FileLockPort } from '@jini-ai/core/contracts/runtime';
import { fakeAtomicWriter, fakeFileLock } from '@jini-ai/core/contracts/runtime/testing';
import { ACTIVATIONS_LOCK_FILENAME, AgentPluginActivationsBusyError, createAgentPluginActivations } from '../../activation.js';
import { createPersistentStateModule } from '../../persistent-state.js';
import { createAgentPluginUpdateStore } from '../../update-store.js';
import { createAgentPluginLayout } from '../../layout.js';
import type { AgentPluginLifecyclePorts } from '../../ports.js';
import { ports as baseline } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });
async function tempRoot(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lifecycle-file-ports-')));
  temporaries.push(dir);
  return dir;
}

describe('activation write lock', () => {
  test('is taken on the activations lock with the 15s / 10s / 10ms budget and the injected filesystem', async () => {
    const root = await tempRoot();
    const fileLock = fakeFileLock();
    const activations = createAgentPluginActivations({ ...baseline, fileLock });
    await activations.setAgentPluginActivation({ workspaceRoot: root, pluginId: 'plugin-a', enabled: true, actor: 'operator' });
    expect(fileLock.calls).toHaveLength(1);
    const [call] = fileLock.calls;
    expect(call?.lockPath).toBe(path.join(root, ACTIVATIONS_LOCK_FILENAME));
    expect(call?.options).toMatchObject({ timeoutMs: 15_000, staleMs: 10_000, pollMs: 10 });
    expect((call?.options as { filesystem?: unknown }).filesystem).toBe(baseline.filesystem);
  });

  test('a lock timeout reaches the caller as the busy error naming its holder, and nothing is written', async () => {
    const root = await tempRoot();
    const holder = { pid: 4242, hostname: 'other-host', token: 'other-writer', acquiredAt: new Date(0).toISOString() };
    const fileLock: FileLockPort<AgentPluginLifecyclePorts['filesystem']> = {
      withFileLock: async ({ lockPath }) => { throw new FileLockTimeoutError({ lockPath, holder, waitedMs: 15_000 }); },
    };
    const activations = createAgentPluginActivations({ ...baseline, fileLock });
    const action = activations.setAgentPluginActivation({ workspaceRoot: root, pluginId: 'plugin-a', enabled: true, actor: 'operator' });
    await expect(action).rejects.toBeInstanceOf(AgentPluginActivationsBusyError);
    await expect(action).rejects.toMatchObject({ holder });
    await expect(fs.stat(path.join(root, 'activations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('any other lock failure reaches the caller unchanged', async () => {
    const root = await tempRoot();
    const failure = Object.assign(new Error('lock directory is read-only'), { code: 'EROFS' });
    const fileLock: FileLockPort<AgentPluginLifecyclePorts['filesystem']> = { withFileLock: async () => { throw failure; } };
    const activations = createAgentPluginActivations({ ...baseline, fileLock });
    await expect(activations.setAgentPluginActivation({ workspaceRoot: root, pluginId: 'plugin-a', enabled: true, actor: 'operator' }))
      .rejects.toBe(failure);
  });
});

describe('persistent state lock', () => {
  test('never ages out and creates its parent directory', async () => {
    const root = await tempRoot();
    const fileLock = fakeFileLock();
    const state = createPersistentStateModule({ ...baseline, fileLock });
    await state.withIdentityLock({ workspaceRoot: root, run: async () => undefined });
    expect(fileLock.calls.map(call => call.lockPath)).toEqual([path.join(root, '.publisher-identity.lock')]);
    expect(fileLock.calls[0]?.options).toMatchObject({ staleMs: Infinity, createParent: true });
    expect((fileLock.calls[0]?.options as { filesystem?: unknown }).filesystem).toBe(baseline.filesystem);
  });
});

describe('update journal write', () => {
  test('is private from creation and names the filesystem `fs`, not `filesystem`', async () => {
    const root = await tempRoot();
    const atomicWriter = fakeAtomicWriter();
    const layout = createAgentPluginLayout({ root });
    await fs.mkdir(layout.forWorkspace({ workspaceId: 'workspace-a' }).root, { recursive: true });
    const store = createAgentPluginUpdateStore({ ports: { ...baseline, layout, atomicWriter }, workspaceId: 'workspace-a', pluginId: 'plugin-a' });
    const journal = { schemaVersion: 1, state: 'pending', transactionId: 'tx-1', pluginId: 'plugin-a' } as unknown as Parameters<typeof store.write>[0]['journal'];
    await store.write({ journal });
    expect(atomicWriter.writes).toHaveLength(1);
    const [write] = atomicWriter.writes;
    expect(write?.method).toBe('writeJson');
    expect(path.basename(write?.filePath ?? '')).toBe('update-journal.json');
    expect(write?.options).toMatchObject({ createParent: true, mode: 0o600 });
    expect((write?.options as { fs?: unknown }).fs).toBe(baseline.filesystem);
    expect(write?.options).not.toHaveProperty('filesystem');
    expect(JSON.parse(String(atomicWriter.files.get(write?.filePath ?? '')))).toMatchObject({ transactionId: 'tx-1' });
  });
});
