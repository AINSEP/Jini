import { afterEach, expect, it, vi } from 'vitest';
import { handleToolCall } from '../../tool-protocol.js';
import { waitTool } from '../wait.js';

const ctx = { baseUrl: 'http://unused', fetchImpl: fetch };
afterEach(() => vi.useRealTimers());

it('waiting before another generation poll takes the requested time without Bash', async () => {
  vi.useFakeTimers();
  let finished = false;
  const pending = handleToolCall({ name: 'wait_for', tools: new Map([['wait_for', waitTool]]), ctx },
    { rawArgs: { seconds: 5 } }).then(result => { finished = true; return result; });
  await vi.advanceTimersByTimeAsync(4999);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toEqual({ content: [{ type: 'text', text: '{"waitedSeconds":5}' }] });
  expect(vi.getTimerCount()).toBe(0);
});

it.each([-1, 61, 'soon', Infinity])('a bad wait duration %s is refused before a timer starts', async seconds => {
  vi.useFakeTimers();
  const result = await handleToolCall({ name: 'wait_for', tools: new Map([['wait_for', waitTool]]), ctx },
    { rawArgs: { seconds } });
  expect(result.isError).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancelling a generation wait stops its timer immediately', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const pending = handleToolCall({ name: 'wait_for', tools: new Map([['wait_for', waitTool]]),
    ctx: { ...ctx, signal: controller.signal } }, { rawArgs: { seconds: 30 } });
  controller.abort();
  expect((await pending).isError).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
