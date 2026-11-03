import { expect, test } from "vitest";
import { createDirectoryRunningLock, type DirectoryRunningRecord } from "../directory-running-lock.js";
import type { DurableJsonFile, JsonFileRead } from "../durable-json.js";

const owner = { pid: 10, app: "Web", started: "2026-11-02T00:00:00Z", token: "old", bootId: "old-boot" };
const next: DirectoryRunningRecord = { ...owner, pid: 20, port: 3000, scheme: "http", token: "next", bootId: "current-boot" };

function fixture({ alive, previousBoot = false }: { alive: boolean; previousBoot?: boolean }, _options = {}) {
  let stored: JsonFileRead = { state: "ok", value: { ...owner, port: -1, scheme: "file" } };
  let locked = false, removals = 0;
  const file: DurableJsonFile = {
    read: () => stored, tempPath: () => "unused", quarantine: () => false,
    write: ({ value }) => { expect(locked).toBe(true); stored = { state: "ok", value }; },
    withLock: ({ critical }) => { locked = true; try { return critical(); } finally { locked = false; } },
  };
  const lock = createDirectoryRunningLock({ file, isAlive: () => alive,
    remove: () => { expect(locked).toBe(true); removals++; stored = { state: "missing" }; },
  }, previousBoot ? { bootIdentity: () => ({ id: "current-boot", startedAtMs: 0 }) } : {});
  return { lock, removals: () => removals, stored: () => stored };
}

test("a dead site's invalid address is recovered automatically before attaching or starting", () => {
  const { lock, removals, stored } = fixture({ alive: false });
  expect(lock.peek({})).toBeNull();
  expect(removals()).toBe(0);
  expect(lock.read({})).toBeNull();
  expect(stored()).toEqual({ state: "missing" });
  expect(removals()).toBe(1);
  expect(lock.claim({ record: next }).acquired).toBe(true);
  expect(stored()).toEqual({ state: "ok", value: next });
});

test("claim recovers a stale invalid address even when no observer read it first", () => {
  const { lock, removals } = fixture({ alive: false });
  expect(lock.claim({ record: next }).acquired).toBe(true);
  expect(removals()).toBe(1);
});

test("a stale invalid address from an earlier boot cannot strand a recycled live PID", () => {
  const { lock, removals } = fixture({ alive: true, previousBoot: true });
  expect(lock.read({})).toBeNull();
  expect(removals()).toBe(1);
});

test("an invalid address with a live owner still denies a second database owner", () => {
  const { lock, removals, stored } = fixture({ alive: true });
  expect(() => lock.read({})).toThrow("The running lock is invalid");
  expect(() => lock.claim({ record: next })).toThrow("The running lock is invalid");
  expect(removals()).toBe(0);
  expect(stored().state).toBe("ok");
});
