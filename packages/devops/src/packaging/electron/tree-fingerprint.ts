/**
 * @file Cheap live "is this tree being written to?" sampling for a packaging precondition gate.
 *
 * Why a fingerprint and not a content hash or an absolute file age: the check runs twice within a
 * second, so it cannot walk-and-hash a large tree twice; and it also runs on a fresh CI checkout,
 * where every file's mtime is "now", so "modified in the last N seconds" would read true on every
 * run. Two fingerprints taken a short pause apart are identical exactly when nothing was created,
 * deleted or written in between, whatever the absolute mtimes are. This is a sample, not proof the
 * tree stays quiet for the pack that follows; the finished archive still has to be verified.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** File count plus the newest mtime under a path, or `exists: false` when the path is absent. */
export interface TreeFingerprint { readonly exists: boolean; readonly fileCount: number; readonly newestMtimeMs: number }

const ABSENT: TreeFingerprint = { exists: false, fileCount: 0, newestMtimeMs: 0 };

/** Fingerprint one path; an absent path is a value, never an error.
 * @example fingerprintTree({ path: "/repo/app/src" });
 * @complexity O(n) in files under the path.
 */
export function fingerprintTree({ path: target }: { path: string }, _optional: Record<string, never> = {}): TreeFingerprint {
  let stat;
  try { stat = statSync(target); } catch { return ABSENT; }
  if (!stat.isDirectory()) return { exists: true, fileCount: 1, newestMtimeMs: stat.mtimeMs };
  let fileCount = 0;
  let newestMtimeMs = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      const inner = fingerprintTree({ path: child });
      fileCount += inner.fileCount;
      newestMtimeMs = Math.max(newestMtimeMs, inner.newestMtimeMs);
    } else if (entry.isFile()) {
      fileCount += 1;
      newestMtimeMs = Math.max(newestMtimeMs, statSync(child).mtimeMs);
    }
  }
  return { exists: true, fileCount, newestMtimeMs };
}

export function fingerprintsDiffer({ a, b }: { a: TreeFingerprint; b: TreeFingerprint }, _optional: Record<string, never> = {}): boolean {
  return a.exists !== b.exists || a.fileCount !== b.fileCount || a.newestMtimeMs !== b.newestMtimeMs;
}

export interface MovingRootsRequired {
  readonly roots: readonly string[];
  /** Blocks for the sampling window; synchronous so a gate script needs no async plumbing for a one-shot check. */
  readonly pause: () => void;
  readonly fingerprint: (required: { path: string }) => TreeFingerprint;
}

/** The roots whose fingerprint changed across one `pause`. No roots is a configuration error: it must never read as quiet.
 * @example sampleMovingRoots({ roots, pause, fingerprint: fingerprintTree });
 * @complexity O(n) in files under the roots, twice.
 */
export function sampleMovingRoots({ roots, pause, fingerprint }: MovingRootsRequired, _optional: Record<string, never> = {}): string[] {
  if (!roots.length) throw new Error('packaged surface roots are required');
  const before = roots.map(root => fingerprint({ path: root }));
  pause();
  const after = roots.map(root => fingerprint({ path: root }));
  return roots.filter((_, index) => fingerprintsDiffer({ a: before[index]!, b: after[index]! }));
}
