/**
 * @file (Ported from the host app's test of the same name with the module; the host keeps its copy as the consumer check.)
 * Behavioural proof for `instance-presence.ts`: records round-trip, dead instances are pruned
 * on read, and junk in the directory is ignored rather than trusted.
 */
import { onTestFinished, test, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createInstancePresence, isPidAlive, presenceDirPath } from "../instance-presence.js";

function tempDir(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tovu-presence-")), "instances");
}

test("the presence directory is `instances` inside userData", () => {
  assert.equal(presenceDirPath({ userDataDir: "/u" }), path.join("/u", "instances"));
});

test("a written record reads back, and a heartbeat overwrites it in place", () => {
  const dir = tempDir();
  createInstancePresence({ directory: dir }).write({ record: { pid: 11, startedAt: 1, heartbeatAt: 2 } });
  createInstancePresence({ directory: dir }).write({ record: { pid: 11, startedAt: 1, heartbeatAt: 9 } });
  assert.deepEqual(createInstancePresence({ directory: dir }, { isAlive: () => true }).readLive(), [{ pid: 11, startedAt: 1, heartbeatAt: 9 }]);
  assert.deepEqual(fs.readdirSync(dir), ["11.json"], "no temp file may be left behind");
});

test("a dead instance's record is dropped AND deleted on read", () => {
  const dir = tempDir();
  createInstancePresence({ directory: dir }).write({ record: { pid: 11, startedAt: 1, heartbeatAt: 2 } });
  createInstancePresence({ directory: dir }).write({ record: { pid: 12, startedAt: 1, heartbeatAt: 2 } });
  const live = createInstancePresence({ directory: dir }, { isAlive: ({ pid }) => pid === 12 }).readLive();
  assert.deepEqual(live.map((record) => record.pid), [12]);
  assert.deepEqual(fs.readdirSync(dir), ["12.json"]);
});

test("malformed and unrelated files are skipped, not trusted and not deleted", () => {
  const dir = tempDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "5.json"), "{not json");
  fs.writeFileSync(path.join(dir, "6.json"), JSON.stringify({ pid: 6, startedAt: "x", heartbeatAt: 1 }));
  fs.writeFileSync(path.join(dir, "notes.txt"), "hi");
  fs.mkdirSync(path.join(dir, "7.json"));
  assert.deepEqual(createInstancePresence({ directory: dir }, { isAlive: () => true }).readLive(), []);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["5.json", "6.json", "7.json", "notes.txt"]);
});

test("a missing directory reads as no instances", () => {
  assert.deepEqual(createInstancePresence({ directory: path.join(tempDir(), "absent") }).readLive(), []);
});

test("removing a record never throws, even when it is already gone", () => {
  const dir = tempDir();
  createInstancePresence({ directory: dir }).write({ record: { pid: 11, startedAt: 1, heartbeatAt: 2 } });
  createInstancePresence({ directory: dir }).remove({ pid: 11 });
  createInstancePresence({ directory: dir }).remove({ pid: 11 });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("this process is alive; a pid far past the range is not", () => {
  assert.equal(isPidAlive({ pid: process.pid }), true);
  assert.equal(isPidAlive({ pid: 2 ** 30 }), false);
});

test("a process owned by another user (EPERM) still counts as alive", () => {
  const kill = vi.spyOn(process, "kill").mockImplementation((pid: number, signal?: number | string) => {
    assert.equal(pid, 12345);
    assert.equal(signal, 0);
    throw Object.assign(new Error("permission denied"), { code: "EPERM" });
  });
  assert.equal(isPidAlive({ pid: 12345 }), true);
  assert.equal(kill.mock.calls.length, 1);
});
