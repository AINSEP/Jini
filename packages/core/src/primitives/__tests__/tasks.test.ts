import { describe, expect, it } from 'vitest';
import { appendSerialTask } from '../tasks.js';

describe('appendSerialTask', () => {
  it('keeps work ordered across asynchronous and synchronous failures and drains the last task', async () => {
    const events: string[] = [];
    const errors: unknown[] = [];
    const failure = new Error('failed task');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const onError = (error: unknown) => { errors.push(error); };
    let tail = appendSerialTask({ previous: Promise.resolve(), task: async () => {
      events.push('first-start');
      await gate;
      events.push('first-end');
      throw failure;
    }, onError });
    tail = appendSerialTask({ previous: tail, task: () => { throw failure; }, onError });
    tail = appendSerialTask({ previous: tail, task: async () => { events.push('last'); }, onError });
    await Promise.resolve();
    expect(events).toEqual(['first-start']);
    release();
    await tail;
    expect(events).toEqual(['first-start', 'first-end', 'last']);
    expect(errors).toEqual([failure, failure]);
  });
});
