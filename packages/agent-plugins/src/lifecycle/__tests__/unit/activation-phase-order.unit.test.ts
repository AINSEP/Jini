import { afterEach, describe, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FileLockPort, HeldFileLock } from '@jini-ai/core/contracts/runtime';
import { ACTIVATIONS_FILENAME, AgentPluginActivationsUnreadableError, createAgentPluginActivations } from '../../activation.js';
import type { FilesystemPort } from '../../ports.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/**
 * @file Phase-order pins for the activation writers: lock, then strict read, then the durable
 * write (temp write, fsync, close, lock re-check, rename, directory fsync), then unlock. A read
 * taken outside the lock can erase a concurrent decision, and a rename before the lock re-check
 * lets a stalled holder commit after another process judged it stale.
 */

const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });
async function workspace(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'activation-order-')));
  temporaries.push(dir);
  return dir;
}

/** Short, stable label for a path the activation module touches; lock-file traffic is the lock port's own. */
function label(root: string, target: unknown): string | undefined {
  const value = String(target);
  if (value.includes('.lock')) return undefined;
  if (value === root) return 'dir';
  const base = path.basename(value);
  if (base === ACTIVATIONS_FILENAME) return 'file';
  return base.startsWith(`${ACTIVATIONS_FILENAME}.tmp-`) ? 'tmp' : base;
}

function wrapHandle(handle: fs.FileHandle, name: string, log: string[]): fs.FileHandle {
  return new Proxy(handle, { get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver) as unknown;
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => { if (['writeFile', 'sync', 'close'].includes(String(prop))) log.push(`${name}.${String(prop)}`); return (value as (...a: unknown[]) => unknown).apply(target, args); };
  } });
}

/** A recording filesystem plus file-lock port pair; every entry lands in `log` in call order. */
function recordingActivations(root: string, log: string[]) {
  const filesystem = new Proxy(ports.filesystem, { get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver) as unknown;
    if (typeof value !== 'function') return value;
    return async (...args: unknown[]) => {
      const name = label(root, args[0]);
      if (name !== undefined && ['mkdir', 'readFile', 'open', 'rename', 'rm'].includes(String(prop))) log.push(`${String(prop)}:${name}`);
      const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
      return prop === 'open' && name !== undefined ? wrapHandle(result as fs.FileHandle, name, log) : result;
    };
  } }) as FilesystemPort;
  const fileLock: FileLockPort<FilesystemPort> = {
    withFileLock: (required, optional) => ports.fileLock.withFileLock({ lockPath: required.lockPath, run: async (held: HeldFileLock) => {
      log.push('lock');
      const recorded: HeldFileLock = { lockPath: held.lockPath, assertHeld: async (input) => { log.push('assertHeld'); await held.assertHeld(input); } };
      try { return await required.run(recorded); } finally { log.push('unlock'); }
    } }, optional),
  };
  return createAgentPluginActivations({ filesystem, fileLock, clock: ports.clock, ids: ports.ids, process: { ...ports.process, platform: 'linux' } });
}

const DURABLE_WRITE = ['open:tmp', 'tmp.writeFile', 'tmp.sync', 'tmp.close', 'assertHeld', 'rename:tmp', 'open:dir', 'dir.sync', 'dir.close'];

describe('activation writer phase order', () => {
  test('a set takes the lock before its strict read and re-checks the lock before the rename', async () => {
    const root = await workspace();
    const log: string[] = [];
    await recordingActivations(root, log).setAgentPluginActivation({ workspaceRoot: root, pluginId: 'ordered', enabled: false, actor: 'operator' });
    expect(log).toEqual(['mkdir:dir', 'lock', 'readFile:file', ...DURABLE_WRITE, 'unlock']);
  });

  test('a reconcile resolves the canonical state inside the lock, then reads, then writes', async () => {
    const root = await workspace();
    const log: string[] = [];
    const changed = await recordingActivations(root, log).reconcileAgentPluginActivation({ workspaceRoot: root, pluginId: 'mirror', actor: 'operator',
      resolveEnabled: async () => { log.push('resolve'); return false; } });
    expect(changed).toBe(true);
    expect(log).toEqual(['mkdir:dir', 'lock', 'resolve', 'readFile:file', ...DURABLE_WRITE, 'unlock']);
  });

  test('a reconcile that matches the recorded state reads under the lock and writes nothing', async () => {
    const root = await workspace();
    const log: string[] = [];
    const changed = await recordingActivations(root, log).reconcileAgentPluginActivation({ workspaceRoot: root, pluginId: 'mirror', actor: 'operator', resolveEnabled: async () => true });
    expect(changed).toBe(false);
    expect(log).toEqual(['mkdir:dir', 'lock', 'readFile:file', 'unlock']);
  });

  test('a delete and a bundled seed follow the same lock, read, durable-write order', async () => {
    const root = await workspace();
    const log: string[] = [];
    const api = recordingActivations(root, log);
    await api.recordBundledAgentPluginIfAbsent({ workspaceRoot: root, pluginId: 'seeded' });
    await api.deleteAgentPluginActivation({ workspaceRoot: root, pluginId: 'seeded' });
    const turn = ['mkdir:dir', 'lock', 'readFile:file', ...DURABLE_WRITE, 'unlock'];
    expect(log).toEqual([...turn, ...turn]);
  });

  test('a malformed target entry is refused under the lock with the exact refusal text and nothing is written', async () => {
    const root = await workspace();
    const raw = `${JSON.stringify({ schemaVersion: 1, plugins: { broken: { enabled: 'yes' } } })}\n`;
    await fs.writeFile(path.join(root, ACTIVATIONS_FILENAME), raw, 'utf8');
    const log: string[] = [];
    const attempt = recordingActivations(root, log).setAgentPluginActivation({ workspaceRoot: root, pluginId: 'broken', enabled: true, actor: 'operator' });
    await expect(attempt).rejects.toBeInstanceOf(AgentPluginActivationsUnreadableError);
    await expect(attempt).rejects.toMatchObject({ message: expect.stringContaining(`${ACTIVATIONS_FILENAME} holds an unreadable record for 'broken', so it cannot be safely toggled`) });
    expect(log.slice(0, 3)).toEqual(['mkdir:dir', 'lock', 'readFile:file']);
    expect(log).not.toContain('open:tmp');
    expect(await fs.readFile(path.join(root, ACTIVATIONS_FILENAME), 'utf8')).toBe(raw);
  });

  test('an invalid id is refused before any lock or filesystem effect', async () => {
    const root = await workspace();
    const log: string[] = [];
    await expect(recordingActivations(root, log).deleteAgentPluginActivation({ workspaceRoot: root, pluginId: '../escape' }))
      .rejects.toThrow("agent-plugin activation: '../escape' is not a valid Agent Plugin id");
    expect(log).toEqual([]);
  });
});
