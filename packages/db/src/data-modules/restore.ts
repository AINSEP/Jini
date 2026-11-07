/**
 * @file ADR-023 §4/§8 (T8 fix) — the restore half of the snapshot/restore pair.
 *
 * A plain file copy of the snapshot back over the live `content.db` (§4 — restore is a "different,
 * less-safe operation" than the WAL-safe online-backup snapshot). Before releasing whatever lock
 * guards this window, the caller must also clear the DDL attempt's own `-wal`/`-shm` sidecar
 * files (T8) so no stale WAL frames get replayed against the restored (older) snapshot on next
 * open.
 *
 * T2 scope note (exclusive cross-process lock): in this codebase's actual deployment topology
 * (single Node process, single long-lived `better-sqlite3` connection per site — ADR-046's own
 * "single-node remains target" line), restore only ever runs at BOOT-TIME recovery
 * (`migration-recovery.ts`), before the app's long-lived connection is constructed and before any
 * traffic is served. There is structurally no concurrent connection to quiesce at that point, so
 * ADR-023 §4's exclusive-lock requirement is satisfied by the boot sequencing itself, not by an
 * explicit `PRAGMA locking_mode=EXCLUSIVE` call here. If a future LIVE (mid-process) restore path
 * is ever added, it MUST acquire that lock first — this file does not, and must not be reused for
 * a live restore without adding it.
 *
 * SPEC-033 correction (2026-07-16): `data-module.ts`'s LIVE snapshot+DDL path used to acquire this
 * same lock too, on the theory that it should be "held through the DDL attempt" per the ADR's own
 * wording. Removed after a live multi-boot smoke test found it caused a real, deterministic
 * "database is locked" failure against a genuine second connection (the store plugin's own
 * dedicated `content.db` handle) — see `data-module.ts`'s file header for the full account. The
 * reasoning above (restore never runs live) already meant the lock's ADR-stated justification
 * ("Restore is a different, less-safe operation" — the snapshot/DDL steps are explicitly called
 * out as safe without it) never applied to the live path either; this file was always the correct
 * scope for where a live exclusive lock would matter, and the fix simply stopped taking it
 * somewhere it never needed to be taken.
 */
import { copyFileSync, existsSync, rmSync } from "node:fs";

export function restoreFromSnapshot(
  required: { dbPath: string; snapshotPath: string },
  _optional: Record<string, never> = {}
): void {
  const { dbPath, snapshotPath } = required;
  copyFileSync(snapshotPath, dbPath);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (existsSync(walPath)) rmSync(walPath);
  if (existsSync(shmPath)) rmSync(shmPath);
}
