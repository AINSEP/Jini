/**
 * @module legacy-data-migration
 *
 * A one-shot, idempotent, host-configured migrator for moving a daemon's
 * data root from one location to another (e.g. a pre-packaging install that
 * ran out of a repo checkout, moved to a per-namespace directory under an
 * OS user-data location). The mechanism — refuse-if-missing-proof,
 * refuse-if-destination-populated, refuse-if-already-migrated, reject
 * symlinks, stage-then-atomically-promote, rollback-on-any-failure — is
 * product-neutral; the *shape* of a data root's payload (which files/dirs
 * constitute "real data", and which single entry proves a directory holds
 * real payload rather than an empty scaffold) is host-supplied via
 * {@link LegacyDataMigrationConfig}, never hardcoded here.
 *
 * Sync by design: intended to run at daemon startup before any database
 * connection opens, so it can't race a concurrent open of the destination.
 */
import * as nodeFilesystem from 'node:fs';

/** Node filesystem ABI, injected so migration can run against a host-owned adapter. */
export type LegacyFilesystemPort = Pick<typeof nodeFilesystem, 'statSync' | 'lstatSync' | 'existsSync' | 'readdirSync' | 'mkdirSync' | 'cpSync' | 'renameSync' | 'rmSync' | 'writeFileSync'>;
import * as path from 'node:path';

/** Which files/dirs constitute a data root's migratable payload, host-supplied. */
export interface LegacyDataMigrationConfig {
  /** Every file/dir under a data root that is part of the migratable payload. */
  payloadEntries: readonly string[];
  /**
   * The one entry (must be a member of `payloadEntries`) whose presence as a
   * *file* proves a directory holds real, populated data rather than an
   * empty scaffold a packaged installer pre-creates. For a sqlite-backed
   * daemon this is the database file.
   */
  proofEntry: string;
  /** Marker file name recording a completed migration. Defaults to `.migrated-from`. */
  markerFile?: string;
}

export interface MigrateLegacyDataDirOptions extends LegacyDataMigrationConfig {
  /** Path to the legacy data directory (typically from a host-defined env var). */
  legacyDir: string | undefined;
  /** Resolved current data root. */
  dataDir: string;
  /** Optional logger. Defaults to console.log. */
  logger?: {
    info(args: { message: string }): void;
  };
  filesystem?: LegacyFilesystemPort;
  /**
   * Test seam. The default writes the JSON marker with fs.writeFileSync;
   * tests inject a function that throws so the rollback path (which removes
   * already-promoted payload entries) can be exercised without contriving
   * real ENOSPC / read-only conditions. Production callers should never
   * pass this.
   * @internal
   */
  writeMarker?: (args: { dataDir: string; legacyDir: string; markerFile: string }) => void;
}

export type MigrateStatus = 'noop' | 'migrated' | 'skipped';

export interface MigrateLegacyDataDirResult {
  status: MigrateStatus;
  reason: string;
  copied?: readonly string[];
}

const DEFAULT_MARKER_FILE = '.migrated-from';

/**
 * Thrown when `legacyDir` is explicitly set but is not a usable legacy data
 * dir, or the new `dataDir` is already populated and would be merged into.
 * Failing loud here is the point: a silent skip trains an operator to
 * assume a migration ran when it didn't.
 */
export class LegacyMigrationError extends Error {
  readonly code: string;
  constructor({ code, message }: { readonly code: string; readonly message: string }) {
    super(message);
    this.code = code;
    this.name = 'LegacyMigrationError';
  }
}

function isExistingDir(p: string, fs: LegacyFilesystemPort): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isExistingFile(p: string, fs: LegacyFilesystemPort): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Returns true when `dataDir` looks like a fresh / never-used data root:
 * either the directory does not exist, or it exists but does not contain
 * the configured `proofEntry` as a file. Deliberately not just "the
 * directory is empty" — a packaged install commonly pre-creates an empty
 * `dataDir` before the daemon ever boots, so emptiness alone is not proof
 * of "no prior data."
 *
 * @param dataDir - The data root to check.
 * @param config - The host's payload/proof-entry configuration.
 */
export function dataDirIsEmptyOrFresh({ dataDir, config }: { readonly dataDir: string; readonly config: LegacyDataMigrationConfig }, { filesystem: fs = nodeFilesystem }: { filesystem?: LegacyFilesystemPort } = {}): boolean {
  if (!isExistingDir(dataDir, fs)) return true;
  return !isExistingFile(path.join(dataDir, config.proofEntry), fs);
}

/**
 * Returns true when `legacyDir` contains a payload worth migrating: it
 * exists and its configured `proofEntry` exists as a file.
 *
 * @param legacyDir - The candidate legacy data directory.
 * @param config - The host's payload/proof-entry configuration.
 */
export function legacyDirHasPayload({ legacyDir, config }: { readonly legacyDir: string; readonly config: LegacyDataMigrationConfig }, { filesystem: fs = nodeFilesystem }: { filesystem?: LegacyFilesystemPort } = {}): boolean {
  if (!isExistingDir(legacyDir, fs)) return false;
  return isExistingFile(path.join(legacyDir, config.proofEntry), fs);
}

/**
 * Returns the list of configured payload entries that already exist under
 * `dataDir`. Migration refuses to merge on top of any of them — a database
 * file/WAL pair or a project tree cannot be safely interleaved with a
 * foreign counterpart, and a partial overlay is worse than no migration.
 *
 * @param dataDir - The data root to check.
 * @param config - The host's payload/proof-entry configuration.
 */
export function dataDirHasExistingPayload({ dataDir, config }: { readonly dataDir: string; readonly config: LegacyDataMigrationConfig }, { filesystem: fs = nodeFilesystem }: { filesystem?: LegacyFilesystemPort } = {}): string[] {
  if (!isExistingDir(dataDir, fs)) return [];
  return config.payloadEntries.filter((entry) => fs.existsSync(path.join(dataDir, entry)));
}

/**
 * Walk a payload subtree and refuse to copy if any node is a symlink — a
 * preserved symlink would let a downstream reader escape the data root.
 * @internal
 */
function assertNoSymlinks(srcRoot: string, fs: LegacyFilesystemPort, displayPath = srcRoot): void {
  const stat = fs.lstatSync(srcRoot);
  if (stat.isSymbolicLink()) {
    throw new LegacyMigrationError({ code: 'symlink_in_payload', message: `legacy payload contains a symlink at "${displayPath}"; refusing to migrate` });
  }
  if (!stat.isDirectory()) return;
  for (const child of fs.readdirSync(srcRoot)) {
    assertNoSymlinks(path.join(srcRoot, child), fs, path.join(displayPath, child));
  }
}

/** Stage every present payload entry into `stagingDir`. Returns the entries actually copied. @internal */
function stagePayload(legacyDir: string, stagingDir: string, payloadEntries: readonly string[], fs: LegacyFilesystemPort): string[] {
  fs.mkdirSync(stagingDir, { recursive: true });
  const copied: string[] = [];
  for (const entry of payloadEntries) {
    const src = path.join(legacyDir, entry);
    if (!fs.existsSync(src)) continue;
    assertNoSymlinks(src, fs);
    const dst = path.join(stagingDir, entry);
    fs.cpSync(src, dst, { recursive: true, force: true, errorOnExist: false });
    copied.push(entry);
  }
  return copied;
}

/**
 * Move staged payload entries into the final `dataDir`. Each entry is moved
 * with `renameSync` (atomic on the same filesystem); a cross-device rename
 * falls back to copy + remove. Rollback-safe in two layers: the copy
 * fallback removes a partial destination on its own failure, and the outer
 * loop removes every entry it already promoted before rethrowing.
 *
 * @param stagingDir - The sibling staging directory holding the copied payload.
 * @param dataDir - The destination data root.
 * @param entries - The payload entries to promote.
 * @returns The entries that were placed into `dataDir` before any failure.
 */
export function promoteStaged({ stagingDir, dataDir, entries }: { readonly stagingDir: string; readonly dataDir: string; readonly entries: readonly string[] }, { filesystem: fs = nodeFilesystem }: { filesystem?: LegacyFilesystemPort } = {}): readonly string[] {
  fs.mkdirSync(dataDir, { recursive: true });
  const promoted: string[] = [];
  try {
    for (const entry of entries) {
      const src = path.join(stagingDir, entry);
      const dst = path.join(dataDir, entry);
      try {
        fs.renameSync(src, dst);
      } catch {
        try {
          fs.cpSync(src, dst, { recursive: true, force: true, errorOnExist: false });
          fs.rmSync(src, { recursive: true, force: true });
        } catch (cpErr) {
          fs.rmSync(dst, { recursive: true, force: true });
          throw cpErr;
        }
      }
      promoted.push(entry);
    }
  } catch (err) {
    rollbackPromoted(dataDir, promoted, fs);
    throw err;
  }
  return promoted;
}

function rollbackPromoted(dataDir: string, promoted: readonly string[], fs: LegacyFilesystemPort): void {
  for (const entry of promoted) {
    fs.rmSync(path.join(dataDir, entry), { recursive: true, force: true });
  }
}

function writeMarkerDefault({ dataDir, legacyDir, markerFile }: { dataDir: string; legacyDir: string; markerFile: string }, fs: LegacyFilesystemPort): void {
  const marker = path.join(dataDir, markerFile);
  const temp = `${marker}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify({ legacyDir: path.resolve(legacyDir), migratedAt: new Date().toISOString() }, null, 2);
  try {
    fs.writeFileSync(temp, `${payload}\n`, 'utf8');
    fs.renameSync(temp, marker);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

/**
 * One-shot, idempotent legacy data migrator. Synchronous so it can run at
 * module import time before a database connection opens. Throws
 * {@link LegacyMigrationError} on operator-actionable failures (env set but
 * path invalid; `dataDir` already populated; symlink in payload).
 *
 * @param options - Legacy/current dir paths plus the host's payload config.
 * @returns The migration outcome (`noop` when unconfigured, `skipped` when
 *   already migrated, `migrated` with the copied entry list otherwise).
 */
export function migrateLegacyDataDirSync(requiredArgs: Pick<MigrateLegacyDataDirOptions, "legacyDir" | "dataDir" | "payloadEntries" | "proofEntry">, optionalArgs: Pick<MigrateLegacyDataDirOptions, "logger" | "writeMarker" | "markerFile" | "filesystem"> = {}): MigrateLegacyDataDirResult {
  const options: MigrateLegacyDataDirOptions = { ...requiredArgs, ...optionalArgs };
  const fs = options.filesystem ?? nodeFilesystem;
  const log = options.logger ?? { info: ({ message }: { message: string }) => console.log(`[jini-migrate] ${message}`) };
  const markerFile = options.markerFile ?? DEFAULT_MARKER_FILE;

  const raw = options.legacyDir;
  if (raw === undefined || raw.length === 0) {
    return { status: 'noop', reason: 'legacy data dir not configured' };
  }
  const legacyDir = path.resolve(raw);
  const dataDir = path.resolve(options.dataDir);

  if (legacyDir === dataDir) {
    return { status: 'noop', reason: 'legacy data dir equals current data dir' };
  }

  // Marker check runs before legacyDirHasPayload on purpose: once a
  // migration has succeeded, the marker is the canonical "do not touch"
  // signal, even if the legacy source is later moved or deleted.
  const markerPath = path.join(dataDir, markerFile);
  if (fs.existsSync(markerPath)) {
    return { status: 'skipped', reason: 'migration marker already present' };
  }

  if (!legacyDirHasPayload({ legacyDir: legacyDir, config: options }, { filesystem: fs })) {
    throw new LegacyMigrationError({ code: 'legacy_dir_invalid', message: `legacy data dir "${legacyDir}" is not a usable legacy data dir (expected "${options.proofEntry}" directly inside it).` }
    );
  }

  const existing = dataDirHasExistingPayload({ dataDir: dataDir, config: options }, { filesystem: fs });
  if (existing.length > 0) {
    throw new LegacyMigrationError({ code: 'data_dir_not_empty', message: `data dir "${dataDir}" already contains payload entries (${existing.join(', ')}); refusing to merge legacy data on top. Move the existing data aside or pick a fresh data root before retrying.` }
    );
  }

  log.info({ message: `migrating legacy data from "${legacyDir}" to "${dataDir}"` });

  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const stagingDir = path.join(path.dirname(dataDir), `${path.basename(dataDir)}.migrate-${process.pid}-${Date.now()}`);

  let copied: string[];
  let promoted: readonly string[] = [];
  try {
    copied = stagePayload(legacyDir, stagingDir, options.payloadEntries, fs);
    promoted = promoteStaged({ stagingDir: stagingDir, dataDir: dataDir, entries: copied }, { filesystem: fs });
    if (options.writeMarker) options.writeMarker({ dataDir, legacyDir, markerFile });
    else writeMarkerDefault({ dataDir, legacyDir, markerFile }, fs);
  } catch (err) {
    rollbackPromoted(dataDir, promoted, fs);
    fs.rmSync(markerPath, { force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw err;
  }
  fs.rmSync(stagingDir, { recursive: true, force: true });

  log.info({ message: `migration complete: copied ${copied.length} entr${copied.length === 1 ? 'y' : 'ies'} (${copied.join(', ')})` });
  return { status: 'migrated', reason: 'copied legacy payload', copied };
}
