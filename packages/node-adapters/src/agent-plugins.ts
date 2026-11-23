import * as nativeFilesystem from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import type { AtomicFileWriterPort, BootIdentity, FileLockPort } from '@jini-ai/core/contracts/runtime';
import type { Clock, IdGenerator } from '@jini-ai/core/primitives';

/* Structural slices of `@jini-ai/agent-plugins/lifecycle`'s `FilesystemPort`, `AgentPluginClockPort`,
 * `AgentPluginIdsPort` and `AgentPluginProcessPort`, restated so this binding names no other package
 * (K5; core cannot hold them: the filesystem slice is a `node:fs/promises` type). The contract test
 * assigns the result to the lifecycle's ports, so a drift on either side fails there. */
export type FilesystemPort = Pick<typeof nativeFilesystem,
  'chmod' | 'mkdir' | 'mkdtemp' | 'open' | 'readdir' | 'readFile' | 'rename' |
  'rm' | 'rmdir' | 'stat' | 'lstat' | 'realpath' | 'unlink'>;
export type AgentPluginClockPort = Clock & { monotonicMs(): number; sleep(required: { readonly ms: number }): Promise<void> };
export type AgentPluginIdsPort = IdGenerator & { random(): number };
export interface AgentPluginProcessPort {
  readonly pid: number;
  readonly platform: NodeJS.Platform;
  hostname(required: Record<string, never>): string;
  isAlive(required: { readonly pid: number }): boolean;
  bootIdentity?(): BootIdentity | undefined;
}

/** The platform functions the effects bind; a Node host passes `@jini-ai/platform/fs`'s
 * `withFileLock`, `writeJsonFileAtomicAsync` and `readBootIdentity`. */
export interface AgentPluginPlatformFunctions {
  readonly withFileLock: FileLockPort<FilesystemPort>['withFileLock'];
  readonly writeJsonFileAtomicAsync: AtomicFileWriterPort<FilesystemPort>['writeJson'];
  readonly readBootIdentity: (required: Record<string, never>) => BootIdentity | undefined;
}

/** Granularity of the uniform [0, 1) value: crypto.randomInt's largest exclusive bound (2^48 - 1). */
const RANDOM_RESOLUTION = 2 ** 48 - 1;

/** Opt-in native effects. Layout, fetch, guard, namespace and provisioning remain host-owned.
 * `fileLock` and `atomicWriter` are the injected platform functions, which accept the lifecycle's
 * `filesystem` option (the `FileLockPort<never>` of `@jini-ai/node-adapters/fs` would refuse it). */
export function createNodeAgentPluginEffects(required: AgentPluginPlatformFunctions, optional: { readonly filesystem?: FilesystemPort } = {}): {
  filesystem: FilesystemPort;
  fileLock: FileLockPort<FilesystemPort>;
  atomicWriter: Pick<AtomicFileWriterPort<FilesystemPort>, 'writeJson'>;
  clock: AgentPluginClockPort;
  ids: AgentPluginIdsPort;
  process: AgentPluginProcessPort;
} {
  const { withFileLock, writeJsonFileAtomicAsync, readBootIdentity } = required;
  return {
    filesystem: optional.filesystem ?? nativeFilesystem,
    fileLock: { withFileLock } satisfies FileLockPort<FilesystemPort>,
    atomicWriter: { writeJson: writeJsonFileAtomicAsync } satisfies Pick<AtomicFileWriterPort<FilesystemPort>, 'writeJson'>,
    clock: {
      nowMs: () => Date.now(),
      monotonicMs: () => performance.now(),
      sleep: ({ ms }) => setTimeout(ms),
    },
    ids: { newId: () => randomUUID(), random: () => randomInt(RANDOM_RESOLUTION) / RANDOM_RESOLUTION },
    process: {
      pid: process.pid,
      platform: process.platform,
      hostname: () => os.hostname(),
      bootIdentity: () => readBootIdentity({}),
      isAlive: ({ pid }) => {
        if (!Number.isSafeInteger(pid) || pid <= 0) return false;
        try { process.kill(pid, 0); return true; }
        catch (error) { return !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'); }
      },
    },
  };
}
