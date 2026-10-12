import { expect, it } from "vitest";
import { updateDurableJsonFiles, type DurableJsonFile } from "../durable-json.js";

/** Storage port fake models locks and failures without replacing any module. */
function fixture() {
  const state = new Map<string, unknown>([["a", { path: "old", other: 1 }], ["b", { path: "old", other: 2 }]]);
  const locks = new Set<string>(); let fail = "";
  const fileAt = (name: string): DurableJsonFile => ({
    read: () => state.has(name) ? { state: "ok", value: state.get(name) } : { state: "missing" },
    write: ({ value }) => {
      expect(locks).toEqual(new Set(["a", "b", "c"]));
      state.set(name, value);
      if (fail === name) { fail = ""; throw new Error("disk full after replacement"); }
    },
    withLock: ({ critical }) => { expect(locks.has(name)).toBe(false); locks.add(name); try { return critical(); } finally { locks.delete(name); } },
    tempPath: () => "unused", quarantine: () => false,
  });
  const changes = ["b", "a", "c"].map((filePath) => ({ filePath, transform: (value: unknown) => value === undefined ? undefined : { ...(value as object), path: "new" } }));
  return { state, locks, changes, fileAt, remove: ({ filePath }: { filePath: string }) => { state.delete(filePath); }, failAt: (name: string) => { fail = name; } };
}
it("locks all participants and keeps absent profiles absent; repeat is idempotent", () => {
  const f = fixture();
  updateDurableJsonFiles(f);
  expect(f.state.get("a")).toEqual({ path: "new", other: 1 });
  expect(f.state.get("b")).toEqual({ path: "new", other: 2 });
  expect(f.state.has("c")).toBe(false); expect(f.locks.size).toBe(0);
  updateDurableJsonFiles(f);
  expect(f.state.size).toBe(2);
});
it("a failure after replacement rolls every attempted file back before unlocking", () => {
  const f = fixture(), before = [...f.state]; f.failAt("b");
  expect(() => updateDurableJsonFiles(f)).toThrow("disk full after replacement");
  expect([...f.state]).toEqual(before); expect(f.locks.size).toBe(0);
});
it("transform validation fails before any participant is written", () => {
  const f = fixture(), before = [...f.state];
  f.changes[0]!.transform = () => { throw new Error("invalid catalog"); };
  expect(() => updateDurableJsonFiles(f)).toThrow("invalid catalog");
  expect([...f.state]).toEqual(before); expect(f.locks.size).toBe(0);
});
it("duplicate physical participants are refused before acquiring locks", () => {
  const f = fixture();
  expect(() => updateDurableJsonFiles({ ...f, changes: [f.changes[0]!, f.changes[0]!] })).toThrow("Duplicate JSON transaction path");
  expect(f.locks.size).toBe(0);
});

it("unreadable input never becomes an empty profile or permits another participant to change", () => {
  const f = fixture(), before = [...f.state];
  const fileAt = (name: string): DurableJsonFile => name === "b" ? { ...f.fileAt(name), read: () => ({ state: "unreadable", text: "{broken" }) } : f.fileAt(name);
  expect(() => updateDurableJsonFiles({ ...f, fileAt })).toThrow("JSON reference is unreadable");
  expect([...f.state]).toEqual(before); expect(f.locks.size).toBe(0);
});
