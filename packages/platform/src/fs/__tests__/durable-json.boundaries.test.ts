import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  createDurableJsonFile, createNodeDurableJsonPorts, salvageJsonPrefix, updateDurableJsonFiles,
  type DurableJsonFile, type DurableJsonPorts,
} from "../durable-json.js";

const roots: string[] = [];
function tempFile(): string { const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), "durable-bounds-")); roots.push(root); return path.join(root, "store.json"); }
afterEach(() => { for (const root of roots.splice(0)) nodeFs.rmSync(root, { recursive: true, force: true }); });
const notices = { prefix: "fixture", lockTimeout: () => "fixture lock timeout" };
function store(filePath: string, overrides: Partial<DurableJsonPorts> = {}, options: { pollMs?: number; staleMs?: number } = {}): DurableJsonFile {
  return createDurableJsonFile({ filePath, ...createNodeDurableJsonPorts({}), ...overrides, notices }, options);
}

// --- construction ----------------------------------------------------------
test("an empty filePath is refused", () => {
  expect(() => store("")).toThrow(new TypeError("filePath is required"));
});
for (const [label, options] of [
  ["pollMs 0", { pollMs: 0 }], ["fractional pollMs", { pollMs: 1.5 }], ["staleMs 0", { staleMs: 0 }],
  ["negative staleMs", { staleMs: -5 }], ["NaN staleMs", { staleMs: Number.NaN }], ["fractional staleMs", { staleMs: 2.5 }],
] as const) {
  test(`lock interval ${label} is refused`, () => {
    expect(() => store(tempFile(), {}, options)).toThrow(new TypeError("lock intervals must be positive safe integers"));
  });
}
test("an infinite staleMs (never steal) is accepted", () => {
  const file = store(tempFile(), {}, { staleMs: Infinity });
  expect(file.withLock({ critical: () => "ran" })).toBe("ran");
});

// --- quarantine ------------------------------------------------------------
function reporting(): { messages: string[]; report: DurableJsonPorts["report"] } {
  const messages: string[] = [];
  return { messages, report: { error: ({ message }) => { messages.push(message); } } };
}
test("quarantine moves damaged bytes aside with a timestamped name and reports where", () => {
  const filePath = tempFile(), { messages, report } = reporting(); nodeFs.writeFileSync(filePath, "{torn");
  const file = store(filePath, { report, clock: { nowMs: () => 42 } });
  expect(file.quarantine({ notice: { label: "Profile", consequence: "starting fresh." } })).toBe(true);
  expect(nodeFs.readFileSync(`${filePath}.corrupt-42`, "utf8")).toBe("{torn");
  expect(messages).toEqual([`fixture: Profile ${filePath} was unreadable (torn or corrupt). Moved it aside to ${filePath}.corrupt-42; starting fresh.`]);
});
test("quarantine of an already-moved file succeeds silently", () => {
  const { messages, report } = reporting();
  expect(store(tempFile(), { report }).quarantine({ notice: { label: "Profile", consequence: "x" } })).toBe(true);
  expect(messages).toEqual([]);
});
test("quarantine that cannot move the file (e.g. EXDEV) leaves it untouched, reports and returns false", () => {
  const filePath = tempFile(), { messages, report } = reporting(); nodeFs.writeFileSync(filePath, "{torn");
  const error = Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
  const file = store(filePath, { report, clock: { nowMs: () => 7 }, filesystem: { ...nodeFs, renameSync: () => { throw error; } } });
  expect(file.quarantine({ notice: { label: "Profile", consequence: "x" } })).toBe(false);
  expect(nodeFs.readFileSync(filePath, "utf8")).toBe("{torn");
  expect(messages).toEqual([`fixture: Profile ${filePath} is unreadable and could not be moved aside (${String(error)}). Left untouched; nothing was written over it.`]);
});

// --- lock options ----------------------------------------------------------
for (const waitMs of [-1, 1.5, Number.NaN]) {
  test(`withLock refuses waitMs ${waitMs} before running the critical section`, () => {
    let ran = false;
    expect(() => store(tempFile()).withLock({ critical: () => { ran = true; } }, { waitMs })).toThrow(new TypeError("waitMs must be a nonnegative safe integer"));
    expect(ran).toBe(false);
  });
}
test("withLock accepts waitMs 0", () => {
  expect(store(tempFile()).withLock({ critical: () => 1 }, { waitMs: 0 })).toBe(1);
});

// --- salvage ---------------------------------------------------------------
for (const maxAttempts of [0, -1, 1.5]) {
  test(`salvage refuses maxAttempts ${maxAttempts}`, () => {
    expect(() => salvageJsonPrefix({ text: "[" }, { maxAttempts })).toThrow(new TypeError("maxAttempts must be a positive safe integer"));
  });
}
test("salvage with one attempt only tries the latest cut", () => {
  expect(salvageJsonPrefix({ text: '["a","b",' }, { maxAttempts: 1 })).toEqual(["a", "b"]);
  expect(salvageJsonPrefix({ text: '{"a":"b","c' }, { maxAttempts: 1 })).toBeUndefined();
});
test("salvage keeps escaped quotes inside a string", () => {
  expect(salvageJsonPrefix({ text: '["a\\"b","c' })).toEqual(['a"b']);
});
test("salvage of an unterminated string with no prior cut recovers nothing", () => {
  expect(salvageJsonPrefix({ text: '"abc' })).toBeUndefined();
});

// --- transactions ----------------------------------------------------------
function memory(initial: Record<string, unknown>, { failWrite = new Set<string>(), failRemove = new Set<string>() } = {}) {
  const state = new Map(Object.entries(initial)), log: string[] = [];
  const fileAt = (filePath: string): DurableJsonFile => ({
    read: () => state.has(filePath) ? { state: "ok", value: state.get(filePath) } : { state: "missing" },
    write: ({ value }) => { log.push(`write ${filePath}`); state.set(filePath, value); if (failWrite.has(filePath)) { failWrite.delete(filePath); throw new Error(`write ${filePath} failed`); } },
    withLock: ({ critical }) => critical(), tempPath: () => "unused", quarantine: () => false,
  });
  const remove = ({ filePath }: { filePath: string }): void => { log.push(`remove ${filePath}`); if (failRemove.has(filePath)) throw new Error(`remove ${filePath} failed`); state.delete(filePath); };
  return { state, log, fileAt, remove };
}
test("a transform returning undefined removes that file", () => {
  const m = memory({ a: 1 });
  updateDurableJsonFiles({ changes: [{ filePath: "a", transform: () => undefined }], fileAt: m.fileAt, remove: m.remove });
  expect(m.state.has("a")).toBe(false); expect(m.log).toEqual(["remove a"]);
});
test("unchanged participants are not rewritten", () => {
  const m = memory({ a: { v: 1 } });
  updateDurableJsonFiles({ changes: [{ filePath: "a", transform: value => ({ ...(value as object) }) }], fileAt: m.fileAt, remove: m.remove });
  expect(m.log).toEqual([]);
});
test("rollback removes a file the transaction newly created", () => {
  const m = memory({}, { failWrite: new Set(["b"]) });
  expect(() => updateDurableJsonFiles({ changes: [{ filePath: "b", transform: () => 2 }, { filePath: "a", transform: () => 1 }], fileAt: m.fileAt, remove: m.remove }))
    .toThrow("write b failed");
  expect(m.log).toEqual(["write a", "write b", "remove b", "remove a"]);
  expect(m.state.size).toBe(0);
});
test("rollback restores a file the transaction removed", () => {
  const m = memory({ a: 1 }, { failWrite: new Set(["b"]) });
  expect(() => updateDurableJsonFiles({ changes: [{ filePath: "a", transform: () => undefined }, { filePath: "b", transform: () => 2 }], fileAt: m.fileAt, remove: m.remove }))
    .toThrow("write b failed");
  expect(m.state.get("a")).toBe(1); expect(m.state.has("b")).toBe(false);
});
test("a rollback failure is aggregated with the original failure, and rollback continues past it", () => {
  const m = memory({ c: 3 }, { failWrite: new Set(["c"]), failRemove: new Set(["b"]) });
  let thrown: unknown;
  try {
    updateDurableJsonFiles({ changes: ["a", "b", "c"].map(filePath => ({ filePath, transform: () => `${filePath}-new` })), fileAt: m.fileAt, remove: m.remove });
  } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(AggregateError);
  expect((thrown as AggregateError).message).toBe("JSON reference rollback failed.");
  expect((thrown as AggregateError).errors.map(error => (error as Error).message)).toEqual(["write c failed", "remove b failed"]);
  expect(m.log).toEqual(["write a", "write b", "write c", "write c", "remove b", "remove a"]);
  expect(m.state.get("c")).toBe(3); expect(m.state.has("a")).toBe(false);
});
