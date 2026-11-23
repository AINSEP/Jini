/**
 * @file Read-only storage measurement for one folder tree. The host passes already-resolved absolute
 * paths it wants totals for ("targets"); one walk attributes every file to the closest target that
 * contains it, and everything else to `other`, so the parts always add up to the walked total.
 *
 * Rules:
 * - Symlinks are never followed (a link into another site or the whole disk would inflate the total
 *   and could loop). Each skipped link is listed. A folder is enumerated through an anchored,
 *   no-follow directory handle whose identity must match the inspected folder; when that identity
 *   cannot be maintained (the folder was swapped for a link or another folder mid-walk), the folder
 *   is reported unknown and nothing it listed is counted.
 * - A path that cannot be read is reported as unknown: the affected tallies get `bytes: null` and the
 *   path in `unknownPaths`, while `knownBytes` keeps the lower bound. An unreadable folder is never 0.
 * - A missing path is a known zero, and a file that vanishes mid-walk is simply not counted.
 * - Sizes are apparent sizes (`lstat().size`), the number an owner compares against their file
 *   manager; hard links are counted once per name.
 * Nothing here writes, opens a database or deletes.
 */
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/** A filesystem object's identity; two names for one folder share it, a replacement does not. */
export interface StorageTreeIdentity { readonly dev: number | bigint; readonly ino: number | bigint }

export interface StorageTreeStats extends StorageTreeIdentity {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
  readonly size: number;
}

/** One opened folder. Listing and child metadata are read relative to the opened folder, never by
 * re-resolving its pathname, so a later swap of that pathname cannot redirect the reads. */
export interface StorageTreeDirectory {
  /** Identity of the folder actually opened (never the target of a link). */
  readonly identity: StorageTreeIdentity;
  list(): Promise<string[]>;
  /** Metadata of one child, without following it if it is a link. */
  lstatChild(name: string): Promise<StorageTreeStats>;
  /** False once the folder's pathname no longer names the opened folder. */
  stillOpenedDirectory(): Promise<boolean>;
  close(): Promise<void>;
}

/** The read port the walk needs; inject a fake to test unreadable or racing paths. `lstat` is used for
 * the root only; `openDirectory` must refuse (not follow) a link at `target`. */
export interface StorageTreeFs {
  lstat(target: string): Promise<StorageTreeStats>;
  openDirectory(target: string): Promise<StorageTreeDirectory>;
}

export interface StorageTarget { readonly id: string; readonly path: string }

export interface StorageTally {
  /** Exact bytes, or `null` when part of this tally could not be read. */
  readonly bytes: number | null;
  /** Bytes actually read: the lower bound when `bytes` is `null`. */
  readonly knownBytes: number;
  readonly files: number;
  readonly unknownPaths: readonly string[];
  readonly skippedSymlinks: readonly string[];
}

export interface StorageTreeMeasurement {
  readonly root: string;
  readonly total: StorageTally;
  readonly targets: Readonly<Record<string, StorageTally>>;
  readonly other: StorageTally;
}

// Windows has neither flag; there the identity checks below are what catch a swapped folder.
const OPEN_DIRECTORY_NO_FOLLOW = fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0);

/** The Node adapter: opens each folder without following a link and, on Linux, reads it through the
 * process's own descriptor link (`/proc/self/fd/N`), which stays bound to the opened folder. Elsewhere it
 * reads by pathname and `stillOpenedDirectory()` re-checks the pathname's identity afterwards.
 * @example await measureStorageTree({ root, targets }, { fs: nodeStorageTreeFs }); */
export const nodeStorageTreeFs: StorageTreeFs = {
  lstat: target => fs.lstat(target),
  openDirectory: target => openNodeDirectory({ target }),
};

async function openNodeDirectory(
  { target }: { target: string },
  _optional: Record<string, never> = {},
): Promise<StorageTreeDirectory> {
  const handle = await fs.open(target, OPEN_DIRECTORY_NO_FOLLOW);
  try {
    const identity = await handle.stat();
    if (!identity.isDirectory()) throw Object.assign(new Error('The opened path is not a folder.'), { code: 'ENOTDIR' });
    const base = await descriptorPath({ fd: handle.fd, identity }) ?? target;
    return {
      identity,
      list: () => fs.readdir(base),
      lstatChild: name => fs.lstat(path.join(base, name)),
      stillOpenedDirectory: async () => sameIdentity(await fs.lstat(target).catch(() => undefined), identity),
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** `/proc/self/fd/N` when it resolves to the opened folder, otherwise `undefined` (no procfs). */
async function descriptorPath(
  { fd, identity }: { fd: number; identity: StorageTreeIdentity },
  _optional: Record<string, never> = {},
): Promise<string | undefined> {
  const anchored = `/proc/self/fd/${fd}`;
  const resolved = await fs.stat(anchored).catch(() => undefined);
  return sameIdentity(resolved, identity) ? anchored : undefined;
}

function sameIdentity(
  a: StorageTreeIdentity | undefined,
  b: StorageTreeIdentity,
  _optional: Record<string, never> = {},
): boolean {
  return a !== undefined && a.dev === b.dev && a.ino === b.ino;
}

interface MutableTally { knownBytes: number; files: number; unknownPaths: string[]; skippedSymlinks: string[] }

/**
 * Measures `root` once, attributing bytes to `targets`.
 * @throws TypeError for a relative root or target, a repeated id or two targets naming one path.
 * @throws RangeError for a target outside `root`.
 * @complexity O(n · t) time for n entries and t targets, O(depth + t) extra space; one `lstat` per
 *   entry and one `readdir` per folder, sequential to keep disk pressure low on a serving host.
 * @example await measureStorageTree({ root: siteDir, targets: [{ id: 'uploads', path: uploadsDir }] });
 */
export async function measureStorageTree(
  { root, targets }: { root: string; targets: readonly StorageTarget[] },
  { fs: treeFs = nodeStorageTreeFs }: { fs?: StorageTreeFs } = {},
): Promise<StorageTreeMeasurement> {
  const checked = validateTargets({ root, targets });
  const tallies = new Map(checked.map(target => [target.id, emptyTally()]));
  const other = emptyTally();
  const total = emptyTally();
  const ownerOf = (entry: string): MutableTally => {
    // Targets are sorted longest path first, so the first container is the closest one.
    const owner = checked.find(target => contains({ parent: target.path, child: entry }));
    return owner ? tallies.get(owner.id)! : other;
  };
  const markUnknown = (entry: string): void => {
    total.unknownPaths.push(entry);
    ownerOf(entry).unknownPaths.push(entry);
    // Anything nested inside an unreadable folder is unknown as well, not empty.
    for (const target of checked) {
      if (target.path !== entry && contains({ parent: entry, child: target.path })) tallies.get(target.id)!.unknownPaths.push(entry);
    }
  };
  await walk({ root, fs: treeFs, visit: { ownerOf, markUnknown, total } });
  return {
    root,
    total: freeze(total),
    targets: Object.fromEntries([...tallies].map(([id, tally]) => [id, freeze(tally)])),
    other: freeze(other),
  };
}

type Visit = { ownerOf: (entry: string) => MutableTally; markUnknown: (entry: string) => void; total: MutableTally };
type Inspected = StorageTreeStats | 'missing' | 'unknown';
interface Folder { readonly entry: string; readonly identity: StorageTreeIdentity }

async function walk(
  { root, fs: treeFs, visit }: { root: string; fs: StorageTreeFs; visit: Visit },
  _optional: Record<string, never> = {},
): Promise<void> {
  const folders: Folder[] = [];
  const record = (entry: string, stats: Inspected): void => {
    if (stats === 'missing') return;
    if (stats === 'unknown') return visit.markUnknown(entry);
    if (stats.isSymbolicLink()) {
      visit.total.skippedSymlinks.push(entry);
      visit.ownerOf(entry).skippedSymlinks.push(entry);
    } else if (stats.isDirectory()) {
      folders.push({ entry, identity: stats });
    } else if (stats.isFile()) {
      for (const tally of [visit.total, visit.ownerOf(entry)]) { tally.knownBytes += stats.size; tally.files += 1; }
    }
  };
  record(root, await readStats({ read: () => treeFs.lstat(root) }));
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    const children = await readFolder({ fs: treeFs, folder });
    if (children === 'unknown') { visit.markUnknown(folder.entry); continue; }
    for (const [entry, stats] of children) record(entry, stats);
  }
}

/** Lists one folder through its anchored handle. Children are only returned once the handle is proven
 * to be the inspected folder both before and after the reads; otherwise the whole folder is unknown. */
async function readFolder(
  { fs: treeFs, folder }: { fs: StorageTreeFs; folder: Folder },
  _optional: Record<string, never> = {},
): Promise<Array<[string, Inspected]> | 'unknown'> {
  let directory: StorageTreeDirectory;
  try {
    directory = await treeFs.openDirectory(folder.entry);
  } catch (error) {
    return isMissing(error) ? [] : 'unknown';
  }
  try {
    if (!sameIdentity(directory.identity, folder.identity)) return 'unknown';
    const children: Array<[string, Inspected]> = [];
    for (const name of await directory.list()) {
      children.push([path.join(folder.entry, name), await readStats({ read: () => directory.lstatChild(name) })]);
    }
    return (await directory.stillOpenedDirectory()) ? children : 'unknown';
  } catch (error) {
    return isMissing(error) ? [] : 'unknown';
  } finally {
    await directory.close().catch(() => undefined);
  }
}

async function readStats(
  { read }: { read: () => Promise<StorageTreeStats> },
  _optional: Record<string, never> = {},
): Promise<Inspected> {
  try {
    return await read();
  } catch (error) {
    return isMissing(error) ? 'missing' : 'unknown';
  }
}

function validateTargets(
  { root, targets }: { root: string; targets: readonly StorageTarget[] },
  _optional: Record<string, never> = {},
): StorageTarget[] {
  if (!path.isAbsolute(root)) throw new TypeError(`The folder to measure must be an absolute path: ${root}`);
  const byPath = new Map<string, string>();
  const ids = new Set<string>();
  const checked = targets.map(({ id, path: target }) => {
    if (!path.isAbsolute(target)) throw new TypeError(`Storage target "${id}" must be an absolute path: ${target}`);
    if (ids.has(id)) throw new TypeError(`Storage target "${id}" is listed twice.`);
    const resolved = path.resolve(target);
    const clash = byPath.get(resolved);
    if (clash !== undefined) throw new TypeError(`Storage targets "${clash}" and "${id}" name the same path: ${resolved}`);
    if (!contains({ parent: path.resolve(root), child: resolved })) {
      throw new RangeError(`Storage target "${id}" is outside the folder being measured: ${resolved}`);
    }
    ids.add(id);
    byPath.set(resolved, id);
    return { id, path: resolved };
  });
  return checked.sort((a, b) => b.path.length - a.path.length);
}

/** Segment-aware containment: `content.db-wal` is not inside `content.db`. */
function contains({ parent, child }: { parent: string; child: string }, _optional: Record<string, never> = {}): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isMissing(error: unknown, _optional: Record<string, never> = {}): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

function emptyTally(_optional: Record<string, never> = {}): MutableTally {
  return { knownBytes: 0, files: 0, unknownPaths: [], skippedSymlinks: [] };
}

function freeze(tally: MutableTally, _optional: Record<string, never> = {}): StorageTally {
  return {
    bytes: tally.unknownPaths.length > 0 ? null : tally.knownBytes,
    knownBytes: tally.knownBytes,
    files: tally.files,
    unknownPaths: [...tally.unknownPaths],
    skippedSymlinks: [...tally.skippedSymlinks],
  };
}
