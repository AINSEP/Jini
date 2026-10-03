import * as nativeFilesystem from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import type { AgentPluginClockPort, AgentPluginIdsPort, AgentPluginProcessPort, FilesystemPort } from './ports.js';

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
    ids: { newId: () => randomUUID(), random: () => Math.random() },
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
