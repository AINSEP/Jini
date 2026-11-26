import { expect, test } from 'vitest';
import type { ResourceProcess } from '@jini-ai/core/contracts/site/contracts-resources';
import { groupMemoryMetric, readDesktopMemory } from '../memory-sampler.js';

const usages = [
  { pid: 1, ppid: 0, rssBytes: 900, cpuSeconds: 2, name: 'app' },
  { pid: 2, ppid: 1, rssBytes: 700, cpuSeconds: 3, name: 'child' },
];

test('a partial native read keeps the missing PID and its RSS fallback', async () => {
  const rows = await readDesktopMemory({ usages, platform: 'darwin', electronMetrics: [],
    samplePrivateMemory: async () => ({ metric: 'physical-footprint', readings: [{ pid: 1, bytes: 400 }] }),
  });
  expect(rows).toEqual([
    { ...usages[0], rssBytes: 400, rawRssBytes: 900, memoryMetric: 'physical-footprint' },
    { ...usages[1], rawRssBytes: 700, memoryMetric: 'rss' },
  ]);
});

test('failed and unavailable native reads preserve every fallback row', async () => {
  const required = { usages, platform: 'linux' as const, electronMetrics: [] };
  const fallback = usages.map(row => ({ ...row, rawRssBytes: row.rssBytes, memoryMetric: 'rss' }));
  expect(await readDesktopMemory({ ...required, samplePrivateMemory: async () => { throw new Error('native read'); } })).toEqual(fallback);
  expect(await readDesktopMemory({ ...required, samplePrivateMemory: async () => ({ metric: 'unavailable', readings: [] }) })).toEqual(fallback);
});

test('zero bytes are a successful native reading', async () => {
  expect(await readDesktopMemory({ usages: usages.slice(0, 1), platform: 'win32', electronMetrics: [],
    samplePrivateMemory: async () => ({ metric: 'private-working-set', readings: [{ pid: 1, bytes: 0 }] }),
  })).toEqual([{ ...usages[0], rssBytes: 0, rawRssBytes: 900, memoryMetric: 'private-working-set' }]);
});

test('Windows uses committed private KiB and retains RSS for other PIDs', async () => {
  expect(await readDesktopMemory({ usages, platform: 'win32', electronMetrics: [
    { pid: 1, memory: { privateBytes: 2, workingSetSize: 9 } },
  ] })).toEqual([
    { ...usages[0], rssBytes: 2048, rawRssBytes: 900, memoryMetric: 'committed' },
    { ...usages[1], rawRssBytes: 700, memoryMetric: 'rss' },
  ]);
});

test('grouping exposes mixed native metrics and any RSS fallback', () => {
  const processes: ResourceProcess[] = usages.map(row => ({ ...row, role: 'process', cpuPercent: null, cpuWarning: false }));
  expect(groupMemoryMetric({ processes: [] })).toBe('rss');
  expect(groupMemoryMetric({ processes })).toBe('rss');
  expect(groupMemoryMetric({ processes: processes.map(row => ({ ...row, memoryMetric: 'physical-footprint' })) })).toBe('physical-footprint');
  expect(groupMemoryMetric({ processes: [{ ...processes[0]!, memoryMetric: 'physical-footprint' }, { ...processes[1]!, memoryMetric: 'committed' }] })).toBe('mixed');
  expect(groupMemoryMetric({ processes: [{ ...processes[0]!, memoryMetric: 'physical-footprint' }, processes[1]!] })).toBe('mixed-rss');
});
