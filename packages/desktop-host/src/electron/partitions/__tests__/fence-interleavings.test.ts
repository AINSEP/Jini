/**
 * T-2a.13: exhaustive check of the Dekker fence over the real interlock code. The four fence steps
 * (acquirer publishes intent, acquirer reads target; writer publishes target, writer reads the
 * acquirer's holder record) are gated and released in every order that respects each side's
 * program order. In every schedule either one side observes the other, or the writer's critical
 * section ended before the acquirer read the target (no overlap to observe).
 */
import path from 'node:path';
import { expect, it } from 'vitest';
import { createPartitionInterlock } from '../index.js';
import { FakeClock, FakeScheduler, MemoryFs, MemoryLock, MESSAGES } from './fakes.js';

const P = 'persist:site-0123456789abcdef0123456789abcdef';
const DIR = 'site-0123456789abcdef0123456789abcdef';
const ACQUIRER = ['A:rename:2-2ab.json', 'A:read:target.json'];
const WRITER = ['W:rename:target.json', 'W:read:2-2ab.json'];

function schedules(a: string[], b: string[]): string[][] {
  if (a.length === 0) return [b];
  if (b.length === 0) return [a];
  return [
    ...schedules(a.slice(1), b).map(rest => [a[0]!, ...rest]),
    ...schedules(a, b.slice(1)).map(rest => [b[0]!, ...rest]),
  ];
}

function interlockFor(fs: MemoryFs, lock: MemoryLock, clock: FakeClock, scheduler: FakeScheduler, pid: number) {
  return createPartitionInterlock({
    paths: { interlockDir: '/profile/partition-interlock', sessionDataDir: '/profile/session' },
    fs, lock, clock, scheduler,
    process: { pid, bootId: 'boot', hostname: 'host', isAlive: () => true, newToken: () => `${pid}ab` },
    fromPartition: ({ partition }) => partition,
    isManaged: name => name.startsWith('site-'),
    claimSources: { partitions: [], instances: [] },
    invalidateRetirement: async () => {},
    openMaintenance: async () => {},
    messages: MESSAGES,
    log: () => {},
  });
}

interface Outcome { acquirerWaited: boolean; writerSawIntent: boolean; writerEndedFirst: boolean }
async function runSchedule(order: string[]): Promise<Outcome> {
  const fs = new MemoryFs(), clock = new FakeClock(), scheduler = new FakeScheduler(clock);
  const lock = new MemoryLock(clock, scheduler);
  const waiting = new Map<string, () => void>(), passed = new Set<string>();
  let acquirerTargetReads = 0, tick = 0, acquirerReadAt = 0, writerEndAt = Number.POSITIVE_INFINITY;
  const view = (actor: string): MemoryFs => {
    const actorFs = Object.create(fs) as MemoryFs;
    actorFs.gate = async (op, target) => {
      const key = `${actor}:${op}:${path.basename(target)}`;
      if (key === 'A:read:target.json') acquirerTargetReads += 1;
      if (!order.includes(key) || passed.has(key)) return;
      passed.add(key);
      await new Promise<void>(resolve => waiting.set(key, resolve));
      if (key === 'A:read:target.json') acquirerReadAt = ++tick;
    };
    return actorFs;
  };
  const writer = interlockFor(view('W'), lock, clock, scheduler, 1);
  const acquirer = interlockFor(view('A'), lock, clock, scheduler, 2);
  writer.registerHolder(); acquirer.registerHolder();
  let writerSawIntent = false;
  const pass = writer.withPartitionWriter({ run: async ({ readClaims }) => {
    const claims = await readClaims();
    writerSawIntent = claims.state !== 'ok' || claims.claimed.includes(DIR);
    writerEndAt = ++tick;
  } });
  const open = acquirer.acquireSiteSession({ partition: P, subjectDir: '/site' });
  for (const key of order) {
    for (let i = 0; i < 2000 && !waiting.has(key); i += 1) await new Promise<void>(r => setImmediate(r));
    const release = waiting.get(key);
    if (!release) throw new Error(`step ${key} never reached in ${order.join(' > ')}`);
    waiting.delete(key); release();
  }
  await Promise.all([pass, open]);
  return { acquirerWaited: acquirerTargetReads > 1, writerSawIntent, writerEndedFirst: writerEndAt < acquirerReadAt };
}

it('T-2a.13 interleavings: every schedule of the four fence steps is mutually observed', async () => {
  const all = schedules(ACQUIRER, WRITER);
  expect(all).toHaveLength(6);
  for (const order of all) {
    const outcome = await runSchedule(order);
    // Overlap is never silent: a writer still inside its section when the target was read was seen.
    if (!outcome.writerEndedFirst) expect(outcome.acquirerWaited || outcome.writerSawIntent, order.join(' > ')).toBe(true);
  }
});
