import type { AtomicFileWriterPort, FileLockPort, ProcessControlPort, RuntimePlatform } from "@jini-ai/core/contracts/runtime";
import type { BlobStorage as CoreBlobStorage } from '@jini-ai/core/contracts/blob';
import { withFileLock } from '../fs/file-lock.js';
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from '../process.js';
import type { LocalBlobStorage } from '../blob-storage.js';

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const platformUnionInSync: Mutual<RuntimePlatform, NodeJS.Platform> = true;
export const localBlobSatisfies: LocalBlobStorage extends CoreBlobStorage<Buffer> ? true : never = true;

export const runtimePorts = {
  fileLock: { withFileLock },
  processes: {
    listProcessSnapshots: (_r = {}, o = {}) => listProcessSnapshots({}, o),
    stopProcesses: ({ pids }) => stopProcesses([...pids]),
    waitForProcessExit: ({ pid }, { timeoutMs } = {}) => waitForProcessExit(pid, timeoutMs),
  },
} satisfies { fileLock: FileLockPort; processes: ProcessControlPort };
export type { AtomicFileWriterPort };
