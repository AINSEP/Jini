import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";

/**
 * @file Batched writes into the owner-picked folder (owner 2026-10-27) — the agent's only write path
 * there; `fs_write_files` puts each batch on one approval card. `agent-tools.ts`'s "why read-only"
 * rationale still holds for every other root: the human reviewing the exact batch is the validator.
 * {@link prepareFileWrites} validates before the card; {@link writePreparedFiles} re-checks and writes
 * the frozen batch the card showed.
 */

/** Batch bounds: enough for a small site's pages and assets, small enough for one card and memory. */
export const FS_WRITE_LIMITS = { maxFiles: 50, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 } as const;

/** A refused folder or batch; nothing was written. The message says which file and why. */
export class FsWriteInputError extends Error {
  constructor({ message }: { message: string }, _optional = {}) {
    super(message);
    this.name = "FsWriteInputError";
  }
}

export interface PreparedFileWrite { readonly path: string; readonly bytes: Buffer; readonly overwrite: boolean }

/**
 * The host's guarded path resolver (its read tools' denylist and containment): returns the absolute
 * target or throws with a reason. Injected so the write path refuses exactly what the read path does.
 */
export type ResolveFsFilePath = (args: { rootPath: string; relativePath: string }) => string;

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const refuse = ({ message }: { message: string }, _optional = {}): never => { throw new FsWriteInputError({ message }); };
const isSameOrInside = ({ path, dir }: { path: string; dir: string }, _optional = {}) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/**
 * The same rule Jini's `validateReadOnlyExtraDirs` enforces at launch (host tests ran against the
 * installed Jini dist, so it could not be imported there): absolute, not a symlink, a directory, not `/`,
 * home or an ancestor of home, not the site, inside it or an ancestor of it.
 * @returns The folder's real path. @throws {FsWriteInputError} @complexity O(1) filesystem calls.
 */
export function requirePickedFolder({ dir, siteDir }: { dir: string; siteDir: string }, { homeDir = homedir() }: { homeDir?: string } = {}): string {
  if (!isAbsolute(dir) || lstatOrUndefined({ path: dir })?.isSymbolicLink() !== false || !statSync(dir).isDirectory()) {
    refuse({ message: "The picked folder must be an existing folder, not a symbolic link — pick it again from the chat composer" });
  }
  const [real, site, home] = [dir, siteDir, homeDir].map((path) => realpathSync(path)) as [string, string, string];
  if (isSameOrInside({ path: home, dir: real }) || isSameOrInside({ path: site, dir: real }) || isSameOrInside({ path: real, dir: site })) {
    refuse({ message: "The picked folder must not contain your home folder or this site, nor lie inside the site" });
  }
  return real;
}

function lstatOrUndefined({ path }: { path: string }, _optional = {}): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** One spelling per path on every OS: no `.`/`..`/empty segment, backslash, NUL, drive or root. O(p). */
const isPlainRelativePath = ({ path, segments }: { path: string; segments: readonly string[] }, _optional = {}) =>
  !/[\\\0]|^[A-Za-z]:/.test(path) && !isAbsolute(path) && !segments.some((s) => s === "" || s === "." || s === "..");

/**
 * One path against the folder: plain relative shape, the read tools' denylist and containment
 * (`resolveFsFilePath`), no symlink at any step (even one pointing inside), and an existing target
 * must be a regular file. Missing parents are fine; the write creates them.
 * @returns Absolute target and whether it exists. @throws {FsWriteInputError} @complexity O(depth) lstats.
 */
export function inspectWriteTarget({ folder, path, resolveFsFilePath }: { folder: string; path: string; resolveFsFilePath: ResolveFsFilePath }, _optional = {}): { target: string; overwrite: boolean } {
  const segments = path.split("/");
  if (!isPlainRelativePath({ path, segments })) refuse({ message: `${JSON.stringify(path)}: use a plain relative path inside the folder (no '..', '.', '\\', drive or leading '/')` });
  let target = "";
  try { target = resolveFsFilePath({ rootPath: folder, relativePath: path }); } catch (error) { refuse({ message: `${path}: ${(error as Error).message}` }); }
  let current = folder;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const stat = lstatOrUndefined({ path: current });
    if (stat === undefined) return { target, overwrite: false };
    const isLeaf = index === segments.length - 1;
    // lstat: a symlink is neither a file nor a directory, so this refuses every link.
    if (isLeaf ? !stat.isFile() : !stat.isDirectory()) refuse({ message: `${path}: '${segment}' cannot be written through` });
  }
  return { target, overwrite: true };
}

/** Decodes one entry; base64 must be canonical so the card's size is the written size. */
function decodeEntry(entry: unknown): { path: string; bytes: Buffer } {
  const { path, content, encoding = "utf8" } = (entry ?? {}) as Record<string, unknown>;
  if (typeof path !== "string" || typeof content !== "string") return refuse({ message: "each file needs a string 'path' and 'content'" });
  if (encoding === "utf8") return { path, bytes: Buffer.from(content, "utf8") };
  if (encoding !== "base64" || !BASE64.test(content)) refuse({ message: `${path}: encoding must be 'utf8', or 'base64' with valid base64 content` });
  return { path, bytes: Buffer.from(content, "base64") };
}

/**
 * Validates a whole batch before any card: caps, encodings, duplicate paths (case-folded, as macOS
 * and Windows folders usually are), then every path. Nothing is written.
 * @throws {FsWriteInputError} On the first problem. @complexity O(n·depth) lstats + O(total bytes).
 */
export function prepareFileWrites({ folder, files, resolveFsFilePath }: { folder: string; files: unknown; resolveFsFilePath: ResolveFsFilePath }, _optional = {}): PreparedFileWrite[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > FS_WRITE_LIMITS.maxFiles) refuse({ message: `'files' must list 1 to ${FS_WRITE_LIMITS.maxFiles} files; split a bigger change` });
  const decoded = (files as unknown[]).map(decodeEntry);
  const seen = new Set(decoded.map(({ path }) => path.toLowerCase()));
  if (seen.size !== decoded.length) refuse({ message: "a path is listed more than once" });
  if (decoded.some(({ bytes }) => bytes.length > FS_WRITE_LIMITS.maxFileBytes)) refuse({ message: "each file may be at most 2 MiB" });
  if (decoded.reduce((sum, { bytes }) => sum + bytes.length, 0) > FS_WRITE_LIMITS.maxTotalBytes) refuse({ message: "one call may write at most 10 MiB; split the change" });
  return decoded.map(({ path, bytes }) => ({ path, bytes, overwrite: inspectWriteTarget({ folder, path, resolveFsFilePath }).overwrite }));
}

/** Re-checks one approved entry against the disk as it is now, then writes a temp file beside the
 * target and renames it over, so a reader never sees half a file and a failure leaves no temp. */
function writeOne({ folder, write, resolveFsFilePath }: { folder: string; write: PreparedFileWrite; resolveFsFilePath: ResolveFsFilePath }): void {
  const { target, overwrite } = inspectWriteTarget({ folder, path: write.path, resolveFsFilePath });
  if (overwrite !== write.overwrite) refuse({ message: overwrite ? "a file appeared here since approval" : "the file was removed since approval" });
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, write.bytes, { flag: "wx" });
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * Writes an approved batch in order and stops at the first failure, so the result says exactly which
 * files landed; already-written files stay (each was on the card). @complexity O(n·depth) + O(bytes).
 */
export function writePreparedFiles({ folder, writes, resolveFsFilePath }: { folder: string; writes: readonly PreparedFileWrite[]; resolveFsFilePath: ResolveFsFilePath }, _optional = {}) {
  const written: string[] = [];
  for (const [index, write] of writes.entries()) {
    try {
      writeOne({ folder, write, resolveFsFilePath });
      written.push(write.path);
    } catch (error) {
      return { written, failed: { path: write.path, reason: (error as Error).message }, notWritten: writes.slice(index + 1).map((w) => w.path) };
    }
  }
  return { written, notWritten: [] as string[] };
}
