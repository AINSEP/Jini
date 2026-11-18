import type { AtomicFileWriterPort, FileLockPort, ProcessControlPort } from "@jini-ai/core/contracts/runtime";
import { withFileLock } from '@jini-ai/platform/fs';
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from '@jini-ai/platform/process';

export const runtimePorts = {
  fileLock: { withFileLock },
  processes: {
    listProcessSnapshots: (_r = {}, o = {}) => listProcessSnapshots({}, o),
    stopProcesses: ({ pids }) => stopProcesses([...pids]),
    waitForProcessExit: ({ pid }, { timeoutMs } = {}) => waitForProcessExit(pid, timeoutMs),
  },
} satisfies { fileLock: FileLockPort; processes: ProcessControlPort };
export type { AtomicFileWriterPort };
