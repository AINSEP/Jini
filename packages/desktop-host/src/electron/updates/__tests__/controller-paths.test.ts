/** Default copy for failure logs, the `now` clock form, post-quit inertness, and the Node/Electron adapters. */
import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { createAutoUpdateController, createElectronUpdaterAdapter, createNodeUpdateTimers } from '../index.js';
import type { ElectronUpdater } from '../index.js';

function nativeUpdater(check: () => Promise<null> = async () => null) {
  const emitter = new EventEmitter();
  const installs: Array<[boolean | undefined, boolean | undefined]> = [];
  const updater: ElectronUpdater = {
    autoDownload: false, autoInstallOnAppQuit: true, autoRunAppAfterInstall: true,
    checkForUpdates: check,
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) { installs.push([isSilent, isForceRunAfter]); },
    on: emitter.on.bind(emitter),
  };
  return { updater, installs, emitter };
}

function host(updater: ElectronUpdater, overrides: { write?: () => void; prompt?: () => Promise<boolean> } = {}) {
  const logs: string[] = [];
  const events: string[] = [];
  const records: unknown[] = [];
  const controller = createAutoUpdateController({
    updater, platform: 'darwin', pid: 1, now: () => 5,
    presence: {
      readLive: () => [{ pid: 1, startedAt: 0, heartbeatAt: 5 }],
      write: overrides.write ?? (({ record }) => { records.push(record); }),
      remove: ({ pid }) => { events.push(`remove ${pid}`); },
    },
    promptUpdateReady: overrides.prompt ?? (async () => true),
    explainOthersOpen: ({ count }) => { events.push(`others ${count}`); }, quit: () => { events.push('quit'); },
    log: ({ message }) => { logs.push(message); },
  }, { timers: { setTimeout: () => ({}), setInterval: () => ({}), clear: () => {} } });
  return { controller, logs, events, records };
}

it('stamps presence from a plain `now` function when no clock object is given', () => {
  const h = host(nativeUpdater().updater);
  h.controller.start();
  expect(h.records).toEqual([{ pid: 1, startedAt: 5, heartbeatAt: 5 }]);
});

it('logs a failed prompt, a failed check and a failed presence write with the default copy', async () => {
  const native = nativeUpdater(() => { throw new Error('offline'); });
  const h = host(native.updater, { write: () => { throw new Error('disk full'); }, prompt: () => Promise.reject('dismissed') });
  h.controller.tick();
  native.emitter.emit('update-downloaded', { version: '9.0.0' });
  await new Promise(resolve => setImmediate(resolve));
  expect(h.logs).toEqual([
    'auto-update: presence write failed: disk full',
    'auto-update: check failed: offline',
    'auto-update: 9.0.0 downloaded',
    'auto-update: prompt failed: dismissed',
  ]);
});

it('ignores downloads, errors, restart clicks and a second quit once it has quit', () => {
  const native = nativeUpdater();
  const h = host(native.updater);
  h.controller.willQuit();
  h.controller.willQuit();
  native.emitter.emit('update-downloaded', { version: '9.0.0' });
  native.emitter.emit('error', new Error('late'));
  h.controller.requestRestart();
  expect(h.controller.beforeFinalQuit()).toBe(false);
  expect(h.logs).toEqual([]);
  expect(h.events).toEqual(['remove 1']);
  expect(native.installs).toEqual([]);
});

it('the Node timers adapter ignores a handle it did not create and keeps its own timers running', async () => {
  const timers = createNodeUpdateTimers();
  let fired = 0;
  timers.setTimeout({ callback: () => { fired++; }, ms: 1 });
  timers.clear({ timer: {} });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(fired).toBe(1);
});

it('the Electron adapter forwards every mutable flag both ways and error listeners with their payload', () => {
  const native = nativeUpdater();
  const adapted = createElectronUpdaterAdapter({ updater: native.updater });
  native.updater.autoDownload = true;
  expect(adapted.autoDownload).toBe(true);
  adapted.autoInstallOnAppQuit = false;
  expect(native.updater.autoInstallOnAppQuit).toBe(false);
  native.updater.autoInstallOnAppQuit = true;
  expect(adapted.autoInstallOnAppQuit).toBe(true);
  adapted.autoRunAppAfterInstall = false;
  expect(native.updater.autoRunAppAfterInstall).toBe(false);
  const errors: string[] = [];
  adapted.on('error', error => { errors.push(error.message); });
  native.emitter.emit('error', new Error('signature mismatch'));
  expect(errors).toEqual(['signature mismatch']);
});
