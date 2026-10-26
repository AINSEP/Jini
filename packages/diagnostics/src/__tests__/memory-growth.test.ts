import { expect, test } from 'vitest';
import { aggregateProcessMemory, createMemoryGrowthDetector } from '../memory-growth.js';
import { createTracker } from '../observability/node.js';
import { createNoopObservabilityPort } from '../observability/noop.js';
import type { ErrorReport } from '../observability/ports.js';

const MB = 1_000_000, MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const row = (id: number, rssMb: number, kind = 'renderer') => ({ id, kind, rssBytes: rssMb * MB });

test('warning severity survives the existing tracker/dedupe facade without altering default error context', () => {
  const reports: ErrorReport[] = [];
  const tracker = createTracker({ observability: { ...createNoopObservabilityPort({}), reportError: report => { reports.push(report); } } });
  const warning = new Error('memory growth');
  tracker.error(warning, { operation: 'process.memory_growth', level: 'warning' });
  tracker.error(warning, { operation: 'process.memory_growth', level: 'warning' });
  tracker.error(new Error('ordinary'), { operation: 'ordinary' });
  expect(reports.map(report => report.context)).toEqual([
    { operation: 'process.memory_growth', level: 'warning' }, { operation: 'ordinary' },
  ]);
});

test('aggregation deduplicates pids, rounds after summing, groups by kind, and omits unavailable heap', () => {
  expect(aggregateProcessMemory({ processes: [
    { ...row(1, 10.4, 'main'), heapUsedBytes: 2.6 * MB }, row(2, 20.4), row(3, 30.4), row(2, 999),
    row(4, 40, 'server'), row(5, 50, 'daemon'),
  ] })).toEqual([
    { kind: 'main', count: 1, rssMb: 10, heapUsedMb: 3 }, { kind: 'renderer', count: 2, rssMb: 51 },
    { kind: 'server', count: 1, rssMb: 40 }, { kind: 'daemon', count: 1, rssMb: 50 },
  ]);
  expect(aggregateProcessMemory({ processes: [] })).toEqual([]);
});

test('fake clock: sustained +300 MB requires a full sixty minutes, no drop and sufficient observations', () => {
  let at = 0;
  const detector = createMemoryGrowthDetector({ now: () => at });
  for (let i = 0; i < 12; i++) {
    at = i * 5 * MINUTE;
    expect(detector.observe({ processes: [row(1, 1000 + i * 25)] })).toEqual([]);
  }
  at = 60 * MINUTE;
  const result = detector.observe({ processes: [row(1, 1300)] });
  expect(result).toEqual([{ kind: 'renderer', reason: 'sustained-growth', series:
    Array.from({ length: 13 }, (_, i) => ({ at: i * 5 * MINUTE, rssMb: 1000 + i * 25 })) }]);
  expect(JSON.stringify(result)).not.toContain('"id"');
});

test('a drop, insufficient growth, observation gap, or backwards clock cannot manufacture a steady slope', () => {
  for (const scenario of ['drop', 'below', 'gap', 'backwards']) {
    let at = 0;
    const detector = createMemoryGrowthDetector({ now: () => at });
    for (let i = 0; i <= 12; i++) {
      at = i * 5 * MINUTE;
      if (scenario === 'gap' && i > 0 && i < 12) continue;
      if (scenario === 'backwards' && i === 12) at = MINUTE;
      let rss = 1000 + i * 25;
      if (scenario === 'drop' && i === 6) rss = 1100;
      if (scenario === 'below') rss = 1000 + i * 24;
      expect(detector.observe({ processes: [row(1, rss)] }), scenario).toEqual([]);
    }
  }
});

test('RSS strictly above 2 GB warns immediately; per-process rate limit lasts 24 hours and survives history resets', () => {
  let at = 0;
  const detector = createMemoryGrowthDetector({ now: () => at });
  expect(detector.observe({ processes: [row(1, 2000)] })).toEqual([]);
  expect(detector.observe({ processes: [row(1, 2000.1)] })).toEqual([
    { kind: 'renderer', reason: 'rss-limit', series: [{ at: 0, rssMb: 2000 }, { at: 0, rssMb: 2000 }] },
  ]);
  at = MINUTE;
  expect(detector.observe({ processes: [row(1, 2400), row(2, 2400)] })).toHaveLength(1);
  detector.reset({}, { keepRateLimits: true });
  at = DAY - 1;
  expect(detector.observe({ processes: [row(1, 2400), row(2, 2400)] })).toEqual([]);
  at = DAY;
  expect(detector.observe({ processes: [row(1, 2400), row(2, 2400)] }).map(value => value.kind)).toEqual(['renderer']);
  detector.reset();
  expect(detector.observe({ processes: [row(1, 2400)] })).toHaveLength(1);
});

test('kind changes/gone processes reset histories; duplicate IDs and changing fleets stay bounded', () => {
  let at = 0;
  const detector = createMemoryGrowthDetector({ now: () => at }, { maxSamples: 3, maxProcesses: 2 });
  expect(detector.observe({ processes: [row(1, 2400), row(1, 2400), row(2, 2400), row(3, 2400)] })).toHaveLength(2);
  detector.observe({ processes: [] });
  expect(detector.observe({ processes: [row(1, 2400, 'main')] })[0]!.kind).toBe('main');
  for (let i = 1; i <= 10; i++) {
    at += 5 * MINUTE;
    detector.observe({ processes: [row(1, 1000 + i), row(2, 1000 + i)] });
  }
  at += 5 * MINUTE;
  const warnings = detector.observe({ processes: [row(1, 2400, 'server'), row(2, 2400), row(3, 2400)] });
  expect(warnings).toHaveLength(2);
  expect(warnings[1]!.series).toHaveLength(3);
  expect(warnings[1]!.series[0]!.at).toBe(45 * MINUTE);
});
