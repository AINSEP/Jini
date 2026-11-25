import type { CacheClearMark, CacheClearMarker } from './cache-maintenance.js';

export interface MaintenanceMarkerFs {
  readFile(required: { path: string }): Promise<string>;
  writeFile(required: { path: string; data: string }): Promise<void>;
  rename(required: { oldPath: string; newPath: string }): Promise<void>;
}
type CacheClearRecord = { state: 'done' | 'pending'; capBytes: number; attempts: number; lastReason?: string };
interface MarkerDoc {
  v: 1;
  partitions: Record<string, { cacheClear?: CacheClearRecord }>;
  lastLaunchVersion?: string;
  codeCache?: { forVersion: string; pending: string[] };
}
export type CodeCacheMark = { state: 'ok'; lastLaunchVersion: string | null; forVersion: string | null; pending: string[] } | { state: 'unknown'; reason: string };

const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const empty = (): MarkerDoc => ({ v: 1, partitions: {} });

function parse(text: string): MarkerDoc | null {
  try {
    const doc = JSON.parse(text) as Partial<MarkerDoc>;
    const ok = doc.v === 1 && typeof doc.partitions === 'object' && doc.partitions !== null && !Array.isArray(doc.partitions);
    return ok ? (doc as MarkerDoc) : null;
  } catch { return null; }
}

/**
 * The per-profile maintenance record (`maintenance.json` in that profile's folder, so each profile keeps
 * its own). Writes are temp-then-rename and serialized within the process. Two processes can still lose
 * each other's update; that only ever leaves a partition pending again, never falsely done, because a
 * done mark is honoured only for the current `capBytes` and done → pending happens only when it changes.
 * @complexity O(partitions) per write (whole-document rewrite).
 */
export function createMaintenanceMarker(
  { file, fs }: { file: string; fs: MaintenanceMarkerFs },
  _optional: Record<string, never> = {},
) {
  let queue: Promise<unknown> = Promise.resolve();
  let seq = 0;
  const load = async (): Promise<{ doc: MarkerDoc } | { unknown: string }> => {
    let text: string;
    try { text = await fs.readFile({ path: file }); }
    catch (error) { return code(error) === 'ENOENT' ? { doc: empty() } : { unknown: String(code(error) ?? error) }; }
    const doc = parse(text);
    return doc ? { doc } : { unknown: 'corrupt maintenance record' };
  };
  /** A corrupt or unreadable record restarts empty: every partition becomes pending and is re-measured. */
  const update = (change: (doc: MarkerDoc) => void): Promise<void> => {
    const next = queue.catch(() => {}).then(async () => {
      const loaded = await load();
      const doc = 'doc' in loaded ? loaded.doc : empty();
      change(doc);
      const temp = `${file}.${++seq}.tmp`;
      await fs.writeFile({ path: temp, data: JSON.stringify(doc) });
      await fs.rename({ oldPath: temp, newPath: file });
    });
    queue = next;
    return next;
  };
  const readCacheClear = async ({ partition }: { partition: string }): Promise<CacheClearMark> => {
    const loaded = await load();
    if ('unknown' in loaded) return { state: 'unknown', reason: loaded.unknown };
    const rec = loaded.doc.partitions[partition]?.cacheClear;
    if (!rec) return { state: 'absent' };
    if (rec.state === 'done') return { state: 'done', capBytes: rec.capBytes };
    return { state: 'pending', capBytes: rec.capBytes, attempts: rec.attempts, lastReason: rec.lastReason ?? 'unknown' };
  };
  const markCacheClear: CacheClearMarker['markCacheClear'] = ({ partition, capBytes, outcome }) => update(doc => {
    const prev = doc.partitions[partition]?.cacheClear;
    const attempts = (prev?.state === 'pending' ? prev.attempts : 0) + (outcome.state === 'pending' ? 1 : 0);
    const cacheClear: CacheClearRecord = outcome.state === 'done'
      ? { state: 'done', capBytes, attempts: 0 }
      : { state: 'pending', capBytes, attempts, lastReason: outcome.reason };
    doc.partitions[partition] = { ...doc.partitions[partition], cacheClear };
  });
  return { readCacheClear, markCacheClear, update, load };
}
export type MaintenanceMarker = ReturnType<typeof createMaintenanceMarker>;
