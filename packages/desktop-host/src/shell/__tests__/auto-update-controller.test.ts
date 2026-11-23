/**
 * @file (Ported from the host app's test of the same name with the module; the host keeps its copy as the consumer check.)
 * Behavioural proof for `auto-update-controller.ts`, driven with a fake `electron-updater` and
 * a real presence directory: one owner checks, a download prompts once, and a quit installs only
 * from the last instance, holding the quit exactly when the install will end the app itself.
 */
import { onTestFinished, test, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";

import { createAutoUpdateController } from "../auto-update-controller.js";
import type { AutoUpdateControllerDeps } from "../auto-update-controller.js";
import { createInstancePresence } from "../instance-presence.js";
import { PRESENCE_STALE_MS, UPDATE_CHECK_INTERVAL_MS } from "../../electron/updates/index.js";

const SELF = 100;

/** A stand-in for `electron-updater`'s `autoUpdater` that records every call. */
function fakeUpdater() {
  const listeners = new EventEmitter();
  const calls: string[] = [];
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: true,
    checkResult: Promise.resolve<{ downloadPromise?: Promise<unknown> | null } | null>(null),
    checkForUpdates() {
      calls.push("check");
      return updater.checkResult;
    },
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
      calls.push(`quitAndInstall(${isSilent},${isForceRunAfter})`);
    },
    on(...args:
      | [event: "update-downloaded", listener: (info: { version: string }) => void]
      | [event: "error", listener: (error: Error) => void]
    ) {
      return listeners.on(args[0], args[1]);
    },
    emit(event: string, payload: unknown) {
      listeners.emit(event, payload);
    },
  };
  return { updater, calls };
}

function setup(overrides: Partial<AutoUpdateControllerDeps> = {}) {
  const presenceDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tovu-updater-")), "instances");
  const { updater, calls } = fakeUpdater();
  const events: string[] = [];
  let clock = 1_000_000;
  const alive = new Set([SELF]);
  let restartChoice = false;
  const controller = createAutoUpdateController({
    updater,
    platform: "darwin",
    pid: SELF,
    presenceDir,
    now: () => clock,
    isAlive: ({ pid }) => alive.has(pid),
    promptUpdateReady: async ({ version }) => {
      events.push(`prompt ${version}`);
      return restartChoice;
    },
    explainOthersOpen: ({ count }) => events.push(`others ${count}`),
    quit: () => events.push("quit"),
    log: () => {},
    stageTimeoutMs: 60_000,
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
      createInstancePresence({ directory: presenceDir }).write({ record: { pid, startedAt, heartbeatAt: clock } });
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
  // Leave a crash record on disk without adding the pid to setup's live set.
  createInstancePresence({ directory: t.presenceDir }).write({ record: { pid: 50, startedAt: 0, heartbeatAt: 1_000_000 } });
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
  // Jini words the reason: its pinned release prints the error's own text, its next one a fixed label.
  assert.equal(logs.length, 1);
  assert.ok(["auto-update: check failed: offline", "auto-update: check failed: Error"].includes(String(logs[0])), `unexpected log line: ${String(logs[0])}`);
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

test("without an injected liveness probe the real process table decides: a live older sibling suppresses the check, an exited one does not", async () => {
  // Both instances must be real processes for the default probe: this runner is "self", and its
  // parent (certainly alive while the runner is) is the older sibling.
  const live = setup({ isAlive: undefined, pid: process.pid } as unknown as Partial<AutoUpdateControllerDeps>);
  live.addSibling(process.ppid, 0);
  live.controller.tick();
  await flush();
  assert.deepEqual(live.calls, [], "a live older copy owns the update check");

  const exited = spawnSync(process.execPath, ["-e", ""]);
  const dead = setup({ isAlive: undefined, pid: process.pid } as unknown as Partial<AutoUpdateControllerDeps>);
  dead.addSibling(exited.pid!, 0);
  dead.controller.tick();
  await flush();
  assert.deepEqual(dead.calls, ["check"], "a record left by an exited process cannot suppress the check");
});

test("macOS: with no host override, a hung Squirrel hand-off quits the app after Jini's two-minute deadline", () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] }); onTestFinished(() => { vi.useRealTimers(); });
  const s = setup({ stageTimeoutMs: undefined });
  s.updater.emit("update-downloaded", { version: "0.2.0" });
  assert.equal(s.controller.beforeFinalQuit(), true);
  vi.advanceTimersByTime(2 * 60 * 1000 - 1);
  assert.deepEqual(s.events.filter((event) => event === "quit"), [], "the quit is held while Squirrel may still be staging");
  vi.advanceTimersByTime(1);
  assert.deepEqual(s.events.filter((event) => event === "quit"), ["quit"]);
});
