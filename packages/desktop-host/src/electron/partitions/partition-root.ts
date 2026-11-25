import path from 'node:path';
import type { PartitionFsPort } from './holder-registry.js';

export type PartitionRootRead =
  | { state: 'ok'; root: string }
  | { state: 'absent' }
  | { state: 'unknown'; reason: string };
export interface PartitionCandidate { name: string; path: string }
export interface SkippedCandidate { name: string; reason: 'link' | 'not-directory' | 'escape' | 'unreadable' }
export type CandidateList =
  | { state: 'ok'; candidates: PartitionCandidate[]; skipped: SkippedCandidate[] }
  | { state: 'unknown'; reason: string };

const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

/** Canonical partitions root: `realpath(<sessionData>/Partitions)`. ENOENT means nothing to do. @complexity O(1) fs calls. */
export async function resolvePartitionRoot(
  { sessionDataDir, fs }: { sessionDataDir: string; fs: Pick<PartitionFsPort, 'realpath'> },
  _optional: Record<string, never> = {},
): Promise<PartitionRootRead> {
  try { return { state: 'ok', root: await fs.realpath({ path: path.join(sessionDataDir, 'Partitions') }) }; }
  catch (error) {
    if (code(error) === 'ENOENT') return { state: 'absent' };
    return { state: 'unknown', reason: `partitions root unreadable (${code(error) ?? 'error'})` };
  }
}

async function classify(root: string, name: string, fs: Pick<PartitionFsPort, 'lstat' | 'realpath'>): Promise<SkippedCandidate['reason'] | null> {
  const candidate = path.join(root, name);
  try {
    const stat = await fs.lstat({ path: candidate });
    if (stat.isSymbolicLink()) return 'link';
    if (!stat.isDirectory()) return 'not-directory';
    // A Windows junction can pass lstat as a plain directory; containment is decided by realpath.
    return path.dirname(await fs.realpath({ path: candidate })) === root ? null : 'escape';
  } catch { return 'unreadable'; }
}

/**
 * Direct, non-link, contained children of `root` whose names the host manages. Skipped entries are
 * reported so a caller can show them, and are never handed to anything that mutates.
 * @complexity O(n) children, two fs calls each.
 */
export async function listCandidates(
  { root, fs, isManaged }: { root: string; fs: Pick<PartitionFsPort, 'readdir' | 'lstat' | 'realpath'>; isManaged: (name: string) => boolean },
  _optional: Record<string, never> = {},
): Promise<CandidateList> {
  let names: string[];
  try { names = await fs.readdir({ path: root }); }
  catch (error) { return { state: 'unknown', reason: `partitions root unreadable (${code(error) ?? 'error'})` }; }
  const candidates: PartitionCandidate[] = [], skipped: SkippedCandidate[] = [];
  for (const name of names.filter(entry => isManaged(entry))) {
    const reason = await classify(root, name, fs);
    if (reason === null) candidates.push({ name, path: path.join(root, name) });
    else skipped.push({ name, reason });
  }
  return { state: 'ok', candidates, skipped };
}
