/**
 * @file Display-only desktop resource shapes: which memory metric a sample carries, and one process
 * row. No command lines, credentials or stop-by-pid API. Types only: the host keeps the IPC channel,
 * the sampler and the grouping.
 */

/** Source of the bytes carried by the historical rssBytes wire field. */
export type MemoryMetric = 'physical-footprint' | 'private-working-set' | 'committed' | 'rss' | 'mixed-rss' | 'mixed';

/** Executable basename and tree position only; never OS command arguments. */
export interface ResourceProcess {
  pid: number;
  ppid: number;
  name: string;
  role: 'site-server' | 'daemon' | 'app' | 'process';
  rssBytes: number;
  memoryMetric?: MemoryMetric;
  /** Current OS RSS for safety limits and stable telemetry, independent of display sampling. */
  rawRssBytes?: number;
  cpuPercent: number | null;
  cpuWarning: boolean;
}
