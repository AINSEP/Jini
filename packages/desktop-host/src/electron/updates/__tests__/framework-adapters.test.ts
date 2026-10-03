import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createAutoUpdateController, createElectronUpdaterAdapter, createNodeUpdateTimers, defaultUpdateMessages } from '../index.js';
import type { ElectronUpdater, LegacyUpdaterLike, UpdateTimersPort, UpdateTimer } from '../index.js';

afterEach(() => { vi.useRealTimers(); });

function nativeUpdater() {
  const emitter = new EventEmitter();
  const installs: Array<[boolean | undefined, boolean | undefined]> = [];
  const checks: number[] = [];
  const updater: ElectronUpdater = {
    autoDownload: false, autoInstallOnAppQuit: true, autoRunAppAfterInstall: true,
    async checkForUpdates() { expect(this).toBe(updater); checks.push(1); return null; },
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) { expect(this).toBe(updater); installs.push([isSilent, isForceRunAfter]); },
    on: emitter.on.bind(emitter),
  };
  return { updater, installs, checks, downloaded: (version: string) => emitter.emit('update-downloaded', { version }), error: (value: Error) => emitter.emit('error', value) };
}

function setup(updater: ElectronUpdater, timers?: UpdateTimersPort) {
  let time = 0;
  const logs: string[] = [];
  const quits: number[] = [];
  const controller = createAutoUpdateController({
    updater, platform: 'darwin', pid: 1, clock: { nowMs: () => time },
    presence: { readLive: () => [{ pid: 1, startedAt: 0, heartbeatAt: time }], write: () => {}, remove: () => {} },
    promptUpdateReady: async () => false, explainOthersOpen: () => {},
    quit: () => { quits.push(1); }, log: ({ message }) => logs.push(message),
  }, timers ? { timers } : {});
  return { controller, logs, quits, setTime: (value: number) => { time = value; } };
}

// REGRESSION: fails if updater.on/quitAndInstall revert to object-wrapped framework callbacks.
it('accepts the raw updater and stages only at the final quit with native booleans', () => {
  vi.useFakeTimers();
  const native = nativeUpdater();
  const host = setup(native.updater);
  expect(native.updater.autoDownload).toBe(true);
  expect(native.updater.autoInstallOnAppQuit).toBe(false);
  native.downloaded('2');
  expect(host.logs).toEqual([defaultUpdateMessages.downloaded({ version: '2' })]);
  expect(native.installs).toEqual([]);
  expect(host.controller.beforeFinalQuit()).toBe(true);
  expect(native.installs).toEqual([[false, false]]);
  native.error(new Error('handoff'));
  expect(host.quits).toEqual([1]);
  host.controller.willQuit();
  expect(vi.getTimerCount()).toBe(0);
});

// REGRESSION: fails if timing defaults stop matching the reference desktop policy.
it('defaults to 30s launch, 15m ticks and a 2m staging fallback', () => {
  const scheduled: Array<{ callback: () => void; ms: number }> = [];
  const cleared: UpdateTimer[] = [];
  const timers: UpdateTimersPort = {
    setTimeout(args) { scheduled.push(args); return {}; },
    setInterval(args) { scheduled.push(args); return {}; },
    clear({ timer }) { cleared.push(timer); },
  };
  const native = nativeUpdater();
  const host = setup(native.updater, timers);
  host.controller.start();
  expect(scheduled.map(({ ms }) => ms)).toEqual([30_000, 900_000]);
  native.downloaded('3');
  host.controller.beforeFinalQuit();
  expect(scheduled.map(({ ms }) => ms)).toEqual([30_000, 900_000, 120_000]);
  scheduled[2]?.callback();
  expect(host.quits).toEqual([1]);
  host.controller.willQuit();
  expect(cleared).toHaveLength(3);
});

// REGRESSION: fails if the Node adapter does not cancel both timeout and interval handles.
it('supplies real Node timers with unref and complete cancellation', () => {
  vi.useFakeTimers();
  const timers = createNodeUpdateTimers();
  const fired = vi.fn();
  const once = timers.setTimeout({ callback: fired, ms: 10 });
  const every = timers.setInterval({ callback: fired, ms: 20 });
  expect(typeof once.unref).toBe('function');
  expect(typeof every.unref).toBe('function');
  timers.clear({ timer: once }); timers.clear({ timer: every });
  vi.advanceTimersByTime(100);
  expect(fired).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

// REGRESSION: fails if the updater adapter snapshots mutable updater properties.
it('forwards properties and retains the native updater receiver', async () => {
  const native = nativeUpdater();
  const adapted = createElectronUpdaterAdapter({ updater: native.updater });
  adapted.autoDownload = true;
  expect(native.updater.autoDownload).toBe(true);
  native.updater.autoRunAppAfterInstall = false;
  expect(adapted.autoRunAppAfterInstall).toBe(false);
  await adapted.checkForUpdates();
  expect(native.checks).toEqual([1]);
  adapted.quitAndInstall(true, true);
  expect(native.installs).toEqual([[true, true]]);
  let version = '';
  adapted.on('update-downloaded', info => { version = info.version; });
  native.downloaded('forwarded');
  expect(version).toBe('forwarded');
});

// REGRESSION: fails if the default check interval stops being four hours.
it('keeps owner checks four hours apart by default', async () => {
  vi.useFakeTimers();
  const native = nativeUpdater();
  const host = setup(native.updater);
  host.controller.tick();
  await vi.advanceTimersByTimeAsync(0);
  host.setTime(14_399_999); host.controller.tick();
  expect(native.checks).toHaveLength(1);
  host.setTime(14_400_000); host.controller.tick();
  expect(native.checks).toHaveLength(2);
  host.controller.willQuit();
});

// REGRESSION: fails if default staleMs stops tolerating exactly three missed 15-minute ticks.
it('elects a new owner only after the default 45-minute stale boundary', () => {
  const native = nativeUpdater();
  let time = 0;
  const controller = createAutoUpdateController({
    updater: native.updater, platform: 'darwin', pid: 1, clock: { nowMs: () => time },
    presence: { readLive: () => [{ pid: 1, startedAt: 0, heartbeatAt: time }, { pid: 2, startedAt: -1, heartbeatAt: 0 }], write: () => {}, remove: () => {} },
    promptUpdateReady: async () => false, explainOthersOpen: () => {}, quit: () => {}, log: () => {},
  });
  time = 2_700_000; controller.tick();
  expect(native.checks).toHaveLength(0);
  time += 1; controller.tick();
  expect(native.checks).toHaveLength(1);
  controller.willQuit();
});

// REGRESSION: fails if parameter-two messages are ignored in favor of defaultUpdateMessages.
it('uses the complete host message object', () => {
  const native = nativeUpdater();
  const logs: string[] = [];
  const controller = createAutoUpdateController({
    updater: native.updater, platform: 'darwin', pid: 1, clock: { nowMs: () => 0 },
    presence: { readLive: () => [], write: () => {}, remove: () => {} },
    promptUpdateReady: async () => false, explainOthersOpen: () => {}, quit: () => {}, log: ({ message }) => logs.push(message),
  }, { messages: {
    downloaded: ({ version }) => 'host ready ' + version,
    error: ({ message }) => 'host error ' + message,
    promptFailed: ({ message }) => 'host prompt ' + message,
    checkFailed: ({ message }) => 'host check ' + message,
    presenceWriteFailed: ({ message }) => 'host presence ' + message,
  } });
  native.downloaded('7'); native.error(new Error('offline'));
  expect(logs).toEqual(['host ready 7', 'host error offline']);
  controller.willQuit();
});

// PARITY: the complete legacy object ABI and now callback remain accepted during host migration.
it('retains the existing updater registration and clock callback shape', () => {
  let downloaded: ((value: { payload: { version: string } }) => void) | undefined;
  const calls: Array<{ isSilent?: boolean; isForceRunAfter?: boolean }> = [];
  const updater = {
    autoDownload: false, autoInstallOnAppQuit: true, autoRunAppAfterInstall: true,
    checkForUpdates: async () => null,
    quitAndInstall(_required: Record<string, never>, options: { isSilent?: boolean; isForceRunAfter?: boolean } = {}) { calls.push(options); },
    on(input: { event: 'update-downloaded'; listener: (value: { payload: { version: string } }) => void } | { event: 'error'; listener: (value: { payload: unknown }) => void }) {
      if (input.event === 'update-downloaded') downloaded = input.listener;
    },
  } satisfies LegacyUpdaterLike;
  vi.useFakeTimers();
  const controller = createAutoUpdateController({
    updater, platform: 'darwin', pid: 1, now: () => 0,
    timers: { setTimeout: () => ({}), setInterval: () => ({}), clear: () => {} },
    timing: { firstCheckDelayMs: 30_000, tickMs: 900_000, checkIntervalMs: 14_400_000, staleMs: 2_700_000, stageTimeoutMs: 120_000 },
    messages: { downloaded: ({ version }) => version, error: ({ message }) => message, promptFailed: ({ message }) => message, checkFailed: ({ message }) => message, presenceWriteFailed: ({ message }) => message },
    presence: { readLive: () => [], write: () => {}, remove: () => {} },
    promptUpdateReady: async () => false, explainOthersOpen: () => {}, quit: () => {}, log: () => {},
  });
  downloaded?.({ payload: { version: '8' } });
  expect(controller.beforeFinalQuit()).toBe(true);
  expect(calls).toEqual([{ isSilent: false, isForceRunAfter: false }]);
  controller.willQuit();
});
