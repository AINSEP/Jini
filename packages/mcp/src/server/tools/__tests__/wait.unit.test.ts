import { expect, it } from 'vitest';
import { handleToolCall } from '../../tool-protocol.js';
import { waitTool } from '../wait.js';

const ctx = { baseUrl: 'http://unused', fetchImpl: fetch };

it('waiting before another generation poll takes the requested time without Bash', async () => {
  // Vitest's global fake timers do not drive node:timers/promises. Exercise the native
  // timer with a short duration rather than freezing a five-second wait at its test deadline.
  const seconds = 0.025;
  const started = performance.now();
  let finished = false;
  const pending = handleToolCall({ name: 'wait_for', tools: new Map([['wait_for', waitTool]]), ctx },
    { rawArgs: { seconds } }).then(result => { finished = true; return result; });
  expect(finished).toBe(false);
  expect(await pending).toEqual({ content: [{ type: 'text', text: '{"waitedSeconds":0.025}' }] });
  expect(performance.now() - started).toBeGreaterThanOrEqual(24);
});

it.each([-1, 61, 'soon', Infinity])('a bad wait duration %s is refused before a timer starts', async seconds => {
  const result = await handleToolCall({ name: 'wait_for', tools: new Map([['wait_for', waitTool]]), ctx },
    { rawArgs: { seconds } });
  expect(result.isError).toBe(true);
});

it('cancelling a generation wait stops its timer immediately', async () => {
  const controller = new AbortController();
  const pending = handleToolCall({ name: 'wait_for', tools: new Map([['wait_for', waitTool]]),
    ctx: { ...ctx, signal: controller.signal } }, { rawArgs: { seconds: 30 } });
  controller.abort();
  expect((await pending).isError).toBe(true);
});
