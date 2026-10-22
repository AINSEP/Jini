import { expect, test } from "vitest";
import { createDirectoryRunningLock, type DirectoryRunningRecord } from "../directory-running-lock.js";
import type { DurableJsonFile, JsonFileRead } from "../durable-json.js";

const record: DirectoryRunningRecord = {
  pid: 10, port: 0, app: "Desktop", started: "2026-10-09T01:00:00.000Z", token: "owner", scheme: "http",
};

function fixture({ stored }: { stored: JsonFileRead }, _options = {}) {
  const effects: string[] = [];
  const file: DurableJsonFile = {
    read: () => stored,
    tempPath: () => "unused",
    quarantine: () => false,
    write: () => { effects.push("write"); },
    withLock: ({ critical }) => { effects.push("lock"); return critical(); },
  };
  const lock = createDirectoryRunningLock({
    file,
    isAlive: () => { effects.push("probe"); return true; },
    remove: () => { effects.push("remove"); },
  });
  return { lock, effects };
}

const invalid: readonly [string, unknown][] = [
  ["undefined", undefined], ["null", null], ["false", false], ["zero", 0], ["string", "lease"], ["array", []],
  ["missing fields", {}],
  ["string pid", { ...record, pid: "10" }], ["zero pid", { ...record, pid: 0 }],
  ["negative pid", { ...record, pid: -1 }], ["fractional pid", { ...record, pid: 1.5 }],
  ["unsafe pid", { ...record, pid: Number.MAX_SAFE_INTEGER + 1 }],
  ["NaN pid", { ...record, pid: NaN }], ["infinite pid", { ...record, pid: Infinity }],
  ["string port", { ...record, port: "80" }], ["negative port", { ...record, port: -1 }],
  ["excessive port", { ...record, port: 65536 }], ["fractional port", { ...record, port: 0.5 }],
  ["NaN port", { ...record, port: NaN }], ["infinite port", { ...record, port: Infinity }],
  ["non-string app", { ...record, app: 1 }], ["empty app", { ...record, app: "" }],
  ["non-string token", { ...record, token: 1 }], ["empty token", { ...record, token: "" }],
  ["null boot id", { ...record, bootId: null }], ["numeric boot id", { ...record, bootId: 1 }],
  ["non-string start", { ...record, started: 1 }], ["invalid date", { ...record, started: "invalid" }],
  ["unsupported scheme", { ...record, scheme: "ftp" }], ["non-string scheme", { ...record, scheme: 1 }],
];

for (const [label, value] of invalid) {
  test(`stored ${label} fails closed before any liveness or mutation effect`, () => {
    const { lock, effects } = fixture({ stored: { state: "ok", value } });
    expect(() => lock.peek({})).toThrow("The running lock is invalid; refusing to open this directory's database.");
    expect(effects).toEqual([]);
  });

  test(`claim with ${label} fails before acquiring the file lock`, () => {
    const { lock, effects } = fixture({ stored: { state: "missing" } });
    // Claims are typed, but callers can still supply malformed records at runtime.
    expect(() => lock.claim({ record: value as DirectoryRunningRecord })).toThrow("Cannot claim an invalid running lock.");
    expect(effects).toEqual([]);
  });
}

for (const value of [
  record,
  { ...record, pid: 1, port: 1, scheme: "https" as const, bootId: "" },
  { ...record, pid: Number.MAX_SAFE_INTEGER, port: 65535, bootId: "current" },
  { ...record, app: " ", token: " ", started: "2000-01-01" },
]) {
  test(`valid lease ${JSON.stringify(value)} is accepted by both reading and claiming`, () => {
    const stored = fixture({ stored: { state: "ok", value } });
    expect(stored.lock.peek({})).toBe(value);
    expect(stored.effects).toEqual(["probe"]);
    const empty = fixture({ stored: { state: "missing" } });
    expect(empty.lock.claim({ record: value })).toEqual({ acquired: true, record: value });
    expect(empty.effects).toEqual(["lock", "write"]);
  });
}
