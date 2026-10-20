import { stageVerifiedFileRelocation, type VerifiedFileGroup } from "./verified-file-relocation.js";
import { syncDirectoryBestEffort } from "./atomic-write.js";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

/** Fingerprint relative names, entry kinds, symlink targets and file bytes without following links.
 * This is verification, never a log of file contents. Lease files are excluded by the host.
 * @complexity O(bytes + entries log entries), O(entries + a fixed 64 KiB read buffer) space.
 */
export function directoryFingerprint({ dir }: { dir: string }, { excluded = [], filesystem = fs }: { excluded?: readonly string[]; filesystem?: typeof fs } = {}): string {
  const digest = createHash("sha256");
  function visit(relative: string) {
    for (const entry of filesystem.readdirSync(path.join(dir, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!relative && excluded.includes(entry.name)) continue;
      const name = path.join(relative, entry.name), absolute = path.join(dir, name);
      const stat = filesystem.lstatSync(absolute);
      const kind = entryKind(stat);
      if (kind === "unsupported") throw new Error(`Cannot move special filesystem entry: ${name}`);
      digest.update(JSON.stringify([name, kind, stat.mode & 0o777]));
      if (kind === "directory") visit(name);
      else if (kind === "link") digest.update(JSON.stringify(filesystem.readlinkSync(absolute)));
      else digest.update(fileDigest({ absolute, filesystem }));
    }
  }
  visit(""); return digest.digest("hex");
}
function entryKind(stat: fs.Stats): "link" | "directory" | "file" | "unsupported" {
  if (stat.isSymbolicLink()) return "link";
  if (stat.isDirectory()) return "directory";
  return stat.isFile() ? "file" : "unsupported";
}
function fileDigest({ absolute, filesystem }: { absolute: string; filesystem: typeof fs }): Buffer {
  const digest = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024);
  const descriptor = filesystem.openSync(absolute, "r");
  try {
    let bytes: number;
    while ((bytes = filesystem.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, bytes));
  } finally { filesystem.closeSync(descriptor); }
  return digest.digest();
}

interface MoveDirectoryOptions {
  excluded?: readonly string[]; filesystem?: typeof fs; prepareDestination?: (required: { path: string }) => void;
  relocateFiles?: (required: { source: string; target: string }) => readonly VerifiedFileGroup[]; verifyFile?: (required: { path: string }) => string;
  backupId?: () => string; platform?: NodeJS.Platform;
}
type ResolvedMoveOptions = Required<Pick<MoveDirectoryOptions, "excluded" | "filesystem" | "backupId" | "platform">> &
  { [K in "prepareDestination" | "relocateFiles" | "verifyFile"]: MoveDirectoryOptions[K] | undefined };
function withMoveDefaults({ excluded = [], filesystem = fs, prepareDestination, relocateFiles, verifyFile, backupId = randomUUID, platform = process.platform }: MoveDirectoryOptions): ResolvedMoveOptions {
  return { excluded, filesystem, prepareDestination, relocateFiles, verifyFile, backupId, platform };
}
type StagedRelocation = ReturnType<typeof stageVerifiedFileRelocation>;

/** Move only into an absent target. Verify before registry commit or source deletion.
 * EXDEV uses copy/verify/retire/commit; failure restores the source and removes only our new copy.
 * Same-filesystem failures roll the rename back. Commit must atomically update the host registry.
 * @complexity O(bytes + entries log entries), with two verification passes.
 */
export function moveDirectoryVerified(
  { from, to, commit }: { from: string; to: string; commit: () => void },
  options: MoveDirectoryOptions = {},
): void {
  const resolved = withMoveDefaults(options), { excluded, filesystem } = resolved;
  const source = filesystem.realpathSync(from);
  const target = path.resolve(to);
  assertAbsentTarget({ source, target }, { filesystem });
  const before = directoryFingerprint({ dir: source }, { excluded, filesystem });
  const copied = placeAtTarget({ source, target }, resolved);
  const progress: { retiredSource?: string; staged?: StagedRelocation | undefined } = {};
  try {
    if (directoryFingerprint({ dir: target }, { excluded, filesystem }) !== before) throw new Error("Moved directory verification failed.");
    progress.staged = stageRelocation({ source, target, copied }, resolved);
    if (copied) retireCopiedSource({ source, progress }, resolved);
    // Where supported, persist directory-name changes for same-filesystem renames as well as EXDEV retirement.
    for (const directory of new Set([path.dirname(source), path.dirname(target)])) syncDirectory({ directory }, resolved);
    commit();
  } catch (error) {
    rollbackMove({ source, target, copied, ...progress }, resolved);
    throw error;
  }
  // If deletion fails after commit, the verified target and registry remain usable; old DB live
  // names were already retired before commit. Never roll back a registry whose commit succeeded.
  progress.staged?.finalize();
  // Keep the retired EXDEV recovery folder; it is never a registered/live site path.
}
function assertAbsentTarget({ source, target }: { source: string; target: string }, { filesystem }: { filesystem: typeof fs }): void {
  if (target === source || target.startsWith(source + path.sep)) throw new Error("A directory cannot be moved into itself.");
  try { filesystem.lstatSync(target); throw new Error(`Move target already exists: ${target}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
/** Same-filesystem rename, or an EXDEV copy into a freshly created target. Returns whether it copied. */
function placeAtTarget({ source, target }: { source: string; target: string }, { filesystem, excluded, prepareDestination }: ResolvedMoveOptions): boolean {
  try { filesystem.renameSync(source, target); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error; }
  filesystem.mkdirSync(target);
  try {
    // The host may reserve the empty destination before any commit marker or database is copied.
    prepareDestination?.({ path: target });
    filesystem.cpSync(source, target, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true,
      filter: (candidate) => candidate === source || !excluded.includes(path.relative(source, candidate).split(path.sep)[0]!),
    });
  }
  catch (failure) { filesystem.rmSync(target, { recursive: true }); throw failure; }
  return true;
}
function stageRelocation({ source, target, copied }: { source: string; target: string; copied: boolean }, { relocateFiles, verifyFile, filesystem, backupId, platform }: ResolvedMoveOptions): StagedRelocation | undefined {
  if (!relocateFiles) return undefined;
  if (!verifyFile) throw new Error("File relocation requires a verification port.");
  return stageVerifiedFileRelocation({ groups: relocateFiles({ source, target }), verify: verifyFile }, { filesystem, backupId, platform, backupCovered: ({ from }) => copied && path.resolve(from).startsWith(target + path.sep) });
}
/** Records the retired path in `progress` right after the rename, before the directory sync, so a
 * failed fsync still lets rollback restore the source before it removes the copied target. */
function retireCopiedSource({ source, progress }: { source: string; progress: { retiredSource?: string } }, resolved: ResolvedMoveOptions): void {
  const { filesystem, backupId } = resolved;
  const backupRoot = path.join(path.dirname(source), `.relocation-${backupId()}-backup`);
  const backup = path.join(backupRoot, path.basename(source));
  if (filesystem.existsSync(backup)) throw new Error(`Move backup target already exists: ${backup}`);
  // The EXDEV original becomes a recovery folder before catalog commit, never a second live
  // site at the old path if cleanup fails. An interrupted apply leaves explicit backups.
  filesystem.mkdirSync(backupRoot);
  filesystem.renameSync(source, backup); progress.retiredSource = backup;
  syncDirectory({ directory: backupRoot }, resolved);
}
function syncDirectory({ directory }: { directory: string }, { filesystem, platform }: ResolvedMoveOptions): void {
  syncDirectoryBestEffort({ directory, open: filesystem.openSync, sync: filesystem.fsyncSync, close: filesystem.closeSync }, { platform });
}
function rollbackMove(
  { source, target, copied, retiredSource, staged }: { source: string; target: string; copied: boolean; retiredSource?: string; staged?: StagedRelocation | undefined },
  { filesystem }: ResolvedMoveOptions,
): void {
  if (retiredSource) filesystem.renameSync(retiredSource, source);
  staged?.rollback();
  if (copied) filesystem.rmSync(target, { recursive: true });
  else filesystem.renameSync(target, source);
}
