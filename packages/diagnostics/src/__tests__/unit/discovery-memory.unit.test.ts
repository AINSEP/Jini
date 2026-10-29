import { expect, it } from 'vitest';
import { discoveryFilesystem } from '../l170-filesystem.fake.js';
import { aggregateProcessMemory } from '../../memory-growth.js';

it('discovery fake refuses content reads and distinguishes missing entries from injected I/O failures', async () => {
  const failure = new Error('disk unavailable');
  const fake = discoveryFilesystem({ directories: { '/fault': failure }, stats: { '/fault': failure } });
  await expect(fake.readFile({ absolutePath: '/anything' })).rejects.toThrow('Discovery must not read file contents');
  await expect(fake.readDirectory({ absolutePath: '/missing' })).rejects.toThrow('Missing directory: /missing');
  await expect(fake.stat({ absolutePath: '/missing' })).rejects.toThrow('Missing file: /missing');
  await expect(fake.readDirectory({ absolutePath: '/fault' })).rejects.toBe(failure);
  await expect(fake.stat({ absolutePath: '/fault' })).rejects.toBe(failure);
});

it('aggregates partial heap observations before rounding and ignores duplicate process samples', () => {
  expect(aggregateProcessMemory({ processes: [
    { id: 1, kind: 'worker', rssBytes: 400_000 },
    { id: 2, kind: 'worker', rssBytes: 400_000, heapUsedBytes: 400_000 },
    { id: 3, kind: 'worker', rssBytes: 400_000, heapUsedBytes: 400_000 },
    { id: 2, kind: 'worker', rssBytes: 9_000_000, heapUsedBytes: 9_000_000 },
  ] })).toEqual([{ kind: 'worker', count: 3, rssMb: 1, heapUsedMb: 1 }]);
});
