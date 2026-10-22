import { nodeFilesystem } from './node-ports.js';

import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAutoUpdateController } from "../electron/updates/auto-update-controller.js";
import type { AutoUpdateControllerEffects } from "../electron/updates/auto-update-controller.js";
import { createFileInstancePresence, isPidAlive as probePid, presenceDirPath as resolvePresenceDir } from "../electron/updates/instance-presence.js";
import { PRESENCE_STALE_MS, UPDATE_CHECK_INTERVAL_MS } from "../electron/updates/update-policy.js";

const SELF = 100;


function fakeUpdater() {
  const listeners = new Map<string, (args: { payload: unknown }) => void>();
  const calls: string[] = [];
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: true,
    checkResult: Promise.resolve(null) as Promise<{ downloadPromise?: Promise<unknown> | null } | null>,
    checkForUpdates() {
      calls.push("check");
      return updater.checkResult;
    },
    quitAndInstall(_requiredArgs: Record<string, never>, { isSilent, isForceRunAfter }: { isSilent?: boolean; isForceRunAfter?: boolean } = {}) {
      calls.push(`quitAndInstall(${isSilent},${isForceRunAfter})`);
    },
    on({ event, listener }: { event: string; listener: (args: { payload: never }) => void }) {
      listeners.set(event, listener as (args: { payload: unknown }) => void);
    },
    emit(event: string, payload: unknown) {
      listeners.get(event)?.({ payload });
    },
  };
  return { updater, calls };
}

function setup(overrides: Partial<AutoUpdateControllerEffects> = {}) {
  const presenceDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sample-updater-")), "instances");
  const { updater, calls } = fakeUpdater();
  const events: string[] = [];
  let clock = 1_000_000;
  const alive = new Set([SELF]);
  let restartChoice = false;
  const controller = createAutoUpdateController({
    updater,
    platform: "darwin",
    pid: SELF,
    presence: presence(presenceDir, (pid) => alive.has(pid)),
    clock: { nowMs: () => clock },
    promptUpdateReady: async ({ version }) => {
      events.push(`prompt ${version}`);
      return restartChoice;
    },
    explainOthersOpen: ({ count }) => events.push(`others ${count}`),
    quit: () => events.push("quit"),
    log: () => {},
    timers: fakeTimers(),
    timing: { firstCheckDelayMs: 30_000, tickMs: 900_000, checkIntervalMs: UPDATE_CHECK_INTERVAL_MS, staleMs: PRESENCE_STALE_MS, stageTimeoutMs: 60_000 },
    messages: { downloaded: ({ version }) => `auto-update: ${version} downloaded`, error: ({ message }) => `auto-update: ${message}`, promptFailed: ({ message }) => `auto-update: prompt failed: ${message}`, checkFailed: ({ message }) => `auto-update: check failed: ${message}`, presenceWriteFailed: ({ message }) => `auto-update: presence write failed: ${message}` },
    ...overrides,
  });
  return {
    controller,
    updater,
    calls,
    events,
    presenceDir,
    advance: (ms: number) => (clock += ms),
    addSibling: (pid: number, startedAt: number) => {
      alive.add(pid);
      writeInstanceRecord(presenceDir, { pid, startedAt, heartbeatAt: clock });
    },
    chooseRestart: () => (restartChoice = true),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("configures the updater: quiet download; install-on-quit only on Windows", () => {
  const mac = setup();
  assert.equal(mac.updater.autoDownload, true);
  assert.equal(mac.updater.autoInstallOnAppQuit, false, "macOS must not feed Squirrel at download time");
  const win = setup({ platform: "win32" });
  assert.equal(win.updater.autoInstallOnAppQuit, true, "Windows registers its quit handler only when this is true at download");
});

test("the sole instance checks on its first tick and not again until the interval", async () => {
  const t = setup();
  t.controller.tick();
  await flush();
  t.controller.tick();
  assert.deepEqual(t.calls, ["check"]);
  t.advance(4 * 60 * 60 * 1000);
  t.controller.tick();
  assert.deepEqual(t.calls, ["check", "check"]);
});

test("an instance that started later than a live sibling never checks", () => {
  const t = setup();
  t.addSibling(50, 0);
  t.controller.tick();
  assert.deepEqual(t.calls, []);
});

test("an older dead sibling cannot suppress this instance's update check", async () => {
  const t = setup();

  writeInstanceRecord(t.presenceDir, { pid: 50, startedAt: 0, heartbeatAt: 1_000_000 });
  t.controller.tick();
  await flush();
  assert.deepEqual(t.calls, ["check"]);
  assert.equal(fs.existsSync(path.join(t.presenceDir, "50.json")), false);
});

test("an older live sibling with a stale heartbeat cannot suppress this instance's update check", async () => {
  const t = setup();
  t.addSibling(50, 0);
  t.advance(PRESENCE_STALE_MS + 1);
  t.controller.tick();
  await flush();
  assert.deepEqual(t.calls, ["check"]);
});

test("a failed check is logged, not thrown, and frees the next due check", async () => {
  const logs: string[] = [];
  const t = setup({ log: ({ message }) => logs.push(message) });
  t.updater.checkResult = Promise.reject(new Error("offline"));
  t.controller.tick();
  await flush();
  assert.deepEqual(logs, ["auto-update: check failed: offline"]);
  assert.deepEqual(t.calls, ["check"]);
  t.updater.checkResult = Promise.resolve(null);
  t.advance(UPDATE_CHECK_INTERVAL_MS);
  t.controller.tick();
  await flush();
  assert.deepEqual(t.calls, ["check", "check"], "a rejected check must not leave the controller busy forever");
});

test("a download prompts once per version; Later leaves the install to the quit", async () => {
  const t = setup();
  t.updater.emit("update-downloaded", { version: "0.2.0" });
  t.updater.emit("update-downloaded", { version: "0.2.0" });
  await flush();
  assert.deepEqual(t.events, ["prompt 0.2.0"]);
  t.controller.tick();
  assert.deepEqual(t.calls, [], "a downloaded update stops further checks");
});

test("Restart to update as the only instance quits through the normal drain, then relaunches", async () => {
  const t = setup();
  t.chooseRestart();
  t.updater.emit("update-downloaded", { version: "0.2.0" });
  await flush();
  assert.deepEqual(t.events, ["prompt 0.2.0", "quit"]);
  assert.equal(t.controller.beforeFinalQuit(), true, "the quit is held while the install takes over");
  assert.deepEqual(t.calls, ["quitAndInstall(true,true)"]);
  assert.equal(t.updater.autoRunAppAfterInstall, true);
  assert.equal(t.controller.beforeFinalQuit(), false, "the install's own quit goes through");
});

test("Restart to update with another copy open explains and does not quit", async () => {
  const t = setup();
  t.addSibling(200, 5_000_000);
  t.chooseRestart();
  t.updater.emit("update-downloaded", { version: "0.2.0" });
  await flush();
  assert.deepEqual(t.events, ["prompt 0.2.0", "others 1"]);
});

test("macOS: the last instance's quit stages the update with Squirrel, without relaunching", () => {
  const t = setup();
  t.updater.emit("update-downloaded", { version: "0.2.0" });
  assert.equal(t.controller.beforeFinalQuit(), true);
  assert.deepEqual(t.calls, ["quitAndInstall(false,false)"]);
  assert.equal(t.updater.autoRunAppAfterInstall, false);
});

test("macOS: a failed Squirrel hand-off still quits the app", () => {
  const t = setup();
  t.updater.emit("update-downloaded", { version: "0.2.0" });
  t.controller.beforeFinalQuit();
  t.updater.emit("error", new Error("squirrel said no"));
  assert.deepEqual(t.events.filter((event) => event === "quit"), ["quit"]);
});

test("a quit while another copy is open installs nothing, on either platform", () => {
  for (const platform of ["darwin", "win32"] as const) {
    const t = setup({ platform });
    t.addSibling(200, 5_000_000);
    t.updater.emit("update-downloaded", { version: "0.2.0" });
    assert.equal(t.controller.beforeFinalQuit(), false);
    assert.deepEqual(t.calls, []);
    assert.equal(t.updater.autoInstallOnAppQuit, false, `${platform} must not install on this quit`);
  }
});

test("Windows: the last instance's quit lets electron-updater install silently on quit", () => {
  const t = setup({ platform: "win32" });
  t.updater.emit("update-downloaded", { version: "0.2.0" });
  assert.equal(t.controller.beforeFinalQuit(), false);
  assert.equal(t.updater.autoInstallOnAppQuit, true);
  assert.deepEqual(t.calls, []);
});

test("Windows: a quit with no update switches install-on-quit off", () => {
  const t = setup({ platform: "win32" });
  assert.equal(t.controller.beforeFinalQuit(), false);
  assert.equal(t.updater.autoInstallOnAppQuit, false);
});

test("start records this instance at once; willQuit removes it", () => {
  const t = setup();
  t.controller.start();
  assert.deepEqual(fs.readdirSync(t.presenceDir), [`${SELF}.json`]);
  assert.deepEqual(t.calls, [], "the first check waits for the launch delay");
  t.controller.willQuit();
  assert.deepEqual(fs.readdirSync(t.presenceDir), []);
});

function presence(dir: string, isAlive = (pid: number) => probePid({ pid, probe: ({ pid, signal }) => process.kill(pid, signal) })) { return createFileInstancePresence({ directory: dir, filesystem: nodeFilesystem, isAlive: ({ pid }) => isAlive(pid), writerPid: process.pid }); }
function writeInstanceRecord(dir: string, record: import("../electron/updates/update-policy.js").InstanceRecord) { presence(dir).write({ record }); }

function fakeTimers() { return { setTimeout: (_args: { callback: () => void; ms: number }) => ({ unref() {} }), setInterval: (_args: { callback: () => void; ms: number }) => ({ unref() {} }), clear: (_args: { timer: unknown }) => {} }; }

test('caller timers control launch delays, repeated start, fallback and cleanup', () => {
  const scheduled: { fn: () => void; ms: number; kind: string; unref: () => void }[] = [];
  const cleared: unknown[] = [];
  const timers = {
    setTimeout({ callback: fn, ms }: { callback: () => void; ms: number }) { const handle = { fn, ms, kind: 'once', unref() {} }; scheduled.push(handle); return handle; },
    setInterval({ callback: fn, ms }: { callback: () => void; ms: number }) { const handle = { fn, ms, kind: 'repeat', unref() {} }; scheduled.push(handle); return handle; },
    clear({ timer: handle }: { timer: unknown }) { cleared.push(handle); },
  };
  const t = setup({ timers, timing: { firstCheckDelayMs: 7, tickMs: 13, checkIntervalMs: 19, staleMs: 39, stageTimeoutMs: 23 } });
  t.controller.start(); t.controller.start();
  assert.deepEqual(scheduled.map(({ ms, kind }) => [ms, kind]), [[7, 'once'], [13, 'repeat']]);
  scheduled[0]!.fn();
  assert.deepEqual(t.calls, ['check']);
  t.updater.emit('update-downloaded', { version: '2' });
  assert.equal(t.controller.beforeFinalQuit(), true);
  assert.equal(scheduled[2]!.ms, 23);
  scheduled[2]!.fn();
  assert.deepEqual(t.events, ['quit']);
  t.controller.willQuit();
  assert.deepEqual(cleared, scheduled);
  scheduled[1]!.fn(); scheduled[2]!.fn(); t.controller.start();
  assert.deepEqual(fs.readdirSync(t.presenceDir), []);
  assert.deepEqual(t.events, ['quit']);
});

test('a check stays busy through the download and frees a failed download for the next due check', async () => {
  let reject!: (error: Error) => void;
  const download = new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
  const logs: string[] = [];
  const t = setup({ log: ({ message }) => logs.push(message) });
  t.updater.checkResult = Promise.resolve({ downloadPromise: download });
  t.controller.tick(); await flush();
  t.advance(UPDATE_CHECK_INTERVAL_MS); t.controller.tick();
  assert.deepEqual(t.calls, ['check']);
  reject(new Error('download failed')); await flush();
  t.updater.checkResult = Promise.resolve(null); t.controller.tick();
  assert.deepEqual(t.calls, ['check', 'check']);
  assert.deepEqual(logs, ['auto-update: check failed: download failed']);
});

test('late prompt resolution after quit cannot restart the application', async () => {
  let resolve!: (restart: boolean) => void;
  const t = setup({ promptUpdateReady: () => new Promise<boolean>(done => { resolve = done; }) });
  t.updater.emit('update-downloaded', { version: '3' }); await flush();
  t.controller.willQuit(); resolve(true); await flush();
  assert.deepEqual(t.events, []);
  assert.equal(t.controller.beforeFinalQuit(), false);
});

test('synchronous updater failures are logged and still complete a held quit', () => {
  const logs: string[] = [];
  const t = setup({ log: ({ message }) => logs.push(message) });
  t.updater.checkForUpdates = () => { throw new Error('sync check'); };
  t.controller.tick();
  assert.deepEqual(logs, ['auto-update: check failed: sync check']);
  t.updater.quitAndInstall = () => { throw new Error('sync install'); };
  t.updater.emit('update-downloaded', { version: '4' });
  assert.equal(t.controller.beforeFinalQuit(), true);
  assert.deepEqual(t.events, ['quit']);
  assert.equal(logs.at(-1), 'auto-update: sync install');
});

test('the converted log port retains downloaded and updater error message text', () => {
  const logs: string[] = [];
  const t = setup({ log: ({ message }) => logs.push(message) });
  try {
    t.updater.emit('update-downloaded', { version: '9' });
    t.updater.emit('error', new Error('updater failed'));
    assert.deepEqual(logs, ['auto-update: 9 downloaded', 'auto-update: updater failed']);
  } finally {
    t.controller.willQuit();
    fs.rmSync(path.dirname(t.presenceDir), { recursive: true, force: true });
  }
});
