import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { syncDirectoryBestEffort } from "./atomic-write.js";

export interface VerifiedFileGroup { from: string; to: string; sidecars: readonly string[]; }

/** Stage related files together while both directory identities are reserved by the host. Raw
 * sources remain intact through inspection so even WAL/SHM bytes are retained. Verification opens only
 * stopped databases through an injected read-only inspector; the filesystem owner never uses SQL.
 * @complexity O(total bytes + verification cost), bounded memory via native file copies.
 */
export function stageVerifiedFileRelocation(
  { groups, verify }: { groups: readonly VerifiedFileGroup[]; verify: (required: { path: string }) => string },
  { filesystem = fs, backupCovered = () => false, backupId = randomUUID, platform = process.platform }: { filesystem?: typeof fs; backupCovered?: (required: { from: string }) => boolean; backupId?: () => string; platform?: NodeJS.Platform } = {},
): { rollback: () => void; finalize: () => void } {
  const created: string[] = [], retired: { from: string; backup: string }[] = [], markers: string[] = [], redundantBackups: string[] = [];
  const backupSuffix = `.relocation-${backupId()}-backup`;
  const copyExclusive = (from: string, to: string) => {
    // Reserve before copying so a disk-full failure is still ours to clean up. COPYFILE_EXCL
    // alone may create a partial file before throwing, which cannot be tracked after the fact.
    const fd = filesystem.openSync(to, "wx");
    created.push(to); filesystem.closeSync(fd);
    filesystem.copyFileSync(from, to);
    const copied = filesystem.openSync(to, "r+");
    try { filesystem.fsyncSync(copied); } finally { filesystem.closeSync(copied); }
    syncParent(to);
  };
  const syncParent = (file: string) => {
    // Where supported, directory fsync persists retirement/marker ordering before the host commits its catalog.
    syncDirectoryBestEffort({ directory: path.dirname(file), open: filesystem.openSync, sync: filesystem.fsyncSync, close: filesystem.closeSync }, { platform });
  };
  const rollback = () => {
    for (const item of [...retired].reverse()) { filesystem.renameSync(item.backup, item.from); syncParent(item.from); }
    for (const file of [...created].reverse()) { filesystem.rmSync(file, { force: true }); syncParent(file); }
  };
  try {
    for (const group of groups) {
      const pairs = ["", ...group.sidecars].filter((suffix) => filesystem.existsSync(group.from + suffix))
        .map((suffix) => ({ from: group.from + suffix, to: group.to + suffix }));
      for (const pair of pairs) if (!filesystem.lstatSync(pair.from).isFile()) throw new Error(`Database move requires a regular file: ${pair.from}`);
      filesystem.mkdirSync(path.dirname(group.to), { recursive: true });
      const moving = path.resolve(group.from) !== path.resolve(group.to);
      // A directory rename already carries unchanged DB paths atomically; verify those bytes
      // without copying them. For a file move the original inode becomes the sole backup after
      // verification: another full destination backup doubles storage without rollback benefit.
      // Cross-volume directory moves already retain the untouched original directory. A copied
      // DB inside that destination needs no second full backup of the same bytes.
      if (moving) {
        const marker = group.from + ".home2-relocation.json";
        const fd = filesystem.openSync(marker, "wx"); created.push(marker); markers.push(marker);
        try { filesystem.writeFileSync(fd, JSON.stringify({ to: group.to, backup: group.from + backupSuffix })); filesystem.fsyncSync(fd); }
        finally { filesystem.closeSync(fd); }
        syncParent(marker);
      }
      const before = verify({ path: group.from });
      for (const pair of pairs) {
        if (path.resolve(pair.from) === path.resolve(pair.to)) continue;
        // A destination collision aborts; never overwrite another site's data or an old move.
        copyExclusive(pair.from, pair.to);
      }
      if (verify({ path: group.to }) !== before) throw new Error(`Database row counts changed while moving ${path.basename(group.to)}.`);
      // Retire old live names BEFORE commit. Finalization removes recovery markers and redundant copies covered by the retained original: a crash
      // or cleanup failure cannot leave two independently writable database names after commit.
      if (moving) for (const pair of pairs) {
        const backup = pair.from + backupSuffix;
        if (filesystem.existsSync(backup)) throw new Error(`Database backup target already exists: ${backup}`);
        filesystem.renameSync(pair.from, backup); retired.push({ from: pair.from, backup });
        if (backupCovered({ from: pair.from })) redundantBackups.push(backup);
        syncParent(pair.from);
      }
    }
  } catch (error) { rollback(); throw error; }
  return { rollback, finalize: () => {
    for (const backup of redundantBackups) { filesystem.rmSync(backup); syncParent(backup); }
    for (const marker of markers) { filesystem.rmSync(marker); syncParent(marker); } } };
}
