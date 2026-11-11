/**
 * @file `clock.sleep` forwards the requested delay to `node:timers/promises` and settles only when that
 * timer does. Controlled timer, no wall-clock threshold: the old `elapsed >= 15 ms` check also passed a
 * shortened timer whenever the test resumed late (FU-B, Codex on F5).
 */
import { expect, test, vi } from 'vitest';

let release: () => void = () => {};
const setTimeoutFake = vi.fn((_ms: number) => new Promise<void>((resolve) => { release = resolve; }));
vi.mock('node:timers/promises', () => ({ setTimeout: (ms: number) => setTimeoutFake(ms) }));

const { createNodeAgentPluginEffects } = await import('../../node.js');

test('sleep forwards exactly the requested delay and resolves only when the timer settles', async () => {
  let settled = false;
  const sleeping = createNodeAgentPluginEffects({}).clock.sleep({ ms: 20 }).then((value) => { settled = true; return value; });
  expect(setTimeoutFake).toHaveBeenCalledTimes(1);
  expect(setTimeoutFake).toHaveBeenCalledWith(20);
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await expect(sleeping).resolves.toBeUndefined();
  expect(settled).toBe(true);
});
