import type { AtomicFileWriterPort, FileLockPort, ProcessControlPort } from "@jini-ai/core/contracts/runtime";
import { createNodeFileLock } from '../fs.js';
import { createNodeProcessControl } from '../process.js';
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from '@jini-ai/platform/process';

export const runtimePorts = {
  fileLock: createNodeFileLock({ env: {} }),
  processes: {
    listProcessSnapshots: (_r = {}, o = {}) => listProcessSnapshots({ env: {} }, o),
    stopProcesses: ({ pids }) => stopProcesses([...pids]),
    waitForProcessExit: ({ pid }, { timeoutMs } = {}) => waitForProcessExit(pid, timeoutMs),
  },
} satisfies { fileLock: FileLockPort; processes: ProcessControlPort };
export type { AtomicFileWriterPort };

// @ts-expect-error A native lock requires an explicit host environment map.
createNodeFileLock({});
// @ts-expect-error Native process enumeration requires an explicit host environment map.
createNodeProcessControl({});
