import { stageVerifiedFileRelocation, type VerifiedFileGroup } from "./verified-file-relocation.js";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

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
      const kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "unsupported";
      if (kind === "unsupported") throw new Error(`Cannot move special filesystem entry: ${name}`);
      digest.update(JSON.stringify([name, kind, stat.mode & 0o777]));
      if (kind === "directory") visit(name);
      else if (kind === "link") digest.update(JSON.stringify(filesystem.readlinkSync(absolute)));
      else {
        const fileDigest = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024);
        const descriptor = filesystem.openSync(absolute, "r");
        try {
          let bytes: number;
          while ((bytes = filesystem.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) fileDigest.update(buffer.subarray(0, bytes));
        } finally { filesystem.closeSync(descriptor); }
        digest.update(fileDigest.digest());
      }
    }
  }
  visit(""); return digest.digest("hex");
}

/** Move only into an absent target. Verify before registry commit or source deletion.
 * EXDEV uses copy/verify/retire/commit; failure restores the source and removes only our new copy.
 * Same-filesystem failures roll the rename back. Commit must atomically update the host registry.
 * @complexity O(bytes + entries log entries), with two verification passes.
 */
export function moveDirectoryVerified(
  { from, to, commit }: { from: string; to: string; commit: () => void },
  { excluded = [], filesystem = fs, prepareDestination, relocateFiles, verifyFile }: { excluded?: readonly string[]; filesystem?: typeof fs; prepareDestination?: (required: { path: string }) => void; relocateFiles?: (required: { source: string; target: string }) => readonly VerifiedFileGroup[]; verifyFile?: (required: { path: string }) => string } = {},
): void {
  const source = filesystem.realpathSync(from);
  const target = path.resolve(to);
  if (target === source || target.startsWith(source + path.sep)) throw new Error("A directory cannot be moved into itself.");
  try { filesystem.lstatSync(target); throw new Error(`Move target already exists: ${target}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const before = directoryFingerprint({ dir: source }, { excluded, filesystem });
  let copied = false;
  try { filesystem.renameSync(source, target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    filesystem.mkdirSync(target); copied = true;
    try {
      // The host may reserve the empty destination before any commit marker or database is copied.
      prepareDestination?.({ path: target });
      filesystem.cpSync(source, target, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true,
        filter: (candidate) => candidate === source || !excluded.includes(path.relative(source, candidate).split(path.sep)[0]!),
      });
    }
    catch (failure) { filesystem.rmSync(target, { recursive: true }); throw failure; }
  }
  let retiredSource: string | undefined;
  let staged: ReturnType<typeof stageVerifiedFileRelocation> | undefined;
  try {
    if (directoryFingerprint({ dir: target }, { excluded, filesystem }) !== before) throw new Error("Moved directory verification failed.");
    if (relocateFiles) {
      if (!verifyFile) throw new Error("File relocation requires a verification port.");
      staged = stageVerifiedFileRelocation({ groups: relocateFiles({ source, target }), verify: verifyFile }, { filesystem });
    }
    if (copied) {
      const backupRoot = path.join(path.dirname(source), ".home2-backup");
      const backup = path.join(backupRoot, path.basename(source));
      if (filesystem.existsSync(backup)) throw new Error(`Move backup target already exists: ${backup}`);
      // The EXDEV original becomes a recovery folder before catalog commit, never a second live
      // site at the old path if cleanup fails. An interrupted apply leaves explicit backups.
      filesystem.mkdirSync(backupRoot, { recursive: true });
      filesystem.renameSync(source, backup); retiredSource = backup;
      const fd = filesystem.openSync(backupRoot, "r");
      try { filesystem.fsyncSync(fd); } finally { filesystem.closeSync(fd); }
    }
    // Persist directory-name changes for same-filesystem renames as well as EXDEV retirement.
    for (const directory of new Set([path.dirname(source), path.dirname(target)])) {
      const fd = filesystem.openSync(directory, "r");
      try { filesystem.fsyncSync(fd); } finally { filesystem.closeSync(fd); }
    }
    commit();
  } catch (error) {
    if (retiredSource) filesystem.renameSync(retiredSource, source);
    staged?.rollback();
    if (copied) filesystem.rmSync(target, { recursive: true });
    else filesystem.renameSync(target, source);
    throw error;
  }
  // If deletion fails after commit, the verified target and registry remain usable; old DB live
  // names were already retired before commit. Never roll back a registry whose commit succeeded.
  staged?.finalize();
  // Keep the retired EXDEV recovery folder; it is never a registered/live site path.
}
