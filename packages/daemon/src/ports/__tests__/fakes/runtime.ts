import type { AtomicFileWriterPort, FileLockPort } from '@jini-ai/core/contracts/runtime';
import type { AgentExecutorRuntimePorts } from '../../runtime.js';
import { createFakeChild, fakeProcessControl, fakeSpawn } from './process.js';

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

/**
 * A full {@link AgentExecutorRuntimePorts} from the fakes: one scripted child, an empty process
 * table, an in-memory lock and a recording writer sharing one effect log, and a pinned Linux shell.
 * Pass `overrides` for any member a test wants to script itself.
 */
export function fakeRuntimePorts(required: Record<string, never> = {}, overrides: Partial<AgentExecutorRuntimePorts> = {}): AgentExecutorRuntimePorts & { readonly log: EffectLog } {
  void required;
  const log: EffectLog = [];
  return {
    spawn: fakeSpawn({ children: [createFakeChild({ pid: 4242 })] }).spawn,
    processes: fakeProcessControl({ snapshots: [] }).port,
    fileLock: fakeFileLock({ log }),
    writer: fakeAtomicWriter({ log }),
    commandShell: { platform: 'linux', fallbackComSpec: undefined },
    ...overrides,
    log,
  };
}
