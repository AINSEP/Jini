import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
import { createNodeSidecarLauncher } from '../sidecar.js';
import { createTauriSidecarLauncher } from '../tauri/tauri-sidecar.js';
import { createFakeTauriSidecarCommandApi } from '../tauri/testing.js';

async function launch() {
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null, kill: vi.fn() });
  mocks.spawn.mockImplementation(() => {
    Promise.resolve().then(() => child.emit('spawn'));
    return child;
  });
  const handle = await createNodeSidecarLauncher({}).launch({ command: 'fixture' });
  return { child, handle };
}

afterEach(() => {
  vi.useRealTimers();
  mocks.spawn.mockReset();
});

it('C11: sidecars receive SIGTERM and Tauri remembers prior exits for readiness and shutdown', async () => {
  vi.useFakeTimers();
  const { child, handle } = await launch();
  child.kill.mockImplementation((signal: NodeJS.Signals) => {
    queueMicrotask(() => {
      Object.assign(child, { signalCode: signal });
      child.emit('exit', null, signal);
    });
    return true;
  });
  const nodeShutdown = handle.shutdown({}, { gracefulTimeoutMs: 20 });
  await vi.advanceTimersByTimeAsync(50);
  await nodeShutdown;
  expect.soft(child.kill.mock.calls).toEqual([['SIGTERM']]);

  const api = createFakeTauriSidecarCommandApi({});
  const tauri = await createTauriSidecarLauncher({ api }).launch({ command: 'fixture' });
  const signals: Array<NodeJS.Signals | null> = [];
  tauri.process.onExit({ listener: ({ signal }) => signals.push(signal) });
  const tauriShutdown = tauri.shutdown({}, { gracefulTimeoutMs: 20 });
  await vi.advanceTimersByTimeAsync(50);
  await tauriShutdown;
  expect.soft(signals).toEqual(['SIGTERM']);

  // Deliver the one-shot exit before waitUntilReady can subscribe to it.
  const crashedApi = createFakeTauriSidecarCommandApi({}, { exitImmediatelyWithCode: 7 });
  const crashed = await createTauriSidecarLauncher({ api: crashedApi }).launch({ command: 'fixture' });
  const exited = new Promise<void>(resolve => crashed.process.onExit({ listener: () => resolve() }));
  await vi.advanceTimersByTimeAsync(0);
  await exited;
  // Tauri polls with node:timers/promises; use its real clock and a short deadline.
  vi.useRealTimers();
  await expect.soft(crashed.waitUntilReady({
    probe: async () => false,
    isReady: ({ status }) => status,
  }, { pollIntervalMs: 1, timeoutMs: 20 })).rejects.toThrow(
    'sidecar exited before reporting ready (code=7, signal=none)',
  );

  vi.useFakeTimers();
  let shutdownComplete = false;
  const crashedShutdown = crashed.shutdown({}, { gracefulTimeoutMs: 20 }).then(() => {
    shutdownComplete = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect.soft(shutdownComplete).toBe(true);
  await vi.advanceTimersByTimeAsync(50);
  await crashedShutdown;
});

it('rejects a hanging probe at the readiness deadline and removes the exit listener', async () => {
  vi.useFakeTimers();
  const { child, handle } = await launch();
  const probe = vi.fn(() => new Promise<never>(() => {}));
  const pending = handle.waitUntilReady({ probe, isReady: () => true }, { timeoutMs: 80 });
  const rejected = expect(pending).rejects.toThrow('timed out waiting for sidecar to become ready');
  await vi.advanceTimersByTimeAsync(80);
  await rejected;
  expect(probe).toHaveBeenCalledOnce();
  expect(child.listenerCount('exit')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects a hanging probe immediately on process exit, including the log-free diagnostic', async () => {
  vi.useFakeTimers();
  const { child, handle } = await launch();
  const pending = handle.waitUntilReady({ probe: () => new Promise<never>(() => {}), isReady: () => true });
  const rejected = expect(pending).rejects.toThrow('sidecar exited before reporting ready (code=3, signal=none)');
  child.emit('exit', 3, null);
  await rejected;
  expect(child.listenerCount('exit')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('races exit during the poll delay and does not probe again', async () => {
  vi.useFakeTimers();
  const { child, handle } = await launch();
  const probe = vi.fn(async () => false);
  const pending = handle.waitUntilReady({ probe, isReady: ({ status }) => status }, { pollIntervalMs: 10_000 });
  const rejected = expect(pending).rejects.toThrow('sidecar exited before reporting ready');
  await vi.advanceTimersByTimeAsync(0);
  child.emit('exit', null, 'SIGTERM');
  await rejected;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(probe).toHaveBeenCalledOnce();
  expect(child.listenerCount('exit')).toBe(0);
});

it('does not accept a late probe result after timeout or call the readiness predicate', async () => {
  vi.useFakeTimers();
  const { child, handle } = await launch();
  let resolveProbe!: (value: boolean) => void;
  const isReady = vi.fn(({ status }: { status: boolean }) => status);
  const pending = handle.waitUntilReady({
    probe: () => new Promise<boolean>(resolve => { resolveProbe = resolve; }), isReady,
  }, { timeoutMs: 40 });
  const rejected = expect(pending).rejects.toThrow('timed out waiting');
  await vi.advanceTimersByTimeAsync(40);
  await rejected;
  resolveProbe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(isReady).not.toHaveBeenCalled();
  expect(child.listenerCount('exit')).toBe(0);
});
