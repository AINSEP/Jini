import path from 'node:path';
import type { PresenceFilesystemPort } from './instance-presence.js';
import type { InstanceRecord } from './update-policy.js';

/**
 * Destructive callers need a reader that can say "I do not know". The tolerant `readLive` skips
 * unreadable records and returns no instances on a directory error, which is right for update
 * timing but would read an unreadable sibling as "no sibling" and authorize mutation. This reader
 * never removes files and turns every doubt into `unknown`.
 */
export type StrictPresenceRead =
  | { state: 'ok'; value: InstanceRecord[] }
  | { state: 'unknown'; reason: string };

export interface ReadPresenceStrictInput {
  directory: string;
  fs: Pick<PresenceFilesystemPort, 'readdirSync' | 'readFileSync'>;
  liveness: (args: { pid: number }) => boolean;
}

function isRecord(value: unknown, name: string): value is InstanceRecord {
  const record = value as InstanceRecord | null;
  if (!record || typeof record !== 'object') return false;
  const numeric = [record.pid, record.startedAt, record.heartbeatAt].every(v => typeof v === 'number' && Number.isFinite(v));
  return numeric && name === `${record.pid}.json`;
}

/** Live presence records, or `unknown` on any unreadable/malformed record or non-ENOENT directory error.
 * @complexity O(n) records and liveness probes.
 */
export function readPresenceStrict({ directory, fs, liveness }: ReadPresenceStrictInput, _optional: Record<string, never> = {}): StrictPresenceRead {
  let names: string[];
  try { names = fs.readdirSync({ path: directory }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { state: 'ok', value: [] };
    return { state: 'unknown', reason: `presence directory unreadable (${(error as NodeJS.ErrnoException)?.code ?? 'error'})` };
  }
  const live: InstanceRecord[] = [];
  for (const name of names.filter(entry => /^\d+\.json$/.test(entry))) {
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync({ path: path.join(directory, name), encoding: 'utf8' })); }
    catch (error) {
      // Only the owner (on quit) or a dead-PID sweep deletes a record, so a vanished file is proof of exit.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      return { state: 'unknown', reason: `presence record ${name} unreadable` };
    }
    if (!isRecord(parsed, name)) return { state: 'unknown', reason: `presence record ${name} malformed` };
    if (liveness({ pid: parsed.pid })) live.push(parsed);
  }
  return { state: 'ok', value: live };
}
