import { backupOriginalOnce, withFileLock, writeFileAtomicAsync, writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from '@jini-ai/platform/process';
import { createAtomicWriterPort, createFileLockPort } from '@jini-ai/node-adapters/fs';
import { createProcessControlPort } from '@jini-ai/node-adapters/process';
import type { KernelOsPorts } from '../../kernel-base.js';

/** The OS ports a real Node host binds into the kernel (node-adapters' builders over platform's
 * functions), so tests exercise production behaviour. */
export const nodeOsPorts: KernelOsPorts = {
  processes: createProcessControlPort({ functions: { listProcessSnapshots, stopProcesses, waitForProcessExit } }),
  fileLock: createFileLockPort({ withFileLock }),
  writer: createAtomicWriterPort({ writeFileAtomicAsync, writeJsonFileAtomicAsync, backupOriginalOnce }),
};
