/** Desktop OS adapter for the reviewed batched footprint read; no per-process probes. */
import type { ProcessPrivateMemory, ProcessUsage } from '@jini-ai/core/contracts/site/platform-process';
import { orFallback } from '@jini-ai/core/errors/idioms';
import { applyElectronMemoryReadings, type ElectronProcessMemory } from './electron-process-memory.js';
import type { MemoryMetric, ResourceProcess } from "@jini-ai/core/contracts/site/contracts-resources";

/** Inject one bulk native read; null/missing/invalid readings keep that process's RSS. */
export type PrivateMemorySampler = (input: { pids: readonly number[] }, options?: object) => Promise<ProcessPrivateMemory>;
/** Usage preserves CPU/parent identity while carrying the selected memory source. */
export type MemoryUsage = ProcessUsage & { memoryMetric: MemoryMetric; rawRssBytes: number };

/** Electron privateBytes is committed memory on Windows. Other hosts keep OS RSS until a native reading succeeds.
 * Invalid Electron readings never replace a usable RSS value. O(p+e) for p usages/e Electron metrics. */
function fallbackMemory({ usages, platform, electronMetrics }: {
  usages: readonly ProcessUsage[]; platform: NodeJS.Platform; electronMetrics: readonly ElectronProcessMemory[];
}, _options = {}): MemoryUsage[] {
  const valid = platform === 'win32' ? electronMetrics.filter(row => validBytes(row.memory.privateBytes)) : [];
  const committed = new Set(valid.map(row => row.pid));
  return applyElectronMemoryReadings({ processes: usages.map(row => ({ ...row, rawRssBytes: row.rssBytes })), electronMetrics: valid }).map(row => ({ ...row,
    memoryMetric: committed.has(row.pid) ? 'committed' : 'rss' }));
}

function validBytes(bytes: number | null | undefined): bytes is number {
  return typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0;
}

/** Native failure is per-memory-source: preserve the inventory and CPU counters for RSS fallback.
 * @returns New usage rows with explicit source; never mutates the OS rows. O(p+e+r) time/space.
 * @example await readDesktopMemory({ usages, platform: 'darwin', electronMetrics: [], samplePrivateMemory })
 */
export async function readDesktopMemory({ usages, platform, electronMetrics, samplePrivateMemory }: {
  usages: readonly ProcessUsage[]; platform: NodeJS.Platform; electronMetrics: readonly ElectronProcessMemory[];
  samplePrivateMemory: PrivateMemorySampler | undefined;
}, _options = {}): Promise<MemoryUsage[]> {
  const fallback = fallbackMemory({ usages, platform, electronMetrics });
  if (!samplePrivateMemory || !usages.length) return fallback;
  return orFallback({ work: async () => {
    const native = await samplePrivateMemory({ pids: usages.map(row => row.pid) });
    if (native.metric === 'unavailable') return fallback;
    const metric = native.metric;
    const byPid = new Map(native.readings.map(row => [row.pid, row.bytes]));
    return fallback.map(row => {
      const bytes = byPid.get(row.pid);
      return validBytes(bytes) ? { ...row, rssBytes: bytes, memoryMetric: metric } : row;
    });
  }, fallback, step: 'Read desktop private memory' });
}

/** A subtotal must expose fallback even if only one child failed; empty groups default to RSS. O(p) time/O(1) space. */
export function groupMemoryMetric({ processes }: { processes: readonly ResourceProcess[] }, _options = {}): MemoryMetric {
  const sources = new Set(processes.map(row => row.memoryMetric ?? 'rss'));
  if (sources.size < 2) return sources.values().next().value ?? 'rss';
  return sources.has('rss') ? 'mixed-rss' : 'mixed';
}
