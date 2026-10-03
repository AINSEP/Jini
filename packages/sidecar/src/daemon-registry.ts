/**
 * @module daemon-registry
 *
 * A local daemon "where am I listening" registry: a small, atomically-written JSON pointer
 * file recording a running daemon's URL/host/port/pid, plus a liveness-checked reader so a
 * separate process (e.g. a CLI invocation) can discover it without trusting a stale record
 * left behind by a daemon that crashed rather than shutting down cleanly. Built on this
 * package's own `json-file.ts` (atomic write, forgiving read, guarded pointer removal) — the
 * exact primitives OD's sidecar already uses for its own `current.json` namespace pointer
 * (see `paths.ts`'s `resolvePointerPath`) — plus a new `isProcessAlive` liveness probe no
 * existing module in this package needed before. Depends on `node:path` and this package's
 * own `json-file.ts`.
 */

import { randomUUID } from "node:crypto";
import { link, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readJsonFile, removeFile, writeJsonFile } from "./json-file.js";

/** Default file name for a daemon's registry record, resolved relative to its `dataDir`. */
const DEFAULT_DAEMON_REGISTRY_FILE_NAME = "daemon.json";

/** A running local daemon's discoverable identity: where it listens and which process owns it. */
export interface LocalDaemonRegistryRecord {
  /** The daemon's real, resolved base URL (e.g. `http://127.0.0.1:54213`). */
  readonly url: string;
  /** The host the daemon is reachable on (already loopback-substituted — see `resolveReportHost`). */
  readonly host: string;
  /** The daemon's bound TCP port. */
  readonly port: number;
  /** The OS process id of the daemon process that wrote this record. */
  readonly pid: number;
  /** ISO-8601 timestamp of when the daemon started listening. */
  readonly startedAt: string;
}

/**
 * Resolve the on-disk path of a daemon's registry record, scoped to its `dataDir` by default —
 * the same per-instance isolation `dataDir` already provides for `<dataDir>/events.db`, so two
 * daemons on one machine (each with their own `dataDir`, already a hard requirement for two
 * independent sqlite files) never collide on a single global registry path.
 * @param dataDir - The daemon's own data directory (same value passed to `createLocalNodeDaemon`).
 * @param fileName - Override the record's file name. Defaults to `daemon.json`.
 * @returns The resolved absolute registry file path.
 * @throws When `dataDir` is not a non-empty string.
 */
export function resolveDaemonRegistryPath({ dataDir }: { dataDir: string }, { fileName = DEFAULT_DAEMON_REGISTRY_FILE_NAME }: { fileName?: string } = {}): string {
  if (typeof dataDir !== "string" || dataDir.trim().length === 0) {
    throw new Error("dataDir must be a non-empty string");
  }
  return join(resolve(dataDir), fileName);
}

/**
 * Durably (atomically, via `json-file.ts`'s temp-file-rename writer) record a daemon's identity
 * at `registryPath`. Safe under concurrent writers — the last writer to complete its rename wins,
 * and every reader only ever observes a fully-written file, never a partial one.
 */
export async function writeDaemonRegistryRecord({ registryPath, record }: { registryPath: string; record: LocalDaemonRegistryRecord }): Promise<void> {
  await writeJsonFile({ filePath: registryPath, payload: record });
}

/**
 * Remove a daemon's registry record at `registryPath`, but only if it still names `pid` as the
 * owning process — the same guarded-removal shape `json-file.ts`'s `removePointerIfCurrent` uses
 * for its own pointer file. Guards a fast crash-restart race on a reused `dataDir`: an old
 * daemon's delayed shutdown cleanup must never delete a newer daemon's already-written record.
 */
export async function removeDaemonRegistryRecordIfCurrent({ registryPath, pid }: { registryPath: string; pid: number }): Promise<void> {
  const record = await readJsonFile<{ pid?: unknown }>({ filePath: registryPath });
  if (record?.pid !== pid) return;

  // Detach first, then check the captured record: a writer may replace the public path
  // between the initial read and this rename. Only the captured file is ever removed.
  const tombstonePath = `${registryPath}.${process.pid}.${randomUUID()}.removed`;
  try {
    await rename(registryPath, tombstonePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const captured = await readJsonFile<{ pid?: unknown }>({ filePath: tombstonePath });
  if (captured?.pid !== pid) {
    try {
      // A hard link restores the captured file atomically ONLY if no newer record exists.
      // Rename would overwrite that newer writer. Keep the tombstone if restoration fails.
      await link(tombstonePath, registryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  await removeFile({ filePath: tombstonePath });
}

/**
 * Probe whether OS process `pid` is currently alive, via `process.kill(pid, 0)` (sends no
 * actual signal — `0` only tests deliverability). This is the liveness half of "verify, don't
 * just trust the file": a registry record left behind by a daemon that crashed instead of
 * shutting down cleanly must not be handed to a caller as if it were still reachable.
 * @param pid - The process id to probe.
 * @returns `true` when the process exists (either the signal-check succeeded, or it failed with
 * `EPERM` — the process exists but this process lacks permission to signal it, still "alive" for
 * discovery purposes). `false` for a non-positive/non-integer `pid`, a `pid` that does not exist
 * (`ESRCH`), or any other unexpected failure (treated conservatively as not confirmed alive).
 */
export function isProcessAlive({ pid }: { pid: number }): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "EPERM";
  }
}

/**
 * @internal Structural + type validation for a value read back from a registry file — a
 * cross-process JSON file is untrusted input (wrong version, hand-edited, truncated write from
 * a process that was killed mid-write despite the atomic-rename writer, etc.).
 */
function isValidRegistryRecord(value: unknown): value is LocalDaemonRegistryRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<LocalDaemonRegistryRecord>;
  return (
    typeof record.url === "string" &&
    record.url.length > 0 &&
    typeof record.host === "string" &&
    record.host.length > 0 &&
    typeof record.port === "number" &&
    Number.isInteger(record.port) &&
    record.port > 0 &&
    typeof record.pid === "number" &&
    Number.isInteger(record.pid) &&
    record.pid > 0 &&
    typeof record.startedAt === "string" &&
    record.startedAt.length > 0
  );
}

/**
 * Read a daemon's registry record at `registryPath` and return it only if it is well-formed AND
 * its recorded `pid` is still alive — the combined "read, don't just trust" discovery primitive a
 * CLI-side `resolveDaemonUrl({}, { discover })` probe needs. A stale record from a daemon that crashed
 * (pid no longer alive), a missing file, or a malformed/foreign JSON file all resolve to `null`
 * rather than throwing — discovery failing is an expected, non-exceptional outcome (the caller
 * falls through to its own `defaultUrl`/error, per `resolveDaemonUrl`'s own contract).
 * @returns The live record, or `null` when nothing live was found.
 */
export async function readLiveDaemonRegistryRecord({ registryPath }: { registryPath: string }): Promise<LocalDaemonRegistryRecord | null> {
  const record = await readJsonFile<unknown>({ filePath: registryPath });
  if (!isValidRegistryRecord(record)) return null;
  if (!isProcessAlive({ pid: record.pid })) return null;
  return record;
}
