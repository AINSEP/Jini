import path from 'node:path';
import type { StrictRead } from './claim-sources.js';

/**
 * Filesystem the interlock uses. Sync writes exist only for startup registration, which must finish
 * before the host's ready event; async `writeFile` is expected to flush (fsync) before resolving.
 */
export interface PartitionFsPort {
  mkdirSync(required: { path: string }, optional?: { recursive?: boolean }): unknown;
  writeFileSync(required: { path: string; data: string }): void;
  renameSync(required: { oldPath: string; newPath: string }): void;
  unlinkSync(required: { path: string }): void;
  writeFile(required: { path: string; data: string }): Promise<void>;
  rename(required: { oldPath: string; newPath: string }): Promise<void>;
  readFile(required: { path: string }): Promise<string>;
  readdir(required: { path: string }): Promise<string[]>;
  lstat(required: { path: string }): Promise<{ isDirectory(): boolean; isSymbolicLink(): boolean }>;
  realpath(required: { path: string }): Promise<string>;
}
export interface PartitionProcessPort {
  pid: number;
  bootId: string;
  hostname: string;
  isAlive(required: { pid: number }): boolean;
  /** Lowercase hex; names this process's holder file. */
  newToken(): string;
}
export interface PartitionSchedulerPort {
  sleep(required: { ms: number }): Promise<void>;
  every(required: { ms: number; run: () => void }): { cancel(): void };
}
export interface HolderRecord {
  v: 1; pid: number; token: string; bootId: string; hostname: string; profile: string;
  startedAt: number; seq: number; intents: string[]; held: string[];
}

const HOLDER_NAME = /^(\d+)-([0-9a-f]+)\.json$/;
const RETRY_MS = 20;
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

export interface HolderRegistryInput {
  interlockDir: string; fs: PartitionFsPort; process: PartitionProcessPort; clock: { now(): number };
}

/** This process's own holder record: the only file it ever writes in `holders/`. @complexity O(1) per call. */
export function createHolderRegistry({ interlockDir, fs, process, clock }: HolderRegistryInput) {
  const dir = path.join(interlockDir, 'holders');
  const token = process.newToken();
  const file = path.join(dir, `${process.pid}-${token}.json`);
  const intents = new Set<string>(), held = new Set<string>();
  let seq = 0, startedAt = 0, writes = 0, registered = false;
  let queue: Promise<void> = Promise.resolve();
  const snapshot = (): string => JSON.stringify({
    v: 1, pid: process.pid, token, bootId: process.bootId, hostname: process.hostname, profile: interlockDir,
    startedAt, seq, intents: [...intents].sort(), held: [...held].sort(),
  } satisfies HolderRecord);
  const temporary = () => { writes += 1; return `${file}.${writes}.tmp`; };
  return {
    file, token, intents, held,
    get registered() { return registered; },
    register(): void {
      startedAt = clock.now();
      fs.mkdirSync({ path: dir }, { recursive: true });
      const temp = temporary();
      fs.writeFileSync({ path: temp, data: snapshot() });
      fs.renameSync({ oldPath: temp, newPath: file });
      registered = true;
    },
    /**
     * Publishes are chained and each serializes state when it runs, not when it is requested. Without
     * the chain a heartbeat snapshot taken before an intent was added could rename over the record
     * after it and silently withdraw the intent a sibling's pass relies on.
     */
    publish(): Promise<void> {
      const run = async () => {
        seq += 1;
        const temp = temporary();
        await fs.writeFile({ path: temp, data: snapshot() });
        await fs.rename({ oldPath: temp, newPath: file });
      };
      const next = queue.then(run, run);
      queue = next.catch(() => {});
      return next;
    },
    unregister(): void {
      registered = false;
      try { fs.unlinkSync({ path: file }); } catch { /* A crash leaves the file too; readers prove it dead. */ }
    },
  };
}
export type HolderRegistry = ReturnType<typeof createHolderRegistry>;

const isStringArray = (v: unknown) => Array.isArray(v) && v.every(item => typeof item === 'string');
function hasHolderShape(r: HolderRecord): boolean {
  return [r.bootId, r.hostname].every(v => typeof v === 'string') && Number.isFinite(r.seq) && isStringArray(r.intents) && isStringArray(r.held);
}
function parseHolder(text: string, pid: string, token: string): HolderRecord | null {
  try {
    const r = JSON.parse(text) as HolderRecord;
    const named = r?.v === 1 && String(r.pid) === pid && r.token === token;
    return named && hasHolderShape(r) ? r : null;
  } catch { return null; }
}

/** Liveness never uses record age: another host is unknown (kept), an earlier boot is dead, else the PID probe. */
function holderAlive(record: HolderRecord, process: PartitionProcessPort): boolean {
  if (record.hostname !== process.hostname) return true;
  if (record.bootId !== process.bootId) return false;
  return record.pid === process.pid || process.isAlive({ pid: record.pid });
}

type FileRead = { state: 'record'; record: HolderRecord } | { state: 'gone' } | { state: 'bad'; reason: string };
async function readOne(file: string, match: RegExpExecArray, fs: PartitionFsPort): Promise<FileRead> {
  try {
    const record = parseHolder(await fs.readFile({ path: file }), match[1]!, match[2]!);
    return record ? { state: 'record', record } : { state: 'bad', reason: `holder ${path.basename(file)} malformed` };
  } catch (error) {
    // Only the owner unlinks its record (on quit), so a vanished file is proof the holder left.
    if (code(error) === 'ENOENT') return { state: 'gone' };
    return { state: 'bad', reason: `holder ${path.basename(file)} unreadable (${code(error) ?? 'error'})` };
  }
}

async function listHolderNames(dir: string, fs: PartitionFsPort): Promise<StrictRead<string[]>> {
  try { return { state: 'ok', value: await fs.readdir({ path: dir }) }; }
  catch (error) {
    // No holders directory means no process of this profile ever registered: genuinely empty.
    if (code(error) === 'ENOENT') return { state: 'ok', value: [] };
    return { state: 'unknown', reason: `holders directory unreadable (${code(error) ?? 'error'})` };
  }
}

async function readWithRetry(file: string, match: RegExpExecArray, fs: PartitionFsPort, scheduler: PartitionSchedulerPort): Promise<FileRead> {
  const first = await readOne(file, match, fs);
  if (first.state !== 'bad') return first;
  await scheduler.sleep({ ms: RETRY_MS });
  return readOne(file, match, fs);
}

/**
 * Every live holder of this profile, or `unknown`. A bad record is re-read once after a short pause
 * (a writer on a filesystem without atomic rename), then fails the whole read closed.
 * @complexity O(n) records, at most two reads each.
 */
export async function readHoldersStrict(
  { interlockDir, fs, process, scheduler }: { interlockDir: string; fs: PartitionFsPort; process: PartitionProcessPort; scheduler: PartitionSchedulerPort },
  _optional: Record<string, never> = {},
): Promise<StrictRead<HolderRecord[]>> {
  const dir = path.join(interlockDir, 'holders');
  const listed = await listHolderNames(dir, fs);
  if (listed.state === 'unknown') return listed;
  const names = listed.value;
  const live: HolderRecord[] = [];
  for (const name of names) {
    const match = HOLDER_NAME.exec(name);
    if (!match) continue;
    const read = await readWithRetry(path.join(dir, name), match, fs, scheduler);
    if (read.state === 'bad') return { state: 'unknown', reason: read.reason };
    if (read.state === 'record' && holderAlive(read.record, process)) live.push(read.record);
  }
  return { state: 'ok', value: live };
}
