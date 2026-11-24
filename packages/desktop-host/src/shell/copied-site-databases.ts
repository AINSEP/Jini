/**
 * @file Snapshot, commit and rollback for a copied site's externally held databases. A Finder copy of
 * a site folder still points (by symlink) at the ORIGINAL's app-data databases; before the copy may
 * publish its own identity it gets snapshots of them under its new id and has those pointers detached.
 * The ordering is the reusable part: create the target folder exclusively, snapshot every database,
 * detach each symlinked pointer reversibly (rename, never delete), run the host's commit, and on ANY
 * failure put the pointers back and remove only the folder this call created. Backups are removed
 * once the commit has succeeded.
 *
 * The host keeps what is product layout: which databases exist, where they live, which pointer paths a
 * copy can carry, the backup naming, and what "commit" means (for a site, rewriting its marker file).
 * Filesystem and SQLite snapshot access arrive as ports, so the orchestration is verified without a disk.
 */

import path from "node:path";

/** The filesystem operations the orchestration needs. Each throws on failure. */
export interface CopiedDatabaseFilesystem {
  exists: (input: { path: string }) => boolean;
  /** Creates a folder; `recursive` creates missing parents and tolerates an existing one, otherwise an existing folder throws. */
  makeDirectory: (input: { path: string; recursive: boolean }) => void;
  removeTree: (input: { path: string }) => void;
  rename: (input: { from: string; to: string }) => void;
  unlink: (input: { path: string }) => void;
  /** `true` only for a symbolic link at `path`; a missing entry is `false`. */
  isSymbolicLink: (input: { path: string }) => boolean;
}

export interface CopiedDatabaseSource {
  /** The original's database file. */
  readonly from: string;
  /** Where the copy's own snapshot goes; every `to` shares one parent folder. */
  readonly to: string;
}

export interface CopiedDatabaseRequired {
  readonly sources: readonly CopiedDatabaseSource[];
  /** Candidate pointer paths in the copy; only those that are symbolic links are detached. */
  readonly pointerPaths: readonly string[];
  /** The rename target for the `index`th detached pointer; must be unique per index and not inside a pointer. */
  readonly backupPath: (input: { index: number }) => string;
  /** Publishes the copy's identity; a throw rolls everything back. */
  readonly commit: () => void;
  readonly filesystem: CopiedDatabaseFilesystem;
  /** Writes one consistent snapshot of `from` at `to`. */
  readonly snapshot: (input: { from: string; to: string }) => void;
}

interface DetachedPointer {
  readonly from: string;
  readonly backup: string;
}

function detachPointers({ pointerPaths, backupPath, filesystem, detached }: Pick<CopiedDatabaseRequired, "pointerPaths" | "backupPath" | "filesystem"> & { detached: DetachedPointer[] }): void {
  for (const from of pointerPaths) {
    if (!filesystem.isSymbolicLink({ path: from })) continue;
    const backup = backupPath({ index: detached.length });
    filesystem.rename({ from, to: backup });
    detached.push({ from, backup });
  }
}

/**
 * Runs `commit` with the copy's databases snapshotted and its pointers to the original detached; with
 * no sources it just commits. Rolls back (pointers restored newest first, created folder removed) when a
 * snapshot, detach or the commit throws, then rethrows that error.
 *
 * @throws "Copied database target already exists." before touching anything when the target folder exists.
 * @complexity O(s + p) filesystem calls for s sources and p pointer paths, plus the snapshot I/O.
 */
export function commitWithCopiedDatabases(
  { sources, pointerPaths, backupPath, commit, filesystem, snapshot }: CopiedDatabaseRequired,
  _optional = {},
): void {
  const [firstSource] = sources;
  if (firstSource === undefined) { commit(); return; }
  const targetDirectory = path.dirname(firstSource.to);
  if (filesystem.exists({ path: targetDirectory })) throw new Error("Copied database target already exists.");
  const detached: DetachedPointer[] = [];
  filesystem.makeDirectory({ path: path.dirname(targetDirectory), recursive: true });
  // Exclusive creation: rollback must never erase a folder somebody else made.
  filesystem.makeDirectory({ path: targetDirectory, recursive: false });
  try {
    for (const source of sources) snapshot({ from: source.from, to: source.to });
    detachPointers({ pointerPaths, backupPath, filesystem, detached });
    commit();
  } catch (error) {
    for (const pointer of detached.reverse()) filesystem.rename({ from: pointer.backup, to: pointer.from });
    filesystem.removeTree({ path: targetDirectory });
    throw error;
  }
  for (const pointer of detached) filesystem.unlink({ path: pointer.backup });
}
