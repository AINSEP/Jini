import { describe, expect, it } from 'vitest';
import { applyElectronMemoryReadings } from '../electron-process-memory.js';

describe('Electron memory estimates', () => {
  it('substitutes private KiB once per PID, preserving RSS for Electron-as-node and other children', () => {
    const processes = [
      { pid: 1, rssBytes: 900_000, name: 'Tovu' },
      { pid: 2, rssBytes: 800_000, name: 'Tovu Helper' },
      { pid: 3, rssBytes: 700_000, name: 'Tovu' },
      { pid: 4, rssBytes: 600_000, name: 'node.exe' },
    ];
    const result = applyElectronMemoryReadings({ processes, electronMetrics: [
      { pid: 1, memory: { privateBytes: 100, workingSetSize: 900 } },
      { pid: 2, memory: { privateBytes: 0, workingSetSize: 800 } },
      { pid: 99, memory: { privateBytes: 9999, workingSetSize: 9999 } },
    ] });
    expect(result.map(row => row.rssBytes)).toEqual([102_400, 0, 700_000, 600_000]);
    expect(result.map(row => row.name)).toEqual(processes.map(row => row.name));
    expect(processes[0]!.rssBytes).toBe(900_000);
  });

  it('uses the native resident estimate on platforms without privateBytes', () => {
    expect(applyElectronMemoryReadings({ processes: [{ pid: 1, rssBytes: 900_000 }],
      electronMetrics: [{ pid: 1, memory: { workingSetSize: 200 } }],
    })).toEqual([{ pid: 1, rssBytes: 204_800 }]);
  });
});
