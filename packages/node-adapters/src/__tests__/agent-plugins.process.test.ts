/**
 * @file The Node agent-plugin effects' filesystem default and process port. Moved with the binding from
 * `@jini-ai/agent-plugins` (`lifecycle/__tests__/unit/{error-codes-and-grammar,lifecycle-edge-paths,stale-plugin-lock}`) in R11a;
 * assertions unchanged. Non-ESRCH faults are never read as "dead", whatever their shape.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as nativeFilesystem from 'node:fs/promises';
import { readBootIdentity } from '@jini-ai/platform/fs/file-lock';
import type { FilesystemPort } from '@jini-ai/agent-plugins/lifecycle';
import { createNodeAgentPluginEffects } from '../agent-plugins.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('createNodeAgentPluginEffects', () => {
  test('uses an injected filesystem, else node:fs/promises', () => {
    const fake = { ...nativeFilesystem } as FilesystemPort;
    expect(createNodeAgentPluginEffects({}, { filesystem: fake }).filesystem).toBe(fake);
    expect(createNodeAgentPluginEffects({}).filesystem).toBe(nativeFilesystem);
  });

  // `clock.sleep` is pinned with a controlled timer in agent-plugins.sleep.test.ts (FU-B).

  test.each<[string, unknown, boolean]>([
    ['ESRCH (no such process)', Object.assign(new Error('x'), { code: 'ESRCH' }), false],
    ['EPERM (exists, not ours)', Object.assign(new Error('x'), { code: 'EPERM' }), true],
    ['a thrown string', 'odd', true], ['a thrown null', null, true], ['an object without code', {}, true],
  ])('isAlive when kill throws %s -> %s', (_name, thrown, alive) => {
    vi.spyOn(process, 'kill').mockImplementation(() => { throw thrown; });
    expect(createNodeAgentPluginEffects({}).process.isAlive({ pid: 12345 })).toBe(alive);
  });

  test.each([[0], [-1], [1.5], [Number.NaN]])('isAlive(%s) is false without signalling', (pid) => {
    const kill = vi.spyOn(process, 'kill');
    expect(createNodeAgentPluginEffects({}).process.isAlive({ pid })).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });
});

describe('createNodeAgentPluginEffects process.isAlive', () => {
  const { process: host } = createNodeAgentPluginEffects({});
  test('a non-positive or non-integer pid is never alive', () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) expect(host.isAlive({ pid })).toBe(false);
  });
  test('the current process is alive and an exited child is not', async () => {
    expect(host.isAlive({ pid: process.pid })).toBe(true);
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise(resolve => child.on('exit', resolve));
    expect(host.isAlive({ pid: child.pid! })).toBe(false);
  });
});

test('the node process port records the kernel boot its locks are taken in', () => {
  expect(createNodeAgentPluginEffects({}).process.bootIdentity?.()).toEqual(readBootIdentity({}));
});
