/** Memory subset of Electron's app.getAppMetrics(); native values are in KiB. */
export interface ElectronProcessMemory {
  pid: number;
  memory: { privateBytes?: number; workingSetSize: number };
}

/** Replace OS RSS for Electron-owned PIDs with native private memory where available.
 * Non-Electron children (including Electron-as-node) retain OS RSS. macOS/Linux do not expose
 * privateBytes here, so their working set remains a resident-memory estimate. The rssBytes
 * field is retained for wire compatibility; it now carries this mixed memory estimate.
 * @returns New rows, preserving every other sampler field. No native calls or input mutation.
 * @complexity O(p+e) time/O(p+e) space for p sampled and e Electron processes.
 */
export function applyElectronMemoryReadings<T extends { pid: number; rssBytes: number }>(
  { processes, electronMetrics }: { processes: readonly T[]; electronMetrics: readonly ElectronProcessMemory[] },
  _options = {},
): T[] {
  const memory = new Map(electronMetrics.map(({ pid, memory }) => [pid, (memory.privateBytes ?? memory.workingSetSize) * 1024]));
  return processes.map(row => ({ ...row, rssBytes: memory.get(row.pid) ?? row.rssBytes }));
}
