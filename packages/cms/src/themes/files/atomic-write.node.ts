import { accessSync, chmodSync, constants as fsConstants, copyFileSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, type Stats } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, sep } from "node:path";
import { reviewedWriteScope, type ThemeFileAddress } from "./reviewed-write.node.js";

export interface ThemeFileWritePorts {
  readonly resolvePath: (address: ThemeFileAddress) => string;
  readonly statPath: (required: { target: string; relativePath: string }, optional?: { stat?: typeof statSync }) => Stats | undefined;
  readonly digest: (required: { path: string }) => string;
  readonly changedError: (required: Record<string, never>) => Error;
  readonly pathError: (required: { reason: "not-regular-file" | "revision-sequence-exhausted"; relativePath?: string }) => Error;
  readonly reportPruneFailure: (required: { error: unknown }) => void;
}


/**
 * Replace `target` by filling a sibling temp file in the SAME directory and `renameSync`-ing it over
 * `target`, instead of truncating `target` in place. `fillTemp` creates that temp file at the path it
 * is given: the host writer writes text there, and its reset operation copies a catalog
 * original's bytes there.
 *
 * Why this matters: a plain `writeFileSync(target, …, "w")` truncates `target`'s own inode the
 * instant it opens, before any content lands — a crash or a concurrent reader mid-write can then
 * observe an empty or partial file. For `theme.json`, the file the host loader must parse whole,
 * that turns one torn write into a broken WHOLE theme. Renaming a fully-written temp file over
 * `target` instead swaps the directory entry atomically: a reader that already has `target` open
 * by descriptor keeps reading the old, complete inode; a reader that opens `target` by path
 * afterward sees either the fully-old or fully-new content, never a partial one.
 *
 * The temp file is a sibling of `target` (same directory), not under a shared system tmp dir,
 * because `renameSync` requires both paths on the SAME filesystem — a cross-device rename throws
 * `EXDEV` instead of renaming.
 *
 * Checks write access on an existing `target` up front: `rename()` only needs write permission on
 * the DIRECTORY, not the destination file, so a bare temp-then-rename would otherwise silently
 * succeed over a read-only target — regressing the permission-denied refusal a `"w"`-flag
 * `writeFileSync` open gave callers before this change. The temp file also inherits `target`'s
 * existing mode before the rename, so replacing a file does not silently change its permissions.
 * When `target` does not exist yet, the new file keeps the mode `fillTemp` created it with.
 *
 * @throws whatever `accessSync`, `fillTemp`, `chmodSync` or `renameSync` throws, or
 * the host path error if the pre-write stat port hits a circular symlink. The temp file is removed
 * before the error propagates, so a failed write leaves no artifact behind in the theme folder.
 * @complexity O(s + r log r + r*d) time and O(r + d) space for s written/copied bytes, r revisions and path depth d.
 */
export function writeFileAtomically({ ports, target, relativePathForError, fillTemp }: { ports: ThemeFileWritePorts; target: string; relativePathForError: string; fillTemp: (tempPath: string) => void }, { stat = statSync, revisionFile, options = {} }: { stat?: typeof statSync; revisionFile?: ThemeRevisionFile; options?: { now?: () => number } } = {}): string | undefined {
  // The host stat port, NEVER a bare statSync — the same circular-symlink ELOOP handling as
  // the other post-resolve stat calls. In practice, both host write/reset callers already run
  // an identical stat on the same `target` just before and throw first for a circular symlink,
  // so this call is shadowed
  // under ordinary single-process execution; it still guards a genuine TOCTOU window (an external
  // process replacing `target` with a symlink cycle between the two calls) and any future caller
  // that skips that earlier check. Still follows a symlink pointing at a real file inside the theme,
  // matching `renameSync` below, which replaces that symlink's own directory entry.
  const existing = ports.statPath({ target, relativePath: relativePathForError }, { stat });
  if (existing) {
    accessSync(target, fsConstants.W_OK);
  }
  const tempPath = join(dirname(target), `.${basename(target)}.${process.pid}-${randomUUID()}.tmp`);
  let revision: string | undefined;
  try {
    fillTemp(tempPath);
    if (existing) chmodSync(tempPath, existing.mode);
    // Source I/O and authorization may have yielded since approval. Check in the persistence
    // owner, with no await before revision capture and replacement.
    assertReviewedThemeFileCurrent({ target, ports });
    // The temp file holds exactly what the rename publishes: its digest, taken before the rename, is the version this write commits.
    const committed = reviewedCommitDigest({ tempPath, ports });
    if (existing && revisionFile) revision = saveThemeFileRevision({ ...revisionFile, target, ports }, options);
    renameSync(tempPath, target);
    recordReviewedCommit({ committed });
  } catch (err) {
    rmSync(tempPath, { force: true });
    if (revision) rmSync(revision, { recursive: true, force: true });
    throw err;
  }
  pruneCommittedThemeRevision({ revision, revisionFile, target, ports });
  // A direct replacement remains reversible within the bounded revision store. Manual trash is
  // retained until the owner explicitly permanently deletes it through the confirmation path.
  return revision;
}

/** Apply retention only after a replacement commits; cleanup failures never hide a saved edit.
 * @complexity Inherits the per-file retention scan; no work for a new file or a write in trash. */
function pruneCommittedThemeRevision({ revision, revisionFile, target, ports }: {
  revision: string | undefined; revisionFile: ThemeRevisionFile | undefined; target: string; ports: ThemeFileWritePorts;
}, _options = {}): void {
  if (!revision || !revisionFile) return;
  try { pruneThemeFileRevisions({ ...revisionFile, target, ports }); }
  catch (error) {
    // The rename already committed. Report cleanup separately so callers still reload; the
    // next replacement retries retention, including revisions left by this attempt.
    ports.reportPruneFailure({ error });
  }
}

/** The digest to report for a write inside a tool's reviewed scope; no work for a write outside one. */
function reviewedCommitDigest({ tempPath, ports }: { tempPath: string; ports: ThemeFileWritePorts }, _options = {}): string | undefined {
  return reviewedWriteScope() ? ports.digest({ path: tempPath }) : undefined;
}

function recordReviewedCommit({ committed }: { committed: string | undefined }, _options = {}): void {
  const scope = reviewedWriteScope();
  if (scope) scope.committed = committed;
}

function assertReviewedThemeFileCurrent({ target, ports }: { target: string; ports: ThemeFileWritePorts }, _options = {}): void {
  const prepared = reviewedWriteScope()?.prepared;
  if (!prepared) return;
  const current = readThemeFileVersion({ ...prepared.file, ports });
  if (target !== prepared.target || current.target !== prepared.target || current.version !== prepared.version) {
    throw ports.changedError({});
  }
}

/** Pin contained theme bytes for a replacement review, including binaries past the text read cap.
 * @returns Canonical target and SHA-256; null means a new file. Symlinks use the normal theme rules.
 * @throws The host path error for invalid/nonregular paths; other read failures propagate.
 * @complexity O(file bytes) time, O(64 KiB) space through the host digest port. */
export function readThemeFileVersion(required: ThemeFileAddress & { ports: ThemeFileWritePorts }, _options: Record<string, never> = {}): { target: string; version: string | null } {
  const { ports, ...address } = required;
  const target = ports.resolvePath(address);
  const existing = ports.statPath({ target, relativePath: required.relativePath });
  if (!existing) return { target, version: null };
  if (!existing.isFile()) throw ports.pathError({ reason: "not-regular-file", relativePath: required.relativePath });
  return { target, version: ports.digest({ path: target }) };
}

/** Replacement revisions are separate from manually trashed files, which retention never deletes. */
const THEME_REVISION_ROOT = '.trash/revisions';
const MAX_THEME_FILE_REVISIONS = 20;
type ThemeRevisionFile = ThemeFileAddress;

/** Real numeric revision directories only; never follow or delete a symlink during retention.
 * @complexity O(r log r) time and O(r) space for r stored revision directories. */
function themeRevisionDirectories({ root }: { root: string }, _options = {}): string[] {
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name) && Number.isSafeInteger(Number(entry.name)))
    .map(entry => entry.name).sort((a, b) => Number(a) - Number(b));
}

/** Copies current theme bytes to the existing restorable trash layout before replacement.
 * Numeric directory creation is exclusive; parallel writes cannot overwrite a previous revision.
 * @returns The owned revision directory, or undefined for a write already inside trash.
 * @throws Containment/copy failures before the live file changes; partial revisions are removed.
 * @complexity O(file bytes + r log r + timestamp collisions) time, O(r) space for r revisions; copyFileSync never buffers the whole file. */
function saveThemeFileRevision(
  required: ThemeRevisionFile & { target: string; ports: ThemeFileWritePorts }, { now = Date.now }: { now?: () => number } = {},
): string | undefined {
  const { ports, ...file } = required;
  // The resolver canonicalizes the target; use the same base for roots reached through symlinks.
  const normalized = relative(realpathSync(required.themeDir), required.target).split(sep).join('/');
  if (normalized.split('/')[0] === '.trash') return undefined;
  const root = ports.resolvePath({ ...file, relativePath: THEME_REVISION_ROOT });
  mkdirSync(root, { recursive: true });
  const previous = themeRevisionDirectories({ root });
  const { directory, sequence } = createThemeRevisionDirectory({ root, next: Math.max(now(), Number(previous.at(-1) ?? 0) + 1), ports });
  try {
    const destination = ports.resolvePath({ ...file, relativePath: `${THEME_REVISION_ROOT}/${sequence}/${normalized}` });
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(required.target, destination, fsConstants.COPYFILE_EXCL);
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Reserve a numeric directory exclusively; parallel writes cannot overwrite an old revision.
 * @returns The owned directory and sequence. Only collisions retry; other filesystem errors and
 * exhausted sequence numbers propagate before any live-file change.
 * @complexity O(timestamp collisions) time, O(1) space. */
function createThemeRevisionDirectory({ root, next, ports }: { root: string; next: number; ports: ThemeFileWritePorts }, _options = {}): { directory: string; sequence: number } {
  for (;;) {
    if (!Number.isSafeInteger(next)) throw ports.pathError({ reason: "revision-sequence-exhausted" });
    const directory = join(root, String(next));
    try { mkdirSync(directory); return { directory, sequence: next }; }
    catch (error) {
      if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST')) throw error;
      next++;
    }
  }
}

/** Keep the latest 20 replacements per canonical file; manual trash and other files survive.
 * Remove only that file from a revision directory, since restored/legacy directories may contain
 * multiple files. Symlink ancestors are skipped rather than followed during retention.
 * @throws Filesystem/containment errors; the committed-write caller reports these separately.
 * @complexity O(r log r + r*d + removed bytes) time, O(r) space for r revisions and path depth d. */
function pruneThemeFileRevisions(required: ThemeRevisionFile & { target: string; ports: ThemeFileWritePorts }, _options = {}): void {
  const { ports, ...file } = required;
  const normalized = relative(realpathSync(required.themeDir), required.target);
  const root = ports.resolvePath({ ...file, relativePath: THEME_REVISION_ROOT });
  const files = themeRevisionDirectories({ root }).flatMap(directory => {
    const file = regularRevisionFile({ root: join(root, directory), normalized });
    return file ? [file] : [];
  });
  for (const file of files.slice(0, -MAX_THEME_FILE_REVISIONS)) {
    rmSync(file);
    removeEmptyRevisionParents({ directory: dirname(file), root });
  }
}

/** Walk real directories only so retention cannot delete through even an in-theme symlink.
 * @returns The regular revision file, or undefined for missing/nonregular/symlink paths.
 * @complexity O(d) time and space for path depth d; metadata reads only. */
function regularRevisionFile({ root, normalized }: { root: string; normalized: string }, _options = {}): string | undefined {
  const parts = normalized.split(sep);
  let file = root;
  for (const part of parts.slice(0, -1)) {
    file = join(file, part);
    if (!lstatSync(file, { throwIfNoEntry: false })?.isDirectory()) return undefined;
  }
  const name = parts.at(-1);
  if (name === undefined) throw new Error("Theme file path has no filename");
  file = join(file, name);
  return lstatSync(file, { throwIfNoEntry: false })?.isFile() ? file : undefined;
}

/** Remove only empty revision parents after pruning; never erase a sibling file or manual trash.
 * @throws Filesystem failures so the next replacement can retry cleanup.
 * @complexity O(d + directory entries) metadata reads for the removed file's parent chain. */
function removeEmptyRevisionParents({ directory, root }: { directory: string; root: string }, _options = {}): void {
  while (directory !== root && readdirSync(directory).length === 0) {
    rmdirSync(directory);
    directory = dirname(directory);
  }
}
