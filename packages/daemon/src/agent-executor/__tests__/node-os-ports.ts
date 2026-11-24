import { backupOriginalOnce, withFileLock, writeFileAtomicAsync, writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from '@jini-ai/platform/process';
import { createAtomicWriterPort, createFileLockPort } from '@jini-ai/node-adapters/fs';
import { createProcessControlPort } from '@jini-ai/node-adapters/process';

/** The host-side binding a Node host performs (node-adapters' builders over platform's functions),
 * so executor tests exercise the real lock, writer and process control. */
export const nodeFileLock = createFileLockPort({ withFileLock });
export const nodeAtomicWriter = createAtomicWriterPort({ writeFileAtomicAsync, writeJsonFileAtomicAsync, backupOriginalOnce });
export const nodeProcessControl = createProcessControlPort({ functions: { listProcessSnapshots, stopProcesses, waitForProcessExit } });
