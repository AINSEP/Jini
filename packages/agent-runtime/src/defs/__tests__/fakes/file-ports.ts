import { backupOriginalOnce, withFileLock, writeFileAtomicAsync, writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import type { AtomicFileWriterPort, FileLockPort } from '@jini-ai/core/contracts/runtime';

/** Ordered log of effects across the lock and writer fakes: `lock`, `unlock`, `backup:<path>`, `text:<path>`, `json:<path>`. */
export type EffectLog = string[];

/** An in-memory lock that runs the callback between `lock` and `unlock` entries, releasing on a throw too. */
export function fakeFileLock(required: { readonly log: EffectLog }, _optional: Record<string, never> = {}): FileLockPort {
  return {
    async withFileLock({ run }) {
      required.log.push('lock');
      try { return await run({ release: async () => {}, releaseSync: () => {} } as never); }
      finally { required.log.push('unlock'); }
    },
  };
}

/** A writer that records each call in order and writes nothing. `failOn` makes the named member reject. */
export function fakeAtomicWriter(required: { readonly log: EffectLog }, optional: { readonly failOn?: 'writeText' | 'writeJson' | 'backupOriginalOnce'; readonly failure?: unknown } = {}): AtomicFileWriterPort {
  const record = (member: 'writeText' | 'writeJson' | 'backupOriginalOnce', entry: string): Promise<void> => {
    required.log.push(entry);
    return optional.failOn === member ? Promise.reject(optional.failure ?? new Error(`${member} failed`)) : Promise.resolve();
  };
  return {
    writeText: ({ filePath }) => record('writeText', `text:${filePath}`),
    writeJson: ({ filePath }) => record('writeJson', `json:${filePath}`),
    backupOriginalOnce: ({ filePath }) => record('backupOriginalOnce', `backup:${filePath}`),
  };
}

/** The real lock and writer over `@jini-ai/platform/fs`, the binding a Node host performs, for tests that observe the file system. */
export const nodeFileLock: FileLockPort = { withFileLock };
export const nodeAtomicWriter: AtomicFileWriterPort = { writeText: writeFileAtomicAsync, writeJson: writeJsonFileAtomicAsync, backupOriginalOnce };
