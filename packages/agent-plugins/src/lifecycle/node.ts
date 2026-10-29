import * as nativeFilesystem from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import type { AgentPluginClockPort, AgentPluginIdsPort, AgentPluginProcessPort, FilesystemPort } from './ports.js';

/** Granularity of the uniform [0, 1) value: crypto.randomInt's largest exclusive bound (2^48 - 1). */
const RANDOM_RESOLUTION = 2 ** 48 - 1;

/** Opt-in native effects. Layout, fetch, guard, namespace and provisioning remain host-owned. */
export function createNodeAgentPluginEffects(_required: Record<string, never>, optional: { readonly filesystem?: FilesystemPort } = {}): {
  filesystem: FilesystemPort;
  clock: AgentPluginClockPort;
  ids: AgentPluginIdsPort;
  process: AgentPluginProcessPort;
} {
  return {
    filesystem: optional.filesystem ?? nativeFilesystem,
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
      isAlive: ({ pid }) => {
        if (!Number.isSafeInteger(pid) || pid <= 0) return false;
        try { process.kill(pid, 0); return true; }
        catch (error) { return !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'); }
      },
    },
  };
}
