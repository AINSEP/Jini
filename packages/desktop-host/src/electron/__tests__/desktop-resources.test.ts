import { expect, it, vi } from 'vitest';
import { groupMemoryMetric, readDesktopMemory } from '../memory-sampler.js';

it('reads native memory once and retains raw RSS and mixed-rss for invalid or missing readings', async () => {
  for (const readings of [[{ pid: 1, bytes: 10 }, { pid: 2, bytes: -1 }], [{ pid: 1, bytes: 10 }]]) {
    const samplePrivateMemory = vi.fn(async () => ({ metric: 'physical-footprint' as const, readings }));
    const usages = [1, 2].map(pid => ({ pid, ppid: 0, name: '', cpuSeconds: 0, rssBytes: pid * 100 }));
    const result = await readDesktopMemory({ usages, platform: 'darwin', electronMetrics: [], samplePrivateMemory });
    expect(samplePrivateMemory.mock.calls).toEqual([[{ pids: [1, 2] }]]);
    expect(result.map(({ rssBytes, rawRssBytes, memoryMetric }) => ({ rssBytes, rawRssBytes, memoryMetric }))).toEqual([
      { rssBytes: 10, rawRssBytes: 100, memoryMetric: 'physical-footprint' },
      { rssBytes: 200, rawRssBytes: 200, memoryMetric: 'rss' },
    ]);
    expect(groupMemoryMetric({ processes: result.map(row => ({ ...row, name: '', role: 'process' as const, cpuPercent: 0, cpuWarning: false })) })).toBe('mixed-rss');
  }
});
