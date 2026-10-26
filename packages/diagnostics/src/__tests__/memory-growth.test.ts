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

test('fake clock: a +300 MB rise of the post-GC floor requires a full sixty minutes', () => {
  let at = 0;
  const detector = createMemoryGrowthDetector({ now: () => at });
  for (let i = 0; i < 12; i++) {
    at = i * 5 * MINUTE;
    expect(detector.observe({ processes: [row(1, 1000 + i * 34)] })).toEqual([]);
  }
  at = 60 * MINUTE;
  const result = detector.observe({ processes: [row(1, 1408)] });
  expect(result).toEqual([{ kind: 'renderer', reason: 'sustained-growth', series:
    Array.from({ length: 13 }, (_, i) => ({ at: i * 5 * MINUTE, rssMb: 1000 + i * 34 })) }]);
  expect(JSON.stringify(result)).not.toContain('"id"');
});

test('a leak under a GC sawtooth still warns: drops lower the floor, they do not erase the rise', () => {
  let at = 0;
  const detector = createMemoryGrowthDetector({ now: () => at });
  let result: ReturnType<typeof detector.observe> = [];
  for (let i = 0; i <= 12; i++) {
    at = i * 5 * MINUTE;
    result = detector.observe({ processes: [row(1, 1000 + i * 34 + (i % 2 ? 200 : 0))] });
    if (i < 12) expect(result).toEqual([]);
  }
  expect(result.map(warning => warning.reason)).toEqual(['sustained-growth']);
});

test('GC sawtooth peaks, a single spike, insufficient floor growth, a gap or a backwards clock never warn', () => {
  const rssAt: Record<string, (i: number) => number> = {
    // Peaks climb past +300 MB and 2 GB, but every third sample is collected back to the floor.
    sawtooth: i => (i % 3 === 2 ? 1000 : 1000 + i * 120),
    spike: i => (i === 12 ? 2500 : 1000),
    below: i => 1000 + i * 33,
    gap: i => 1000 + i * 34,
    backwards: i => 1000 + i * 34,
  };
  for (const [scenario, rss] of Object.entries(rssAt)) {
    let at = 0;
    const detector = createMemoryGrowthDetector({ now: () => at });
    for (let i = 0; i <= 12; i++) {
      if (scenario === 'gap' && i > 0 && i < 12) continue;
      at = scenario === 'backwards' && i === 12 ? MINUTE : i * 5 * MINUTE;
      expect(detector.observe({ processes: [row(1, rss(i))] }), scenario).toEqual([]);
    }
  }
});

test('the 2 GB limit needs a fifteen-minute floor strictly above it; rate limit lasts 24 hours and survives history resets', () => {
  let at = 0;
  const detector = createMemoryGrowthDetector({ now: () => at });
  const observe = (minute: number, rssMb: number, ids = [1]) => {
    at = minute * MINUTE;
    return detector.observe({ processes: ids.map(id => row(id, rssMb)) });
  };
  for (const minute of [0, 5, 10]) expect(observe(minute, 2400)).toEqual([]);
  expect(observe(15, 2000.1)).toEqual([{ kind: 'renderer', reason: 'rss-limit', series: [
    { at: 0, rssMb: 2400 }, { at: 5 * MINUTE, rssMb: 2400 }, { at: 10 * MINUTE, rssMb: 2400 }, { at: 15 * MINUTE, rssMb: 2000 },
  ] }]);
  expect(observe(20, 2400)).toEqual([]);
  detector.reset({}, { keepRateLimits: true });
  const day = DAY / MINUTE;
  for (const minute of [day - 5, day, day + 5, day + 10]) expect(observe(minute, 2400)).toEqual([]);
  expect(observe(day + 15, 2400).map(value => value.reason)).toEqual(['rss-limit']);
  detector.reset();
  for (const minute of [day + 20, day + 25, day + 30]) expect(observe(minute, 2400)).toEqual([]);
  expect(observe(day + 35, 2400)).toHaveLength(1);
  const exact = createMemoryGrowthDetector({ now: () => at });
  for (const minute of [0, 5, 10, 15]) { at = minute * MINUTE; expect(exact.observe({ processes: [row(1, 2000)] })).toEqual([]); }
});

test('kind changes/gone processes reset histories; duplicate IDs and changing fleets stay bounded', () => {
  let at = 0;
  const detector = createMemoryGrowthDetector({ now: () => at }, { maxSamples: 3, maxProcesses: 2, floorMs: 0 });
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
