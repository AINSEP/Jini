/** Pure, bounded memory aggregation and sustained-growth detection; hosts own sampling and consent. */
export interface ProcessMemoryReading { id: number; kind: string; rssBytes: number; heapUsedBytes?: number }
export interface MemoryKindSummary { kind: string; count: number; rssMb: number; heapUsedMb?: number }
interface Point { at: number; rssMb: number }
export interface MemoryGrowthWarning { kind: string; reason: 'rss-limit' | 'sustained-growth'; series: readonly Point[] }
interface MemoryGrowthDetector {
  observe(required: { processes: readonly ProcessMemoryReading[] }, options?: Record<string, never>): MemoryGrowthWarning[];
  reset(required?: Record<string, never>, options?: { keepRateLimits?: boolean }): void;
}
const MB = 1_000_000;

/** Aggregate before rounding, deduplicating process IDs; no identity leaves the summary.
 * @returns One row per process kind. @complexity O(p) time and space for p processes.
 */
export function aggregateProcessMemory({ processes }: { processes: readonly ProcessMemoryReading[] }, _options = {}): MemoryKindSummary[] {
  const seen = new Set<number>();
  const groups = new Map<string, { count: number; rss: number; heap?: number }>();
  for (const row of processes) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const group = groups.get(row.kind) ?? { count: 0, rss: 0 };
    group.count++;
    group.rss += row.rssBytes;
    if (row.heapUsedBytes !== undefined) group.heap = (group.heap ?? 0) + row.heapUsedBytes;
    groups.set(row.kind, group);
  }
  return [...groups].map(([kind, group]) => ({ kind, count: group.count, rssMb: Math.round(group.rss / MB),
    ...(group.heap === undefined ? {} : { heapUsedMb: Math.round(group.heap / MB) }) }));
}

/** Lowest reading in [from, to]: one GC drop lowers it, a transient spike never raises it. O(w). */
function floorMb({ series, from, to }: { series: readonly Point[]; from: number; to: number }, _options = {}): number {
  let floor = Infinity;
  for (const point of series) if (point.at >= from && point.at <= to) floor = Math.min(floor, point.rssMb);
  return floor;
}

/** Floors, never raw readings: RSS peaks are mostly uncollected V8 garbage (GC sawtooth), so a GC
 * drop never raises an alarm and a real leak shows as a rising post-GC floor. The limit needs a
 * full floor span above it; growth compares the late floor with the early floor of a full window.
 * @complexity O(w) in bounded window points. No effects.
 */
function growthReason({ series, at, windowMs, floorMs, growthMb, limitMb }: {
  series: readonly Point[]; at: number; windowMs: number; floorMs: number; growthMb: number; limitMb: number;
}, _options = {}): MemoryGrowthWarning['reason'] | undefined {
  const first = series[0]!;
  if (at - first.at < floorMs) return;
  const late = floorMb({ series, from: at - floorMs, to: at });
  if (late > limitMb) return 'rss-limit';
  if (at - first.at < windowMs) return;
  return late - floorMb({ series, from: first.at, to: first.at + floorMs }) >= growthMb ? 'sustained-growth' : undefined;
}

/** Small rolling windows keyed by local process identity. Gone processes are forgotten; kind
 * changes and backwards clocks reset history. Rate limiting is per process, not per process kind.
 * @param required Clock port, injected so tests advance time without waiting.
 * @param options Thresholds and caps. Overflow drops oldest observations; it cannot grow memory.
 * @returns observe and reset, with no sampler, timers, I/O or provider dependencies.
 * @complexity O(p*w) per observation; O(min(p,maxProcesses)*maxSamples) retained state.
 */
export function createMemoryGrowthDetector({ now }: { now: () => number }, {
  windowMs = 60 * 60_000, floorMs = 15 * 60_000, growthMb = 300, limitMb = 2000, rateLimitMs = 24 * 60 * 60_000,
  maxSamples = 64, maxProcesses = 512, maxGapMs = 10 * 60_000,
}: { windowMs?: number; floorMs?: number; growthMb?: number; limitMb?: number; rateLimitMs?: number; maxSamples?: number; maxProcesses?: number; maxGapMs?: number } = {}): MemoryGrowthDetector {
  type History = { kind: string; series: Point[]; warnedAt?: number };
  const histories = new Map<number, History>();
  /** A changed kind or backwards clock cannot join two different process lifetimes. */
  function historyFor({ row, at }: { row: ProcessMemoryReading; at: number }, _options = {}): History {
    const previous = histories.get(row.id);
    const lastAt = previous?.series.at(-1)?.at ?? at;
    if (previous && previous.kind === row.kind) {
      if (at < lastAt || at - lastAt > maxGapMs) previous.series = [];
      return previous;
    }
    const history: History = { kind: row.kind, series: [] };
    histories.set(row.id, history);
    return history;
  }
  /** Retain one predecessor at the window edge so ordinary timer jitter still spans sixty minutes. */
  function append({ history, at, rssBytes }: { history: History; at: number; rssBytes: number }, _options = {}): void {
    history.series.push({ at, rssMb: rssBytes / MB });
    while (history.series.length > 1 && history.series[1]!.at <= at - windowMs) history.series.shift();
    history.series = history.series.slice(-maxSamples);
  }
  return {
    reset(_required: Record<string, never> = {}, { keepRateLimits = false }: { keepRateLimits?: boolean } = {}) {
      if (!keepRateLimits) { histories.clear(); return; }
      for (const history of histories.values()) history.series = [];
    },
    observe({ processes }: { processes: readonly ProcessMemoryReading[] }, _options = {}): MemoryGrowthWarning[] {
      const at = now();
      const selected = [...new Map(processes.map(row => [row.id, row])).values()].slice(0, maxProcesses);
      const live = new Set(selected.map(row => row.id));
      for (const id of histories.keys()) if (!live.has(id)) histories.delete(id);
      const warnings: MemoryGrowthWarning[] = [];
      for (const row of selected) {
        const history = historyFor({ row, at });
        append({ history, at, rssBytes: row.rssBytes });
        const reason = growthReason({ series: history.series, at, windowMs, floorMs, growthMb, limitMb });
        if (!reason || at - (history.warnedAt ?? -Infinity) < rateLimitMs) continue;
        history.warnedAt = at;
        warnings.push({ kind: row.kind, reason, series: history.series.map(point => ({ at: point.at, rssMb: Math.round(point.rssMb) })) });
      }
      return warnings;
    },
  };
}
