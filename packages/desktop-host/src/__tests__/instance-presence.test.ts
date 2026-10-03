import { nodeFilesystem } from './node-ports.js';

import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createFileInstancePresence, isPidAlive as probePid, presenceDirPath as resolvePresenceDir } from "../electron/updates/instance-presence.js";

function tempDir(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sample-presence-")), "instances");
}

test("the presence directory is `instances` inside userData", () => {
  assert.equal(presenceDirPath("/u"), path.join("/u", "instances"));
});

test("a written record reads back, and a heartbeat overwrites it in place", () => {
  const dir = tempDir();
  writeInstanceRecord(dir, { pid: 11, startedAt: 1, heartbeatAt: 2 });
  writeInstanceRecord(dir, { pid: 11, startedAt: 1, heartbeatAt: 9 });
  assert.deepEqual(readLiveInstances(dir, () => true), [{ pid: 11, startedAt: 1, heartbeatAt: 9 }]);
  assert.deepEqual(fs.readdirSync(dir), ["11.json"], "no temp file may be left behind");
});

test("a dead instance's record is dropped AND deleted on read", () => {
  const dir = tempDir();
  writeInstanceRecord(dir, { pid: 11, startedAt: 1, heartbeatAt: 2 });
  writeInstanceRecord(dir, { pid: 12, startedAt: 1, heartbeatAt: 2 });
  const live = readLiveInstances(dir, (pid) => pid === 12);
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
  assert.deepEqual(readLiveInstances(dir, () => true), []);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["5.json", "6.json", "7.json", "notes.txt"]);
});

test("a missing directory reads as no instances", () => {
  assert.deepEqual(readLiveInstances(path.join(tempDir(), "absent")), []);
});

test("removing a record never throws, even when it is already gone", () => {
  const dir = tempDir();
  writeInstanceRecord(dir, { pid: 11, startedAt: 1, heartbeatAt: 2 });
  removeInstanceRecord(dir, 11);
  removeInstanceRecord(dir, 11);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("this process is alive; a pid far past the range is not", () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(2 ** 30), false);
});

test("a process owned by another user (EPERM) still counts as alive", () => {

  assert.equal(isPidAlive(1), true);
});

function presence(dir: string, isAlive = (pid: number) => probePid({ pid, probe: ({ pid, signal }) => process.kill(pid, signal) })) { return createFileInstancePresence({ directory: dir, filesystem: nodeFilesystem, isAlive: ({ pid }) => isAlive(pid), writerPid: process.pid }); }
function writeInstanceRecord(dir: string, record: import("../electron/updates/update-policy.js").InstanceRecord) { presence(dir).write({ record }); }
function readLiveInstances(dir: string, isAlive?: (pid: number) => boolean) { return presence(dir, isAlive).readLive(); }
function removeInstanceRecord(dir: string, pid: number) { presence(dir).remove({ pid }); }
function isPidAlive(pid: number) { return probePid({ pid, probe: ({ pid, signal }) => process.kill(pid, signal) }); }
function presenceDirPath(userDataDir: string) { return resolvePresenceDir({ userDataDir, directoryName: "instances" }); }

test('an injected permission denial still counts as alive; other failures do not', () => {
  assert.equal(probePid({ pid: 7, probe: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } }), true);
  assert.equal(probePid({ pid: 7, probe: () => { throw Object.assign(new Error('missing'), { code: 'ESRCH' }); } }), false);
});

test('a record with a mismatched filename is ignored without deleting another instance', () => {
  const dir = tempDir(); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '11.json'), JSON.stringify({ pid: 12, startedAt: 1, heartbeatAt: 2 }));
  assert.deepEqual(readLiveInstances(dir, () => false), []);
  assert.deepEqual(fs.readdirSync(dir), ['11.json']);
});
