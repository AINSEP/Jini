import type { SnapshotPort, SleepPort } from './ports.js';
/** Compare live observations, not absolute file ages: a fresh checkout is quiet if unchanged. */
export async function observeMovingPaths(required: { roots: readonly string[]; intervalMs: number; snapshots: SnapshotPort; clock: SleepPort }): Promise<string[]> {
  if (!Number.isFinite(required.intervalMs) || required.intervalMs <= 0) throw new Error('intervalMs must be positive');
  if (!required.roots.length) throw new Error('packaged surface roots are required');
  const before = new Map(required.snapshots.snapshot({ roots: required.roots }));
  await required.clock.sleep({ milliseconds: required.intervalMs });
  const after = required.snapshots.snapshot({ roots: required.roots });
  return [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file)).sort();
}
