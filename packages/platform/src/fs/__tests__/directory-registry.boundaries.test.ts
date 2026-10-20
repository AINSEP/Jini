import { describe, expect, it } from "vitest";
import { createDirectoryRegistry, type DirectoryRecord } from "../directory-registry.js";
import type { DurableJsonFile, JsonFileRead } from "../durable-json.js";

type Fake = { file: DurableJsonFile; writes: unknown[]; locks: number; set(read: JsonFileRead): void; beforeCritical?: () => void };
function fakeFile(initial: JsonFileRead): Fake {
  let current = initial;
  const fake: Fake = {
    writes: [], locks: 0,
    set(read) { current = read; },
    file: {
      read: () => current,
      tempPath: () => "unused.tmp",
      write: ({ value }) => { fake.writes.push(value); current = { state: "ok", value: structuredClone(value) }; },
      quarantine: () => false,
      withLock: ({ critical }) => { fake.locks += 1; fake.beforeCritical?.(); return critical(); },
    },
  };
  return fake;
}
const row = (id: string, dir: string, extra: Partial<DirectoryRecord> = {}): DirectoryRecord => ({ id, name: id, path: dir, createdBy: "Web", lastOpened: null, ...extra });
const state = (entries: DirectoryRecord[], migrations: string[] = []): JsonFileRead => ({ state: "ok", value: { version: 1, entries, migrations } });
// Canonicalization stub: "/alias/..." is a symlink alias of "/real/...".
const canonicalPath = ({ path }: { path: string }) => path.replace(/^\/alias(?=\/|$)/, "/real");
const registryOver = (fake: Fake, options?: Parameters<typeof createDirectoryRegistry>[1]) => createDirectoryRegistry({ file: fake.file, canonicalPath }, options);

describe("registry read fails closed", () => {
  it("treats a missing file as an empty catalog", () => {
    expect(registryOver(fakeFile({ state: "missing" })).list({})).toEqual([]);
  });
  it("reports no migrations for a missing file", () => {
    expect(registryOver(fakeFile({ state: "missing" })).migrations({})).toEqual([]);
  });
  it("refuses an unreadable file", () => {
    expect(() => registryOver(fakeFile({ state: "unreadable", text: "torn" })).list({})).toThrow(new Error("The shared directory registry is unreadable; nothing was overwritten."));
  });
  it("refuses to mutate over an unreadable file and writes nothing", () => {
    const fake = fakeFile({ state: "unreadable" });
    expect(() => registryOver(fake).remove({ path: "/x" })).toThrow(new Error("The shared directory registry is unreadable; nothing was overwritten."));
    expect(fake.writes).toEqual([]);
  });
  const invalid: Array<[string, unknown]> = [
    ["null", null],
    ["a non-object", 7],
    ["a wrong version", { version: 2, entries: [], migrations: [] }],
    ["non-array entries", { version: 1, entries: {}, migrations: [] }],
    ["non-array migrations", { version: 1, entries: [], migrations: "mru" }],
    ["a non-string migration", { version: 1, entries: [], migrations: [1] }],
    ["a null entry", { version: 1, entries: [null], migrations: [] }],
    ["a non-object entry", { version: 1, entries: ["row"], migrations: [] }],
    ["an empty id", { version: 1, entries: [row("", "/a")], migrations: [] }],
    ["a missing name", { version: 1, entries: [{ id: "a", path: "/a", createdBy: "Web", lastOpened: null }], migrations: [] }],
    ["an empty path", { version: 1, entries: [row("a", "")], migrations: [] }],
    ["an empty creator", { version: 1, entries: [row("a", "/a", { createdBy: "" })], migrations: [] }],
    ["an unparseable lastOpened", { version: 1, entries: [{ ...row("a", "/a"), lastOpened: "yesterday" }], migrations: [] }],
    ["a numeric lastOpened", { version: 1, entries: [{ ...row("a", "/a"), lastOpened: 5 }], migrations: [] }],
    ["an undefined lastOpened", { version: 1, entries: [{ id: "a", name: "a", path: "/a", createdBy: "Web" }], migrations: [] }],
  ];
  for (const [label, value] of invalid) {
    it(`refuses ${label}`, () => {
      expect(() => registryOver(fakeFile({ state: "ok", value })).list({})).toThrow(new Error("The shared directory registry has an invalid format; nothing was overwritten."));
    });
  }
  it("accepts a valid ISO lastOpened", () => {
    const entries = [row("a", "/a", { lastOpened: "2026-10-08T00:00:00.000Z" })];
    expect(registryOver(fakeFile(state(entries))).list({})).toEqual(entries);
  });
});

describe("registry queries", () => {
  it("answers hasMigration true for a recorded migration", () => {
    expect(registryOver(fakeFile(state([], ["mru"]))).hasMigration({ migration: "mru" })).toBe(true);
  });
  it("answers hasMigration false for an unrecorded migration", () => {
    expect(registryOver(fakeFile(state([], ["mru"]))).hasMigration({ migration: "other" })).toBe(false);
  });
  it("lists the recorded migrations", () => {
    expect(registryOver(fakeFile(state([], ["a", "b"]))).migrations({})).toEqual(["a", "b"]);
  });
});

describe("registry list with host admission", () => {
  const discard = ({ entry }: { entry: DirectoryRecord }) => entry.id.startsWith("temp-");
  it("returns entries without locking when no discard policy is configured", () => {
    const fake = fakeFile(state([row("temp-1", "/t")]));
    expect(registryOver(fake).list({})).toEqual([row("temp-1", "/t")]);
    expect(fake.locks).toBe(0);
  });
  it("returns entries without locking when nothing is rejected", () => {
    const fake = fakeFile(state([row("keep", "/k")]));
    expect(registryOver(fake, { discard }).list({})).toEqual([row("keep", "/k")]);
    expect(fake.locks).toBe(0);
  });
  it("prunes rejected entries under the lock and persists the survivors", () => {
    const fake = fakeFile(state([row("keep", "/k"), row("temp-1", "/t")], ["mru"]));
    expect(registryOver(fake, { discard }).list({})).toEqual([row("keep", "/k")]);
    expect(fake.writes).toEqual([{ version: 1, entries: [row("keep", "/k")], migrations: ["mru"] }]);
  });
  it("reports the pruned entries once", () => {
    const reports: DirectoryRecord[][] = [];
    registryOver(fakeFile(state([row("keep", "/k"), row("temp-1", "/t")])), { discard, reportDiscarded: ({ entries }) => reports.push(entries) }).list({});
    expect(reports).toEqual([[row("temp-1", "/t")]]);
  });
  it("prunes without a reporter configured", () => {
    expect(registryOver(fakeFile(state([row("temp-1", "/t")])), { discard }).list({})).toEqual([]);
  });
  it("re-reads under the lock and keeps a sibling's new row", () => {
    const fake = fakeFile(state([row("temp-1", "/t")]));
    fake.beforeCritical = () => fake.set(state([row("temp-1", "/t"), row("sibling", "/s")]));
    expect(registryOver(fake, { discard }).list({})).toEqual([row("sibling", "/s")]);
    expect(fake.writes).toEqual([{ version: 1, entries: [row("sibling", "/s")], migrations: [] }]);
  });
  it("neither writes nor reports when a sibling already pruned before the lock", () => {
    const fake = fakeFile(state([row("temp-1", "/t")]));
    const reports: DirectoryRecord[][] = [];
    fake.beforeCritical = () => fake.set(state([row("keep", "/k")]));
    expect(registryOver(fake, { discard, reportDiscarded: ({ entries }) => reports.push(entries) }).list({})).toEqual([row("keep", "/k")]);
    expect({ writes: fake.writes, reports }).toEqual({ writes: [], reports: [] });
  });
});

describe("registry merge", () => {
  it("adds a new entry at its canonical path", () => {
    const fake = fakeFile({ state: "missing" });
    expect(registryOver(fake).merge({ entries: [row("one", "/alias/one")] })).toEqual([row("one", "/real/one")]);
    expect(fake.writes).toEqual([{ version: 1, entries: [row("one", "/real/one")], migrations: [] }]);
  });
  it("canonicalizes existing stored paths while merging", () => {
    const fake = fakeFile(state([row("old", "/alias/old")]));
    expect(registryOver(fake).merge({ entries: [] })).toEqual([row("old", "/real/old")]);
  });
  it("keeps the original identity and creator when an alias path is re-registered", () => {
    const fake = fakeFile(state([row("one", "/real/one", { createdBy: "Desktop" })]));
    expect(registryOver(fake).merge({ entries: [row("alias-id", "/alias/one", { name: "Renamed", createdBy: "Web" })] }))
      .toEqual([row("one", "/real/one", { name: "Renamed", createdBy: "Desktop" })]);
  });
  it("keeps the later lastOpened when the incoming one is older", () => {
    const fake = fakeFile(state([row("one", "/real/one", { lastOpened: "2026-10-09T00:00:00.000Z" })]));
    expect(registryOver(fake).merge({ entries: [row("one", "/real/one", { lastOpened: "2026-10-08T00:00:00.000Z" })] })[0]?.lastOpened).toBe("2026-10-09T00:00:00.000Z");
  });
  it("takes the incoming lastOpened when it is later", () => {
    const fake = fakeFile(state([row("one", "/real/one", { lastOpened: "2026-10-08T00:00:00.000Z" })]));
    expect(registryOver(fake).merge({ entries: [row("one", "/real/one", { lastOpened: "2026-10-09T00:00:00.000Z" })] })[0]?.lastOpened).toBe("2026-10-09T00:00:00.000Z");
  });
  it("compares lastOpened chronologically, not lexically", () => {
    const fake = fakeFile(state([row("one", "/real/one", { lastOpened: "2026-10-09T00:00:00.000Z" })]));
    expect(registryOver(fake).merge({ entries: [row("one", "/real/one", { lastOpened: "2026-10-09T01:00:00.000+02:00" })] })[0]?.lastOpened).toBe("2026-10-09T00:00:00.000Z");
  });
  it("keeps a stored lastOpened when the incoming one is null", () => {
    const fake = fakeFile(state([row("one", "/real/one", { lastOpened: "2026-10-08T00:00:00.000Z" })]));
    expect(registryOver(fake).merge({ entries: [row("one", "/real/one")] })[0]?.lastOpened).toBe("2026-10-08T00:00:00.000Z");
  });
  it("leaves lastOpened null when neither side has one", () => {
    const fake = fakeFile(state([row("one", "/real/one")]));
    expect(registryOver(fake).merge({ entries: [row("one", "/real/one")] })[0]?.lastOpened).toBeNull();
  });
  it("refuses an invalid incoming record and writes nothing", () => {
    const fake = fakeFile(state([]));
    expect(() => registryOver(fake).merge({ entries: [row("one", "")] })).toThrow(new Error("Cannot register an invalid directory record."));
    expect(fake.writes).toEqual([]);
  });
  it("validates an incoming record before canonicalizing its path", () => {
    const strict = ({ path }: { path: string }) => { if (!path) throw new Error("canonicalPath called with an empty path"); return path; };
    const registry = createDirectoryRegistry({ file: fakeFile({ state: "missing" }).file, canonicalPath: strict });
    expect(() => registry.merge({ entries: [row("one", "")] })).toThrow(new Error("Cannot register an invalid directory record."));
  });
  it("refuses an identity already registered at another path and writes nothing", () => {
    const fake = fakeFile(state([row("one", "/real/one")]));
    expect(() => registryOver(fake).merge({ entries: [row("one", "/real/two")] })).toThrow(new Error("Directory identity one is already registered at another path."));
    expect(fake.writes).toEqual([]);
  });
  it("refuses one identity at two paths within a single batch", () => {
    expect(() => registryOver(fakeFile({ state: "missing" })).merge({ entries: [row("one", "/a"), row("one", "/b")] })).toThrow(new Error("Directory identity one is already registered at another path."));
  });
  it("accepts the same identity at an alias of its registered path", () => {
    const fake = fakeFile(state([row("one", "/real/one")]));
    expect(registryOver(fake).merge({ entries: [row("one", "/alias/one", { name: "Again" })] })).toEqual([row("one", "/real/one", { name: "Again" })]);
  });
  it("skips an already-applied migration, returns stored entries and writes nothing", () => {
    const fake = fakeFile(state([row("one", "/alias/one")], ["mru"]));
    expect(registryOver(fake).merge({ entries: [row("two", "/two")], migration: "mru" })).toEqual([row("one", "/alias/one")]);
    expect(fake.writes).toEqual([]);
  });
  it("records a new migration and the carried migrations without duplicates", () => {
    const fake = fakeFile(state([], ["a"]));
    registryOver(fake).merge({ entries: [], migration: "c", migrations: ["a", "b"] });
    expect(fake.writes).toEqual([{ version: 1, entries: [], migrations: ["a", "b", "c"] }]);
  });
  it("does not write when the merge changes nothing", () => {
    const fake = fakeFile(state([row("one", "/real/one")]));
    registryOver(fake).merge({ entries: [row("one", "/real/one")] });
    expect(fake.writes).toEqual([]);
  });
  it("merges under exactly one lock", () => {
    const fake = fakeFile({ state: "missing" });
    registryOver(fake).merge({ entries: [row("one", "/a")] });
    expect(fake.locks).toBe(1);
  });
});

describe("registry opened", () => {
  it("refuses an unparseable timestamp without locking", () => {
    const fake = fakeFile(state([row("one", "/real/one")]));
    expect(() => registryOver(fake).opened({ path: "/real/one", at: "soon" })).toThrow(new Error("The last-opened timestamp is invalid."));
    expect(fake.locks).toBe(0);
  });
  it("stamps the entry matched through an alias path", () => {
    const fake = fakeFile(state([row("one", "/real/one"), row("two", "/real/two")]));
    registryOver(fake).opened({ path: "/alias/one", at: "2026-10-09T00:00:00.000Z" });
    expect(fake.writes).toEqual([{ version: 1, entries: [row("one", "/real/one", { lastOpened: "2026-10-09T00:00:00.000Z" }), row("two", "/real/two")], migrations: [] }]);
  });
  it("writes nothing for an unregistered path", () => {
    const fake = fakeFile(state([row("one", "/real/one")]));
    registryOver(fake).opened({ path: "/elsewhere", at: "2026-10-09T00:00:00.000Z" });
    expect(fake.writes).toEqual([]);
  });
});

describe("registry remove", () => {
  it("removes the entry matched through an alias path", () => {
    const fake = fakeFile(state([row("one", "/real/one"), row("two", "/real/two")]));
    registryOver(fake).remove({ path: "/alias/one" });
    expect(fake.writes).toEqual([{ version: 1, entries: [row("two", "/real/two")], migrations: [] }]);
  });
  it("writes nothing for an unregistered path", () => {
    const fake = fakeFile(state([row("one", "/real/one")]));
    registryOver(fake).remove({ path: "/elsewhere" });
    expect(fake.writes).toEqual([]);
  });
});

describe("registry relocate", () => {
  it("moves the source entry to the canonical target", () => {
    const fake = fakeFile(state([row("one", "/real/one", { createdBy: "Desktop" })]));
    registryOver(fake).relocate({ from: "/alias/one", to: "/alias/moved" });
    expect(fake.writes).toEqual([{ version: 1, entries: [row("one", "/real/moved", { createdBy: "Desktop" })], migrations: [] }]);
  });
  it("refuses to overwrite a different registered directory and writes nothing", () => {
    const fake = fakeFile(state([row("one", "/real/one"), row("two", "/real/two")]));
    expect(() => registryOver(fake).relocate({ from: "/real/one", to: "/alias/two" })).toThrow(new Error("Relocation would overwrite a registered directory."));
    expect(fake.writes).toEqual([]);
  });
  it("allows relocating onto itself through an alias", () => {
    const fake = fakeFile(state([row("one", "/real/one")]));
    registryOver(fake).relocate({ from: "/real/one", to: "/alias/one" });
    expect(fake.writes).toEqual([]);
  });
  it("is a no-op when the source is not registered", () => {
    const fake = fakeFile(state([row("one", "/real/one")]));
    registryOver(fake).relocate({ from: "/missing", to: "/new" });
    expect(fake.writes).toEqual([]);
  });
});
