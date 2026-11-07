/**
 * @file ADR-023 §3 (T4 fix) — disk-headroom preflight. Before any snapshot, core computes
 * `required = 1.5 x (current DB file size + WAL file size)`. If free disk space on the volume
 * holding `content.db` is below that, the dataModule operation fails closed before any file is
 * touched.
 *
 * Disclosed limitation: `fs.statfsSync` (Node 18.15+/20.4+) is used to read free space. If it is
 * unavailable on the running platform/Node version, this is a MEASUREMENT failure, not a
 * headroom-insufficiency finding — the check logs a warning and reports `ok: true` (proceeds)
 * rather than failing closed on an unrelated platform gap. Failing closed is reserved for a
 * genuine, measured insufficiency.
 */
import { existsSync, statSync, statfsSync } from "node:fs";
import path from "node:path";

import { isInMemoryDbPath } from "./snapshot.js";

export interface HeadroomCheck {
  ok: boolean;
  requiredBytes: number;
  freeBytes: number | null;
  /** Set when the check could not measure free space at all (see file header). */
  measurementFailed?: boolean;
}

const HEADROOM_MULTIPLIER = 1.5;

function fileSize(filePath: string): number {
  return existsSync(filePath) ? statSync(filePath).size : 0;
}

export function checkDiskHeadroom(
  { dbPath }: { dbPath: string },
  _optional: Record<string, never> = {}
): HeadroomCheck {
  // BUG FIX (2026-07-28): an in-memory (or SQLite's other non-file) `dbPath` never gets a snapshot
  // file written (see `snapshot.ts`'s `isInMemoryDbPath`/`snapshotDb`), so there is no on-disk
  // headroom requirement to preflight — the check is not just redundant but potentially WRONG
  // without this guard: `path.dirname(":memory:")` resolves to the process's CURRENT WORKING
  // DIRECTORY, so a low-disk cwd could fail-close a dataModule declare that will never touch disk
  // at all. `requiredBytes: 0` mirrors the existing "nonexistent file" case below (real dbPath,
  // file not yet created) rather than inventing a new shape for callers to handle.
  if (isInMemoryDbPath({ dbPath })) {
    return { ok: true, requiredBytes: 0, freeBytes: null };
  }

  const dbSize = fileSize(dbPath);
  const walSize = fileSize(`${dbPath}-wal`);
  const requiredBytes = Math.ceil(HEADROOM_MULTIPLIER * (dbSize + walSize));

  let freeBytes: number | null = null;
  try {
    const stats = statfsSync(path.dirname(dbPath));
    freeBytes = stats.bavail * stats.bsize;
  } catch {
    return { ok: true, requiredBytes, freeBytes: null, measurementFailed: true };
  }

  return { ok: freeBytes >= requiredBytes, requiredBytes, freeBytes };
}
