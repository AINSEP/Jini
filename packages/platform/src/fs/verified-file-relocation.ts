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
  options: { filesystem?: typeof fs; backupCovered?: (required: { from: string }) => boolean; backupId?: () => string; platform?: NodeJS.Platform } = {},
): { rollback: () => void; finalize: () => void } {
  const { filesystem, backupCovered, backupId, platform } = withStageDefaults(options);
  const stage: StageState = { filesystem, platform, backupSuffix: `.relocation-${backupId()}-backup`, created: [], retired: [], markers: [], redundantBackups: [] };
  try {
    for (const group of groups) stageGroup({ stage, group, verify, backupCovered });
  } catch (error) { rollbackStage(stage); throw error; }
  return { rollback: () => rollbackStage(stage), finalize: () => finalizeStage(stage) };
}
function withStageDefaults(
  { filesystem = fs, backupCovered = () => false, backupId = randomUUID, platform = process.platform }: { filesystem?: typeof fs; backupCovered?: (required: { from: string }) => boolean; backupId?: () => string; platform?: NodeJS.Platform },
) {
  return { filesystem, backupCovered, backupId, platform };
}
interface StageState {
  filesystem: typeof fs; platform: NodeJS.Platform; backupSuffix: string;
  created: string[]; retired: { from: string; backup: string }[]; markers: string[]; redundantBackups: string[];
}
interface FilePair { from: string; to: string; }
function stageGroup({ stage, group, verify, backupCovered }: { stage: StageState; group: VerifiedFileGroup; verify: (required: { path: string }) => string; backupCovered: (required: { from: string }) => boolean }): void {
  const { filesystem } = stage;
  const pairs = existingRegularPairs({ stage, group });
  filesystem.mkdirSync(path.dirname(group.to), { recursive: true });
  const moving = path.resolve(group.from) !== path.resolve(group.to);
  // A directory rename already carries unchanged DB paths atomically; verify those bytes
  // without copying them. For a file move the original inode becomes the sole backup after
  // verification: another full destination backup doubles storage without rollback benefit.
  // Cross-volume directory moves already retain the untouched original directory. A copied
  // DB inside that destination needs no second full backup of the same bytes.
  if (moving) writeRelocationMarker({ stage, group });
  const before = verify({ path: group.from });
  for (const pair of pairs) {
    if (path.resolve(pair.from) === path.resolve(pair.to)) continue;
    // A destination collision aborts; never overwrite another site's data or an old move.
    copyExclusive({ stage, ...pair });
  }
  if (verify({ path: group.to }) !== before) throw new Error(`Database row counts changed while moving ${path.basename(group.to)}.`);
  // Retire old live names BEFORE commit. Finalization removes recovery markers and redundant copies covered by the retained original: a crash
  // or cleanup failure cannot leave two independently writable database names after commit.
  if (moving) for (const pair of pairs) retireLiveName({ stage, pair, backupCovered });
}
function existingRegularPairs({ stage: { filesystem }, group }: { stage: StageState; group: VerifiedFileGroup }): FilePair[] {
  const pairs = ["", ...group.sidecars].filter((suffix) => filesystem.existsSync(group.from + suffix))
    .map((suffix) => ({ from: group.from + suffix, to: group.to + suffix }));
  for (const pair of pairs) if (!filesystem.lstatSync(pair.from).isFile()) throw new Error(`Database move requires a regular file: ${pair.from}`);
  return pairs;
}
function writeRelocationMarker({ stage, group }: { stage: StageState; group: VerifiedFileGroup }): void {
  const { filesystem } = stage;
  const marker = group.from + ".home2-relocation.json";
  const fd = filesystem.openSync(marker, "wx"); stage.created.push(marker); stage.markers.push(marker);
  try { filesystem.writeFileSync(fd, JSON.stringify({ to: group.to, backup: group.from + stage.backupSuffix })); filesystem.fsyncSync(fd); }
  finally { filesystem.closeSync(fd); }
  syncParent({ stage, file: marker });
}
function copyExclusive({ stage, from, to }: { stage: StageState } & FilePair): void {
  const { filesystem } = stage;
  // Reserve before copying so a disk-full failure is still ours to clean up. COPYFILE_EXCL
  // alone may create a partial file before throwing, which cannot be tracked after the fact.
  const fd = filesystem.openSync(to, "wx");
  stage.created.push(to); filesystem.closeSync(fd);
  filesystem.copyFileSync(from, to);
  const copied = filesystem.openSync(to, "r+");
  try { filesystem.fsyncSync(copied); } finally { filesystem.closeSync(copied); }
  syncParent({ stage, file: to });
}
function retireLiveName({ stage, pair, backupCovered }: { stage: StageState; pair: FilePair; backupCovered: (required: { from: string }) => boolean }): void {
  const backup = pair.from + stage.backupSuffix;
  if (stage.filesystem.existsSync(backup)) throw new Error(`Database backup target already exists: ${backup}`);
  stage.filesystem.renameSync(pair.from, backup); stage.retired.push({ from: pair.from, backup });
  if (backupCovered({ from: pair.from })) stage.redundantBackups.push(backup);
  syncParent({ stage, file: pair.from });
}
function syncParent({ stage: { filesystem, platform }, file }: { stage: StageState; file: string }): void {
  // Where supported, directory fsync persists retirement/marker ordering before the host commits its catalog.
  syncDirectoryBestEffort({ directory: path.dirname(file), open: filesystem.openSync, sync: filesystem.fsyncSync, close: filesystem.closeSync }, { platform });
}
function rollbackStage(stage: StageState): void {
  for (const item of [...stage.retired].reverse()) { stage.filesystem.renameSync(item.backup, item.from); syncParent({ stage, file: item.from }); }
  for (const file of [...stage.created].reverse()) { stage.filesystem.rmSync(file, { force: true }); syncParent({ stage, file }); }
}
function finalizeStage(stage: StageState): void {
  for (const backup of stage.redundantBackups) { stage.filesystem.rmSync(backup); syncParent({ stage, file: backup }); }
  for (const marker of stage.markers) { stage.filesystem.rmSync(marker); syncParent({ stage, file: marker }); }
}
