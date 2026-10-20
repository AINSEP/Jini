import { fromEarlierBoot, type BootIdentity } from "./boot-identity.js";
import type { DurableJsonFile } from "./durable-json.js";

export interface DirectoryRunningRecord {
  pid: number; port: number; app: string; started: string; token: string; scheme: "http" | "https"; bootId?: string;
}
export interface DirectoryRunningLock {
  peek(required: Record<string, never>, options?: {}): DirectoryRunningRecord | null;
  read(required: Record<string, never>, options?: {}): DirectoryRunningRecord | null;
  claim(required: { record: DirectoryRunningRecord }, options?: {}): { acquired: boolean; record: DirectoryRunningRecord };
  update(required: { token: string; port: number }, options?: {}): void;
  release(required: { token: string }, options?: {}): void;
}

/** A process lease is distinct from the brief file lock protecting its read/modify/write.
 * Only proven process death permits stale cleanup. Release/update require the unique claim token.
 * A zero port means boot is in progress and must still prevent a second database owner.
 * @complexity O(1) bounded JSON I/O and one liveness probe, plus the file lock wait.
 */
export function createDirectoryRunningLock(
  { file, isAlive, remove }: {
    file: DurableJsonFile; isAlive: (required: { pid: number }) => boolean; remove: () => void;
  }, { bootIdentity }: { bootIdentity?: () => BootIdentity | undefined } = {},
): DirectoryRunningLock {
  /** Validate before any mutation; corrupt or unreadable records fail closed. O(1) JSON I/O. */
  function readRecord(): DirectoryRunningRecord | null {
    const result = file.read({});
    if (result.state === "missing") return null;
    if (result.state !== "ok") throw new Error("The running lock is unreadable; refusing to open this directory's database.");
    const record = result.value as DirectoryRunningRecord | null;
    if (!validRunningRecord(record)) throw new Error("The running lock is invalid; refusing to open this directory's database.");
    return record;
  }
  function readLive(cleanup = true): DirectoryRunningRecord | null {
    const record = readRecord();
    if (!record) return null;
    const earlierBoot = fromEarlierBoot({ boot: bootIdentity?.(), bootId: record.bootId, atMs: Date.parse(record.started) });
    if (!earlierBoot && isAlive({ pid: record.pid })) return record;
    if (cleanup) remove(); return null;
  }
  return {
    peek: (_required, _optional = {}) => readLive(false),
    read: (_required, _optional = {}) => file.read({}).state === "missing" ? null : file.withLock({ critical: () => readLive() }),
    claim({ record }, _optional = {}) {
      if (!validRunningRecord(record)) throw new Error("Cannot claim an invalid running lock.");
      return file.withLock({ critical: () => {
        const existing = readLive();
        if (existing) return { acquired: false, record: existing };
        const boot = bootIdentity?.();
        const claimed = boot ? { ...record, bootId: boot.id } : record;
        file.write({ value: claimed }); return { acquired: true, record: claimed };
      } });
    },
    update({ token, port }, _optional = {}) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Running port must be between 1 and 65535.");
      file.withLock({ critical: () => {
        const record = readLive();
        if (!record || record.token !== token) throw new Error("Running lock ownership was lost.");
        file.write({ value: { ...record, port } });
      } });
    },
    release({ token }, _optional = {}) {
      if (file.read({}).state === "missing") return;
      // Release removes only its own record; stale cleanup of a different owner belongs to read/claim.
      file.withLock({ critical: () => { if (readRecord()?.token === token) remove(); } });
    },
  };
}

function validRunningRecord(value: unknown): value is DirectoryRunningRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as DirectoryRunningRecord;
  return Number.isSafeInteger(record.pid) && record.pid > 0 && Number.isInteger(record.port) && record.port >= 0 && record.port <= 65535 &&
    typeof record.app === "string" && record.app.length > 0 && typeof record.token === "string" && record.token.length > 0 &&
    (record.bootId === undefined || typeof record.bootId === "string") && typeof record.started === "string" && Number.isFinite(Date.parse(record.started)) && ["http", "https"].includes(record.scheme);
}
