import { expect, it } from "vitest";
import { createDirectoryRunningLock, type DirectoryRunningRecord } from "../directory-running-lock.js";
import type { DurableJsonFile, JsonFileRead } from "../durable-json.js";

function fixture() {
  let stored: JsonFileRead = { state: "missing" }, locked = false;
  const alive = new Set<number>([10, 20]);
  const file: DurableJsonFile = {
    read: () => stored, tempPath: () => "unused", quarantine: () => false,
    write: ({ value }) => { expect(locked).toBe(true); stored = { state: "ok", value }; },
    withLock: ({ critical }) => { expect(locked).toBe(false); locked = true; try { return critical(); } finally { locked = false; } },
  };
  const lock = createDirectoryRunningLock({ file, isAlive: ({ pid }) => alive.has(pid), remove: () => { expect(locked).toBe(true); stored = { state: "missing" }; } });
  const record: DirectoryRunningRecord = { pid: 10, port: 0, app: "Desktop", started: "2000-01-01T00:00:00.000Z", token: "first", scheme: "http" };
  return { lock, alive, record, storedValue: () => stored, corrupt: () => { stored = { state: "unreadable" }; } };
}
it("a live starting owner blocks a second server regardless of age", () => {
  const { lock, record } = fixture();
  expect(lock.claim({ record })).toEqual({ acquired: true, record });
  expect(lock.claim({ record: { ...record, pid: 20, app: "Web", token: "second" } })).toEqual({ acquired: false, record });
  lock.update({ token: "first", port: 3101 });
  lock.release({ token: "second" });
  expect(lock.read({})?.port).toBe(3101);
  expect(() => lock.update({ token: "second", port: 3102 })).toThrow("Running lock ownership was lost.");
  lock.release({ token: "first" });
  expect(lock.read({})).toBeNull();
});
it("peek is read-only; a dead owner is cleaned before a new claim", () => {
  const { lock, record, alive, storedValue } = fixture();
  lock.claim({ record }); alive.delete(10);
  expect(lock.peek({})).toBeNull();
  expect(storedValue()).toEqual({ state: "ok", value: record });
  expect(lock.claim({ record: { ...record, pid: 20, app: "Web", token: "second" } }).acquired).toBe(true);
  expect(lock.read({})?.app).toBe("Web");
});
it("unreadable locks refuse database admission instead of being overwritten", () => {
  const { lock, record, corrupt } = fixture(); corrupt();
  expect(() => lock.claim({ record })).toThrow("The running lock is unreadable; refusing to open this directory's database.");
});

it("invalid claim records are rejected before creating a lease", () => {
  const { lock, record } = fixture();
  expect(() => lock.claim({ record: { ...record, port: -1 } })).toThrow("Cannot claim an invalid running lock.");
  expect(lock.read({})).toBeNull();
});

it("a previous-boot lease with a recycled live PID is ignored, while this boot remains protected", () => {
  let stored: JsonFileRead = { state: "ok", value: { pid: 10, port: 3456, app: "Web", started: "2000-01-01T00:00:00Z", token: "old", scheme: "http", bootId: "previous" } };
  const file: DurableJsonFile = { read: () => stored, tempPath: () => "unused", quarantine: () => false,
    write: ({ value }) => { stored = { state: "ok", value }; }, withLock: ({ critical }) => critical() };
  const lock = createDirectoryRunningLock({ file, isAlive: () => true, remove: () => { stored = { state: "missing" }; } }, {
    bootIdentity: () => ({ id: "current", startedAtMs: Date.parse("2026-10-09T00:00:00Z") }),
  });
  expect(lock.peek({})).toBeNull();
  const next: DirectoryRunningRecord = { pid: 10, port: 0, app: "Desktop", started: "2026-10-09T01:00:00Z", token: "new", scheme: "http" };
  const claim = lock.claim({ record: next }); expect(claim.acquired).toBe(true);
  expect(claim.record.bootId).toBe("current"); expect(lock.peek({})?.token).toBe("new");
  expect(lock.claim({ record: { ...next, token: "other" } }).acquired).toBe(false);
  // Legacy leases predate boot IDs; their timestamp also proves they cannot own this boot's PID.
  stored = { state: "ok", value: { ...next, started: "2000-01-01T00:00:00Z" } };
  expect(lock.peek({})).toBeNull();
});
