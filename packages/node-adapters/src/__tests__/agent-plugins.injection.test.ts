/**
 * @file The agent-plugin effects bind exactly the platform functions the host injects (K5: this package
 * imports no other package's implementation). Recording fakes, so a binding that reached for its own
 * copy of a platform function, or reshaped an argument on the way, fails here.
 */
import { expect, test, vi } from 'vitest';
import type { BootIdentity, HeldFileLock } from '@jini-ai/core/contracts/runtime';
import { createNodeAgentPluginEffects, type AgentPluginPlatformFunctions } from '../agent-plugins.js';

/** `vi.fn` erases `withFileLock`'s type parameter, so the recorder is widened once here. */
const effectsOf = (functions: ReturnType<typeof recordingPlatform>['functions']) =>
  createNodeAgentPluginEffects(functions as unknown as AgentPluginPlatformFunctions);

function recordingPlatform() {
  const boot: BootIdentity = { id: 'boot-fake', startedAtMs: 7 };
  return {
    boot,
    functions: {
      withFileLock: vi.fn(async <T>(required: { lockPath: string; run: (lock: HeldFileLock) => Promise<T> | T }, _optional?: object) =>
        required.run({ lockPath: required.lockPath, assertHeld: async () => {} })),
      writeJsonFileAtomicAsync: vi.fn(async (_required: { filePath: string; data: unknown }, _optional?: object) => {}),
      readBootIdentity: vi.fn((_required: Record<string, never>) => boot),
    },
  };
}

test('fileLock.withFileLock is the injected function, called with the caller\'s own arguments', async () => {
  const { functions } = recordingPlatform();
  const effects = effectsOf(functions);
  const options = { createParent: true, timeoutMs: 5 };
  await expect(effects.fileLock.withFileLock({ lockPath: '/state/x.lock', run: () => 'ran' }, options)).resolves.toBe('ran');
  expect(functions.withFileLock).toHaveBeenCalledTimes(1);
  expect(functions.withFileLock.mock.calls[0]![0]).toMatchObject({ lockPath: '/state/x.lock' });
  expect(functions.withFileLock.mock.calls[0]![1]).toBe(options);
});

test('atomicWriter.writeJson is the injected writeJsonFileAtomicAsync, called with the caller\'s own arguments', async () => {
  const { functions } = recordingPlatform();
  const required = { filePath: '/state/journal.json', data: { state: 'pending' } };
  const options = { mode: 0o600 };
  await effectsOf(functions).atomicWriter.writeJson(required, options);
  expect(functions.writeJsonFileAtomicAsync.mock.calls).toEqual([[required, options]]);
  expect(functions.writeJsonFileAtomicAsync.mock.calls[0]![0]).toBe(required);
});

test('process.bootIdentity answers from the injected readBootIdentity, asked with an empty object', () => {
  const { functions, boot } = recordingPlatform();
  expect(effectsOf(functions).process.bootIdentity?.()).toBe(boot);
  expect(functions.readBootIdentity.mock.calls).toEqual([[{}]]);
});
