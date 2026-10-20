import { expect, test } from "vitest";
import type { BootIdentity } from "../boot-identity.js";
import { createDirectoryRunningLock, type DirectoryRunningRecord } from "../directory-running-lock.js";
import type { DurableJsonFile, JsonFileRead } from "../durable-json.js";

const record: DirectoryRunningRecord = { pid: 10, port: 0, app: "Desktop", started: "2026-10-09T01:00:00.000Z", token: "first", scheme: "http" };
function fixture({ stored: initial = { state: "missing" }, alive = true, boot }: { stored?: JsonFileRead; alive?: boolean; boot?: BootIdentity } = {}) {
  let stored = initial, locks = 0, removals = 0;
  const file: DurableJsonFile = {
    read: () => stored, tempPath: () => "unused", quarantine: () => false,
    write: ({ value }) => { stored = { state: "ok", value }; },
    withLock: ({ critical }) => { locks++; return critical(); },
  };
  const lock = createDirectoryRunningLock({ file, isAlive: () => alive, remove: () => { removals++; stored = { state: "missing" }; } },
    boot ? { bootIdentity: () => boot } : {});
  return { lock, stored: () => stored, locks: () => locks, removals: () => removals };
}
const storedRecord = (value: unknown): JsonFileRead => ({ state: "ok", value });
const INVALID = "The running lock is invalid; refusing to open this directory's database.";

for (const [label, value] of [
  ["null", null], ["a string", "lease"], ["pid 0", { ...record, pid: 0 }], ["an unsafe pid", { ...record, pid: 2 ** 53 }],
  ["a fractional pid", { ...record, pid: 1.5 }], ["port -1", { ...record, port: -1 }], ["port 65536", { ...record, port: 65536 }],
  ["a fractional port", { ...record, port: 80.5 }], ["an empty app", { ...record, app: "" }], ["a non-string app", { ...record, app: 7 }],
  ["an empty token", { ...record, token: "" }], ["a non-string token", { ...record, token: 7 }], ["a numeric bootId", { ...record, bootId: 7 }],
  ["a non-string started", { ...record, started: 7 }], ["an unparseable started", { ...record, started: "yesterday" }], ["scheme ftp", { ...record, scheme: "ftp" }],
] as const) {
  test(`a stored lease with ${label} refuses database admission`, () => {
    const { lock } = fixture({ stored: storedRecord(value) });
    expect(() => lock.peek({})).toThrow(INVALID);
  });
}
test("a stored lease at the port and boot-id edges is valid", () => {
  const { lock } = fixture({ stored: storedRecord({ ...record, port: 65535, scheme: "https", bootId: "b" }) });
  expect(lock.peek({})).toEqual({ ...record, port: 65535, scheme: "https", bootId: "b" });
});
test("an invalid claim at port 65536 is refused before taking the lock", () => {
  const { lock, locks } = fixture();
  expect(() => lock.claim({ record: { ...record, port: 65536 } })).toThrow("Cannot claim an invalid running lock.");
  expect(locks()).toBe(0);
});
for (const port of [0, 65536, 80.5, Number.NaN]) {
  test(`update refuses port ${port} before taking the lock`, () => {
    const { lock, locks } = fixture({ stored: storedRecord(record) });
    expect(() => lock.update({ token: "first", port })).toThrow("Running port must be between 1 and 65535.");
    expect(locks()).toBe(0);
  });
}
test("update accepts the port edges 1 and 65535", () => {
  const { lock, stored } = fixture({ stored: storedRecord(record) });
  lock.update({ token: "first", port: 1 }); expect(stored()).toEqual(storedRecord({ ...record, port: 1 }));
  lock.update({ token: "first", port: 65535 }); expect(stored()).toEqual(storedRecord({ ...record, port: 65535 }));
});
test("update of a missing lease reports lost ownership", () => {
  const { lock } = fixture();
  expect(() => lock.update({ token: "first", port: 3000 })).toThrow("Running lock ownership was lost.");
});
test("release of a missing lease returns without taking the lock", () => {
  const { lock, locks } = fixture();
  lock.release({ token: "first" });
  expect(locks()).toBe(0);
});
test("read of a missing lease returns null without taking the lock", () => {
  const { lock, locks } = fixture();
  expect(lock.read({})).toBeNull();
  expect(locks()).toBe(0);
});
test("read removes a lease whose owner is dead", () => {
  const { lock, removals, stored } = fixture({ stored: storedRecord(record), alive: false });
  expect(lock.read({})).toBeNull();
  expect(removals()).toBe(1); expect(stored()).toEqual({ state: "missing" });
});
test("peek never removes a dead owner's lease", () => {
  const { lock, removals } = fixture({ stored: storedRecord(record), alive: false });
  expect(lock.peek({})).toBeNull();
  expect(removals()).toBe(0);
});
test("an unreadable lease refuses peek as well as claim", () => {
  const { lock } = fixture({ stored: { state: "unreadable" } });
  expect(() => lock.peek({})).toThrow("The running lock is unreadable; refusing to open this directory's database.");
});
test("a lease recording the current boot id and a live pid is kept", () => {
  const { lock } = fixture({ stored: storedRecord({ ...record, bootId: "current" }), boot: { id: "current", startedAtMs: Date.parse("2030-01-01T00:00:00Z") } });
  expect(lock.peek({})?.bootId).toBe("current");
});
test("a legacy lease started exactly at boot time counts as this boot", () => {
  const { lock } = fixture({ stored: storedRecord(record), boot: { id: "current", startedAtMs: Date.parse(record.started) } });
  expect(lock.peek({})).toEqual(record);
});
test("a lease from this boot whose pid is dead is cleaned on read", () => {
  const { lock, removals } = fixture({ stored: storedRecord({ ...record, bootId: "current" }), alive: false, boot: { id: "current", startedAtMs: 0 } });
  expect(lock.read({})).toBeNull();
  expect(removals()).toBe(1);
});
test("release by the owning token removes the lease under the lock", () => {
  const { lock, removals, locks } = fixture({ stored: storedRecord(record) });
  lock.release({ token: "first" });
  expect(removals()).toBe(1); expect(locks()).toBe(1);
});
