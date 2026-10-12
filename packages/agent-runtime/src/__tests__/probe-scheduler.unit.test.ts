import { expect, it } from 'vitest';
import { createProbeScheduler } from '../probe-scheduler.js';

it('runs at most one process across probe categories and prioritizes queued version checks', async () => {
  const schedule = createProbeScheduler({});
  let finish!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  let active = 0; let peak = 0;
  const order: string[] = [];
  const work = (name: string, wait = Promise.resolve()) => async () => {
    order.push(name); peak = Math.max(peak, ++active); await wait; active--;
  };
  const first = schedule({ work: work('models', blocked) });
  await Promise.resolve();
  const help = schedule({ work: work('help') });
  const version = schedule({ work: work('version') }, { priority: 'version' });
  finish();
  await Promise.all([first, help, version]);
  expect(peak).toBe(1);
  expect(order).toEqual(['models', 'version', 'help']);
});

it('a failed process releases the slot and an aborted queued probe never spawns', async () => {
  const schedule = createProbeScheduler({});
  let finish!: () => void;
  const first = schedule({ work: () => new Promise<void>(resolve => { finish = resolve; }) });
  await Promise.resolve();
  const controller = new AbortController(); let calls = 0;
  const queued = schedule({ work: async () => { calls++; } }, { signal: controller.signal });
  controller.abort(); finish();
  await first;
  await expect(queued).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(schedule({ work: async () => { throw new Error('failure'); } })).rejects.toThrow('failure');
  expect(await schedule({ work: async () => 'recovered' })).toBe('recovered');
});
