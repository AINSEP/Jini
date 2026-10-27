/**
 * @file `readPluginPackageFiles()` — the read-only, bounded file listing behind the admin Plugins
 * screen's package-files viewer (`PLUGIN_FILES`, `routes/plugins/files.ts`, 2026-09-13).
 *
 * Purpose:
 * Walks ONE plugin's own directory and returns each regular file's UTF-8 text. Mechanism only:
 * which directory belongs to which plugin is the composition root's decision
 * (`server/runtime/composition/plugin-runtime.ts`'s `readPluginPackageFiles` binding), and who may
 * call it is the route's.
 *
 * Safety — each guard is independent, not presumed covered by another:
 *  - `rootDir` itself must be a plain directory (not a symlink), and its realpath must be
 *    `containerDir`'s realpath or a descendant of it. Otherwise `PluginPackagePathError`.
 *  - The walk reads `readdir` `Dirent` types, which never follow symlinks: a symlink entry is
 *    listed with `omitted: "symlink"` and is neither descended into nor read.
 *  - Every file is opened with `O_NOFOLLOW`, so a file swapped for a symlink between listing and
 *    open fails (`ELOOP`) and is reported as `"symlink"` instead of reading the link's target.
 *  - Caps on files listed, entries visited, bytes per file, and bytes in total. A count or total cap
 *    stops the walk and sets `truncated`; one oversized file is listed as `"too-large"`.
 *  - A file containing a NUL byte or invalid UTF-8 is listed as `"binary"`, with no content.
 *
 * Residual risk (disclosed, not closed): `O_NOFOLLOW` guards only a path's final component, so a
 * directory swapped for a symlink mid-walk could still be descended. Doing that needs write access
 * to the plugin install directory, which for a tier-3 plugin already means code execution on
 * enable — this viewer is defense in depth, not the boundary.
 */
import { constants, type Dirent } from "node:fs";
import { lstat, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { readAtMost, readNoFollowFlags } from "./open-flags.js";
import { isPluginRelativePath } from "../browser-providers.js";
import type { PluginDiscoveryRecord } from "../discovery-types.js";
import { PLUGIN_MANIFEST_FILENAMES } from "../plugin-format.js";
import { sitePluginRoot } from "./discovery.js";

/** Every packaged file is opened read-only and without following a final-component symlink. */
const READ_NO_FOLLOW = readNoFollowFlags({ constants });

export interface PluginPackageFileLimits {
  readonly maxFiles: number;
  /** Files, symlinks, and directories visited — bounds `readdir` calls on a wide, deep tree. */
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

/** Sized for a plugin package (a manifest, an entry file, a handful of skills or assets), not a
 *  vendored dependency tree. Sent to the client with every listing so its notices never hardcode them. */
export const PLUGIN_PACKAGE_FILE_LIMITS: PluginPackageFileLimits = {
  maxFiles: 200,
  maxEntries: 2000,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
};

export type PluginPackageFileOmission = "binary" | "too-large" | "symlink" | "unreadable";

export interface PluginPackageFile {
  /** `/`-separated, relative to the plugin's own directory. */
  readonly relativePath: string;
  /** Bytes on disk; `0` for a symlink or a file that could not be opened. */
  readonly sizeBytes: number;
  /** The file's UTF-8 text — `null` exactly when `omitted` is set. */
  readonly content: string | null;
  readonly omitted: PluginPackageFileOmission | null;
}

export interface PluginPackageFiles {
  readonly files: readonly PluginPackageFile[];
  /** A file-count, entry, or total-byte cap stopped the walk before every file was listed. */
  readonly truncated: boolean;
}

/** `rootDir` is a symlink, not a directory, or resolves outside `containerDir`. The message names
 *  server paths — a route must not echo it to a client. */
export class PluginPackagePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginPackagePathError";
  }
}

export interface ReadPluginPackageFilesRequired {
  readonly input: {
    /** The plugin's own directory. Missing on disk ⇒ an empty listing, not an error. */
    readonly rootDir: string;
    /** The directory `rootDir` must resolve inside (the install dir, or a built-in's own folder). */
    readonly containerDir: string;
  };
}

export interface ReadPluginPackageFilesOptional {
  readonly limits?: PluginPackageFileLimits;
}

/** Mutable only inside one `readPluginPackageFiles` call; never escapes it. */
interface WalkState {
  readonly limits: PluginPackageFileLimits;
  readonly files: PluginPackageFile[];
  entries: number;
  totalBytes: number;
  truncated: boolean;
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function omittedFile(relativePath: string, sizeBytes: number, omitted: PluginPackageFileOmission): PluginPackageFile {
  return { relativePath, sizeBytes, content: null, omitted };
}

/** Code-unit order, so the listing is identical whatever the server's locale. */
function byName(a: Dirent, b: Dirent): number {
  // One directory never lists a name twice, so equal names need no case.
  return a.name < b.name ? -1 : 1;
}

/**
 * @returns `rootDir`'s realpath, or `null` when it does not exist.
 * @throws {PluginPackagePathError} `rootDir` is a symlink or not a directory, or resolves outside `containerDir`.
 */
async function resolvePackageRoot(rootDir: string, containerDir: string): Promise<string | null> {
  let stats;
  try {
    stats = await lstat(rootDir);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new PluginPackagePathError(`'${rootDir}' is not a plain directory`);
  }
  const [rootReal, containerReal] = await Promise.all([realpath(rootDir), realpath(containerDir)]);
  if (rootReal !== containerReal && !rootReal.startsWith(containerReal + path.sep)) {
    throw new PluginPackagePathError(`'${rootDir}' resolves outside '${containerDir}'`);
  }
  return rootReal;
}

/** Counts one entry against the caps. `false` (and `truncated` set) once a cap is already full.
 *  Never called once truncated: the level loop and the breadth-first walk both stop first. */
function admitEntry(state: WalkState): boolean {
  if (state.files.length >= state.limits.maxFiles || state.entries >= state.limits.maxEntries) {
    state.truncated = true;
    return false;
  }
  state.entries += 1;
  return true;
}

async function openNoFollow(absolutePath: string): Promise<FileHandle | PluginPackageFileOmission> {
  try {
    return await open(absolutePath, READ_NO_FOLLOW);
  } catch (error) {
    const code = errnoCode(error);
    return code === "ELOOP" || code === "EMLINK" ? "symlink" : "unreadable";
  }
}

function toTextOrBinary(relativePath: string, bytes: Buffer): PluginPackageFile {
  if (bytes.includes(0)) return omittedFile(relativePath, bytes.length, "binary");
  try {
    return { relativePath, sizeBytes: bytes.length, content: STRICT_UTF8.decode(bytes), omitted: null };
  } catch {
    return omittedFile(relativePath, bytes.length, "binary");
  }
}

/**
 * Records one regular file. Reads at most `maxFileBytes + 1` bytes, so a file that grew
 * past the cap after `stat` is still caught as too large rather than read whole.
 */
async function readFileEntry(
  { absolutePath, relativePath, state }: { absolutePath: string; relativePath: string; state: WalkState },
  _optional: Record<string, never> = {},
): Promise<void> {
  const opened = await openNoFollow(absolutePath);
  if (typeof opened === "string") {
    state.files.push(omittedFile(relativePath, 0, opened));
    return;
  }
  try {
    const stats = await opened.stat();
    if (!stats.isFile()) return;
    const { maxFileBytes, maxTotalBytes } = state.limits;
    if (stats.size > maxFileBytes) {
      state.files.push(omittedFile(relativePath, stats.size, "too-large"));
      return;
    }
    if (state.totalBytes + stats.size > maxTotalBytes) {
      state.truncated = true;
      return;
    }
    const bytes = await readAtMost(opened, maxFileBytes + 1);
    if (bytes.length > maxFileBytes) {
      state.files.push(omittedFile(relativePath, bytes.length, "too-large"));
      return;
    }
    if (state.totalBytes + bytes.length > maxTotalBytes) {
      state.truncated = true;
      return;
    }
    state.totalBytes += bytes.length;
    state.files.push(toTextOrBinary(relativePath, bytes));
  } finally {
    await opened.close();
  }
}

/** Lists one directory level: symlinks and files are recorded now in name order; subdirectories are
 *  returned for the next level. An unreadable subdirectory lists as empty rather than failing the
 *  whole package. */
async function readDirectoryLevel(rootReal: string, relativeDir: string, state: WalkState): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(path.join(rootReal, relativeDir), { withFileTypes: true });
  } catch {
    return [];
  }
  const subdirectories: string[] = [];
  for (const entry of entries.sort(byName)) {
    if (!admitEntry(state)) break;
    const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (await visitEntry(rootReal, relativePath, entry, state)) subdirectories.push(relativePath);
    if (state.truncated) break;
  }
  return subdirectories;
}

/** Records a symlink or file now; `true` when the entry is a subdirectory for the next level. */
async function visitEntry(rootReal: string, relativePath: string, entry: Dirent, state: WalkState): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) state.files.push(omittedFile(relativePath, 0, "symlink"));
  else if (entry.isFile()) await readFileEntry({ absolutePath: path.join(rootReal, relativePath), relativePath, state });
  return false;
}

/**
 * Lists a plugin package's files, breadth-first — so a package's top-level manifest is always listed
 * before a deep subtree can use up the caps.
 *
 * @throws {PluginPackagePathError} `input.rootDir` is a symlink or not a directory, or resolves
 *   outside `input.containerDir`.
 * @complexity O(min(entries, maxEntries)) directory entries plus O(maxTotalBytes) bytes read; memory
 *   is bounded by the same two caps.
 */
export async function readPluginPackageFiles(
  required: ReadPluginPackageFilesRequired,
  optional: ReadPluginPackageFilesOptional = {}
): Promise<PluginPackageFiles> {
  const { rootDir, containerDir } = required.input;
  const rootReal = await resolvePackageRoot(rootDir, containerDir);
  if (rootReal === null) return { files: [], truncated: false };

  const state: WalkState = {
    limits: optional.limits ?? PLUGIN_PACKAGE_FILE_LIMITS,
    files: [],
    entries: 0,
    totalBytes: 0,
    truncated: false,
  };
  const pending: string[] = [""];
  while (pending.length > 0 && !state.truncated) {
    pending.push(...(await readDirectoryLevel(rootReal, pending.shift()!, state)));
  }
  return { files: state.files, truncated: state.truncated };
}

/** One file of a site plugin package: `/`-separated and package-relative, with the sha256 hex its
 *  manifest's `integrity` declares (`null` for the manifest itself, which integrity never lists). */
export interface SitePluginPackageFile {
  readonly relativePath: string;
  readonly sha256: string | null;
}

export interface SitePluginPackage {
  /** The version folder's realpath, inside `installDir`. */
  readonly rootDir: string;
  readonly files: readonly SitePluginPackageFile[];
}

/** The manifest discovery reads (current name first, then the legacy alias), or `undefined`. */
async function presentManifestName(rootReal: string): Promise<string | undefined> {
  for (const name of PLUGIN_MANIFEST_FILENAMES) { // legacy alias
    if (await lstat(path.join(rootReal, name)).then(() => true, (error: unknown) => errnoCode(error) === "ENOENT" ? false : Promise.reject(error))) return name;
  }
  return undefined;
}

/**
 * Exactly the files that make up one installed site plugin, by Jini's own contract: the manifest
 * discovery read plus every key of its `integrity` (the installer writes exactly those, and the
 * loader verifies their hashes). Anything else in the version folder — `data/`, `memory/private/`, a
 * stray file — is not package. Lists paths only; the caller reads and checks each hash. A host
 * copying a plugin (a backup) asks here instead of guessing the layout from folder names.
 *
 * @throws {PluginPackagePathError} the record is not a valid site plugin with a validated manifest,
 *   an integrity key leaves the package, or the version folder is missing, linked, outside
 *   `installDir`, or has no manifest.
 * @complexity O(integrity entries) plus two `realpath`s and up to two `lstat`s.
 */
export async function listSitePluginPackage(
  required: { installDir: string; record: PluginDiscoveryRecord },
  _optional: Record<string, never> = {},
): Promise<SitePluginPackage> {
  const { installDir, record } = required;
  const { manifest } = record;
  if (record.source !== "site" || record.status !== "valid" || manifest === undefined) {
    throw new PluginPackagePathError(`'${record.id}' is not a valid installed site plugin`);
  }
  const integrity = Object.entries(manifest.integrity).filter(([key]) => !PLUGIN_MANIFEST_FILENAMES.includes(key));
  if (integrity.some(([key]) => !isPluginRelativePath({ path: key }))) throw new PluginPackagePathError(`'${record.id}' lists a file outside its package`);
  const rootDir = await resolvePackageRoot(sitePluginRoot({ installDir, id: record.id, version: record.version }), installDir);
  const manifestName = rootDir === null ? undefined : await presentManifestName(rootDir);
  if (rootDir === null || manifestName === undefined) throw new PluginPackagePathError(`'${record.id}' ${record.version} is not installed`);
  return {
    rootDir,
    files: [{ relativePath: manifestName, sha256: null }, ...integrity.map(([relativePath, hash]) => ({ relativePath, sha256: hash.slice("sha256-".length) }))],
  };
}
