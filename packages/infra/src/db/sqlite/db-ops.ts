/**
 * @file The SQLite implementation of `DbOpsPort`.
 *
 * SQLite-backed hosts always have a cheap restore mechanism available: a whole-file online
 * backup via `better-sqlite3`'s native backup API, which produces a consistent copy even while
 * the source connection has an open WAL. That is why this driver reports `costClass: 'cheap'`
 * unconditionally, and why a networked driver implementing the same port would not.
 *
 * The watermark is injected (`readWatermark`) rather than read from a table this package would
 * have to know the name of — see `WatermarkReader` in `db/core/ports.ts`.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { restorePointFilename } from '../core/artifact-naming.js';
import type { DbOpsPort, RestoreCapability, RestorePoint, WatermarkReader } from '../core/ports.js';
import type { SqliteBackupSource } from './types.js';

/** Sentinel `filePath` for an ephemeral connection with no file behind it. */
const IN_MEMORY = ':memory:';

export interface SqliteDbOpsAdapterDeps {
  /**
   * The raw driver handle, not an ORM wrapper. This adapter needs `backup` and nothing else, so a
   * caller passes the connection directly — a host using Drizzle passes `handle.$client`. Taking
   * the raw source rather than an object with a `$client` property keeps an ORM's naming
   * convention off this package's surface entirely.
   */
  readonly connection: SqliteBackupSource;
  readonly filePath: string;
  readonly readWatermark: WatermarkReader;
  /** Injectable clock, so artifact names are deterministic under test. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export class SqliteDbOpsAdapter implements DbOpsPort {
  private readonly connection: SqliteBackupSource;
  private readonly filePath: string;
  private readonly readWatermark: WatermarkReader;
  private readonly now: () => number;

  constructor(deps: SqliteDbOpsAdapterDeps) {
    this.connection = deps.connection;
    this.filePath = deps.filePath;
    this.readWatermark = deps.readWatermark;
    this.now = deps.now ?? Date.now;
  }

  /** Pure and side-effect-free — SQLite reports the same static capability every time. */
  async getCapabilities(): Promise<{ restorePoint: RestoreCapability }> {
    return { restorePoint: { costClass: 'cheap', kind: 'file-snapshot' } };
  }

  /**
   * Captures a whole-file online-backup copy, stamped with the watermark value at capture time.
   * Never a partial or logical export — the artifact is byte-restorable by definition.
   *
   * An in-memory connection has no directory of its own, so its artifacts land in the OS temp
   * directory rather than failing: the backup itself is still a real, consistent file.
   */
  async captureRestorePoint(required: { scopeId: string }): Promise<RestorePoint> {
    const watermarkAtCapture = this.readWatermark();
    const targetDir = this.filePath === IN_MEMORY ? os.tmpdir() : path.dirname(this.filePath);
    const artifactRef = path.join(
      targetDir,
      restorePointFilename({ scopeId: required.scopeId, watermarkAtCapture, timestamp: this.now() }),
    );

    await this.connection.backup(artifactRef);

    return { artifactRef, watermarkAtCapture };
  }

  /**
   * Physically swaps the live database file for a previously-captured artifact.
   *
   * Crash-safety: the artifact is copied to a same-directory temp file first, then moved with a
   * single `fs.rename()` — atomic on the same filesystem under POSIX rename semantics. If the
   * process dies before the rename, the live file is untouched; the rename itself either fully
   * completes or does not happen, never a partial file.
   *
   * `restartRequired` is always `true` here, and that is causal rather than incidental: the
   * running process keeps its own file descriptor pointed at the now-unlinked old inode and
   * goes on serving from it, unaware anything changed, until it reopens `filePath` fresh.
   *
   * Stale `-wal`/`-shm` sidecar cleanup is best-effort. SQLite's WAL header carries a salt tied
   * to the specific main-file version it was written against, so an un-cleaned sidecar cannot
   * silently corrupt the swapped-in file on next boot — SQLite detects the mismatch and discards
   * it. This cleanup removes ambiguity; skipping it would not be unsafe.
   */
  async restoreFromArtifact(required: { artifactRef: string }): Promise<{ restartRequired: boolean }> {
    if (this.filePath === IN_MEMORY) {
      // No file to restore into, and no descriptor to invalidate — so no restart either.
      return { restartRequired: false };
    }

    await fs.access(required.artifactRef);

    const dir = path.dirname(this.filePath);
    const tmpPath = path.join(
      dir,
      `.${path.basename(this.filePath)}.restoring-${randomBytes(6).toString('hex')}`,
    );
    await fs.copyFile(required.artifactRef, tmpPath);
    await fs.rename(tmpPath, this.filePath);

    await Promise.allSettled([
      fs.rm(`${this.filePath}-wal`, { force: true }),
      fs.rm(`${this.filePath}-shm`, { force: true }),
    ]);

    return { restartRequired: true };
  }
}
