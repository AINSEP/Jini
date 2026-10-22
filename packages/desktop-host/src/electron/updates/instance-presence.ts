import path from 'node:path';
import type { InstanceRecord } from './update-policy.js';

/**
 * Concurrent instances need presence records because no single-instance lock tracks siblings:
 * one updater owner downloads, and only the last live instance may install on quit.
 * PID reuse can make a crashed instance look alive; delaying installation is the safe error.
 * Owner election separately ignores stale heartbeats so such a record cannot block all checks.
 */
/** No locking: each process owns one atomic presence record, permitting concurrent instances. */
export interface InstancePresencePort {
  write(input: { record: InstanceRecord }): void;
  readLive(): InstanceRecord[];
  remove(input: { pid: number }): void;
}
export interface PresenceFilesystemPort {
  mkdirSync(requiredArgs: { path: string }, optionalArgs?: { recursive?: boolean }): unknown;
  writeFileSync(requiredArgs: { path: string; data: string }): void;
  renameSync(requiredArgs: { oldPath: string; newPath: string }): void;
  unlinkSync(requiredArgs: { path: string }): void;
  readdirSync(requiredArgs: { path: string }): string[];
  readFileSync(requiredArgs: { path: string; encoding: 'utf8' }): string;
}
export interface FileInstancePresenceInput {
  directory: string;
  filesystem: PresenceFilesystemPort;
  isAlive: (args: { pid: number }) => boolean;
  writerPid: number;
}

/** Resolve a caller-named state directory. @complexity O(n) in path length. */
export function presenceDirPath({ userDataDir, directoryName }: { userDataDir: string; directoryName: string }): string {
  return path.join(userDataDir, directoryName);
}

/** Signal-zero liveness probe; EPERM still means alive. @complexity O(1). */
export function isPidAlive({ pid, probe }: { pid: number; probe: (args: { pid: number; signal: 0 }) => unknown }): boolean {
  try { probe({ pid, signal: 0 }); return true; }
  catch (error) { return (error as NodeJS.ErrnoException)?.code === 'EPERM'; }
}

/** Unreadable, partial and malformed records are ignored rather than deleted. @complexity O(n) in text length. */
function parseRecord(text: string): InstanceRecord | null {
  try {
    const record = JSON.parse(text) as InstanceRecord;
    if (!record || ![record.pid, record.startedAt, record.heartbeatAt].every(value => typeof value === 'number' && Number.isFinite(value))) return null;
    return record;
  } catch { return null; }
}

/** Atomic filesystem adapter. Writes propagate errors; reads and removals tolerate missing files.
 * @complexity O(1) to construct; O(n) files and probes per read.
 */
export function createFileInstancePresence({ directory, filesystem, isAlive, writerPid }: FileInstancePresenceInput): InstancePresencePort {
  const fileFor = (pid: number) => path.join(directory, `${pid}.json`);
  function remove({ pid }: { pid: number }): void {
    try { filesystem.unlinkSync({ path: fileFor(pid) }); } catch { /* Removal on exit is best effort. */ }
  }
  return {
    write({ record }) {
      // Publish by rename so a sibling never reads a half-written JSON record.
      filesystem.mkdirSync({ path: directory }, { recursive: true });
      const target = fileFor(record.pid);
      const temporary = `${target}.${writerPid}.tmp`;
      filesystem.writeFileSync({ path: temporary, data: JSON.stringify(record) });
      filesystem.renameSync({ oldPath: temporary, newPath: target });
    },
    remove,
    readLive() {
      let names: string[];
      try { names = filesystem.readdirSync({ path: directory }).filter(name => /^\d+\.json$/.test(name)); }
      catch { return []; }
      const live: InstanceRecord[] = [];
      for (const name of names) {
        let record: InstanceRecord | null;
        try { record = parseRecord(filesystem.readFileSync({ path: path.join(directory, name), encoding: 'utf8' })); }
        catch { continue; }
        // Leave unreadable/malformed records alone: a sibling may be writing on a filesystem
        // without atomic rename. Remove confirmed dead PIDs so crashes do not linger.
        if (record === null || name !== `${record.pid}.json`) continue;
        if (isAlive({ pid: record.pid })) live.push(record);
        else remove({ pid: record.pid });
      }
      return live;
    },
  };
}
