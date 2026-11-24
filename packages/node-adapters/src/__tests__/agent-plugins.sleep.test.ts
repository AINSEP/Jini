/**
 * @file `clock.sleep` forwards the requested delay to `node:timers/promises` and settles only when that
 * timer does. Controlled timer, no wall-clock threshold: the old `elapsed >= 15 ms` check also passed a
 * shortened timer whenever the test resumed late (FU-B, Codex on F5).
 */
import { expect, test, vi } from 'vitest';

let release: () => void = () => {};
const setTimeoutFake = vi.fn((..._args: unknown[]) => new Promise<void>((resolve) => { release = resolve; }));
vi.mock('node:timers/promises', () => ({ setTimeout: (...args: unknown[]) => setTimeoutFake(...args) }));

const { createNodeAgentPluginEffects } = await import('../agent-plugins.js');
/** Inert platform fakes: only the clock is under test, and the real platform would load the mocked timers module. */
const platform = { withFileLock: vi.fn(), writeJsonFileAtomicAsync: vi.fn(), readBootIdentity: vi.fn(() => undefined) };

test('sleep forwards exactly the requested delay and resolves only when the timer settles', async () => {
  let settled = false;
  const sleeping = createNodeAgentPluginEffects(platform).clock.sleep({ ms: 20 }).then((value) => { settled = true; return value; });
  expect(setTimeoutFake).toHaveBeenCalledTimes(1);
  expect(setTimeoutFake).toHaveBeenCalledWith(20);
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await expect(sleeping).resolves.toBeUndefined();
  expect(settled).toBe(true);
});

test('sleepInBackground is an unref\'d timer: a pending background recovery retry never holds the process open', () => {
  setTimeoutFake.mockClear();
  void createNodeAgentPluginEffects(platform).clock.sleepInBackground?.({ ms: 5_000 });
  expect(setTimeoutFake).toHaveBeenCalledTimes(1);
  expect(setTimeoutFake).toHaveBeenCalledWith(5_000, undefined, { ref: false });
});
