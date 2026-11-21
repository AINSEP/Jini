import * as nativeFilesystem from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { readBootIdentity, withFileLock } from '@jini-ai/platform/fs/file-lock';
import type { AgentPluginLifecyclePorts } from '../../ports.js';

/** 2^48 - 1: crypto.randomInt's largest exclusive bound. */
const RANDOM_RESOLUTION = 2 ** 48 - 1;

/**
 * Real-disk effects for this package's own tests. The Node binding hosts use lives in
 * `@jini-ai/node-adapters/agent-plugins` (and is tested there); agent-plugins cannot import it
 * (node-adapters depends on agent-plugins' port types), and the stale-lock and journal tests here
 * need a REAL lock and writer, so the fakes of `@jini-ai/core/contracts/runtime/testing` do not fit.
 */
export function nativeEffectsFixture(): Pick<AgentPluginLifecyclePorts, 'filesystem' | 'fileLock' | 'atomicWriter' | 'clock' | 'ids' | 'process'> {
  return {
    filesystem: nativeFilesystem,
    fileLock: { withFileLock },
    atomicWriter: { writeJson: writeJsonFileAtomicAsync },
    clock: { nowMs: () => Date.now(), monotonicMs: () => performance.now(), sleep: ({ ms }) => setTimeout(ms) },
    ids: { newId: () => randomUUID(), random: () => randomInt(RANDOM_RESOLUTION) / RANDOM_RESOLUTION },
    process: {
      pid: process.pid,
      platform: process.platform,
      hostname: () => os.hostname(),
      bootIdentity: () => readBootIdentity({}),
      isAlive: ({ pid }) => {
        if (!Number.isSafeInteger(pid) || pid <= 0) return false;
        try { process.kill(pid, 0); return true; } catch (error) { return !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'); }
      },
    },
  };
}
