/**
 * @file Read-only storage measurement for one folder tree. The host passes already-resolved absolute
 * paths it wants totals for ("targets"); one walk attributes every file to the closest target that
 * contains it, and everything else to `other`, so the parts always add up to the walked total.
 *
 * Rules:
 * - Symlinks are never followed (a link into another site or the whole disk would inflate the total
 *   and could loop). Each skipped link is listed.
 * - A path that cannot be read is reported as unknown: the affected tallies get `bytes: null` and the
 *   path in `unknownPaths`, while `knownBytes` keeps the lower bound. An unreadable folder is never 0.
 * - A missing path is a known zero, and a file that vanishes mid-walk is simply not counted.
 * - Sizes are apparent sizes (`lstat().size`), the number an owner compares against their file
 *   manager; hard links are counted once per name.
 * Nothing here writes, opens a database or deletes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export interface StorageTreeStats {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
  readonly size: number;
}

/** The two read calls the walk needs; inject a fake to test unreadable or racing paths. */
export interface StorageTreeFs {
  lstat(target: string): Promise<StorageTreeStats>;
  readdir(target: string): Promise<string[]>;
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

const nodeTreeFs: StorageTreeFs = { lstat: target => fs.lstat(target), readdir: target => fs.readdir(target) };

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
  { fs: treeFs = nodeTreeFs }: { fs?: StorageTreeFs } = {},
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

async function walk(
  { root, fs: treeFs, visit }: {
    root: string;
    fs: StorageTreeFs;
    visit: { ownerOf: (entry: string) => MutableTally; markUnknown: (entry: string) => void; total: MutableTally };
  },
  _optional: Record<string, never> = {},
): Promise<void> {
  const folders: string[] = [];
  const inspect = async (entry: string): Promise<void> => {
    const stats = await readStats({ fs: treeFs, entry });
    if (stats === 'missing') return;
    if (stats === 'unknown') return visit.markUnknown(entry);
    if (stats.isSymbolicLink()) {
      visit.total.skippedSymlinks.push(entry);
      visit.ownerOf(entry).skippedSymlinks.push(entry);
    } else if (stats.isDirectory()) {
      folders.push(entry);
    } else if (stats.isFile()) {
      for (const tally of [visit.total, visit.ownerOf(entry)]) { tally.knownBytes += stats.size; tally.files += 1; }
    }
  };
  await inspect(root);
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    const names = await treeFs.readdir(folder).catch((error: unknown) => (isMissing(error) ? [] : undefined));
    if (names === undefined) { visit.markUnknown(folder); continue; }
    for (const name of names) await inspect(path.join(folder, name));
  }
}

async function readStats(
  { fs: treeFs, entry }: { fs: StorageTreeFs; entry: string },
  _optional: Record<string, never> = {},
): Promise<StorageTreeStats | 'missing' | 'unknown'> {
  try {
    return await treeFs.lstat(entry);
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
