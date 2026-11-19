import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDirectoryRelocationGate, reconcileDirectoryRelocations } from "../index.js";
import type { DirectoryRelocationRequired, DirectoryRelocationSnapshot } from "../index.js";

interface WriteRow { dir: string; created: string; identity?: string; relocation?: string; adopted?: boolean }
interface Row extends WriteRow { observed?: boolean }
function fixture(rows: Row[], dismissed: string[] = []) {
  let current: DirectoryRelocationSnapshot<Row> = { state: "ok", rows, dismissed };
  const identities = new Map<string, string>(); const classes = new Map<string, string>();
  const children = new Map<string, string[]>(); const writes: { rows: WriteRow[]; dismissed: string[] }[] = [];
  const update = vi.fn<DirectoryRelocationRequired<WriteRow, Row>["update"]>(({ change }) => {
    const next = change(current); if (next) { writes.push(next); current = { state: "ok", ...next }; }
  });
  const ports: DirectoryRelocationRequired<WriteRow, Row> = {
    read: () => current, update,
    directoryOf: ({ row }) => row.dir,
    recordedIdentityOf: ({ row }) => row.identity,
    relocationIdentityOf: ({ row }) => row.relocation,
    classifyDirectory: ({ directory }) => classes.get(directory) ?? "missing",
    eligibleClassification: "valid",
    readIdentity: ({ directory }) => identities.get(directory) ?? null,
    stamp: ({ row, identity }) => ({ ...row, relocation: identity }),
    move: ({ row, directory, identity }) => ({ dir: directory, created: row.created, relocation: identity, adopted: true }),
  };
  const listChildren = vi.fn(({ root }: { root: string }) => children.get(root) ?? []);
  const run = (searchRoots: string[] = []) => reconcileDirectoryRelocations<WriteRow, Row>(ports, { searchRoots, listChildren });
  return { ports, identities, classes, children, writes, update, listChildren, run, snapshot: () => current, replace: (next: DirectoryRelocationSnapshot<Row>) => { current = next; } };
}
const old = path.join(path.sep, "workspace", "old"); const target = path.join(path.sep, "workspace", "new"); const twin = path.join(path.sep, "workspace", "copy");
const stale: Row = { dir: old, created: "original", relocation: "same" };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function matching(f: ReturnType<typeof fixture>, directories = [target]) {
  f.children.set(path.dirname(old), directories);
  for (const dir of directories) { f.classes.set(dir, "valid"); f.identities.set(dir, "same"); }
}

test("a renamed folder keeps its card creation time and uses the host move policy", () => {
  const f = fixture([{ ...stale, identity: "same" }]); matching(f);
  expect(f.run()).toEqual({ moved: [{ from: old, to: target }], merged: [] });
  expect(f.snapshot().rows).toEqual([{ dir: target, created: "original", relocation: "same", adopted: true }]);
});

test("valid rows are stamped only when a relocation identity was never recorded", () => {
  const row = { dir: target, created: "original", identity: "same" }; const f = fixture([row]); matching(f);
  expect(f.run()).toEqual({ moved: [], merged: [] }); expect(f.snapshot().rows).toEqual([{ ...row, relocation: "same" }]);
  f.identities.set(target, "changed"); f.run(); expect(f.writes).toHaveLength(1);
  expect(f.snapshot().rows[0]!.relocation).toBe("same"); expect(f.update).toHaveBeenCalledTimes(1);
});

test("a tracked target claims the folder: stale rows merge without tombstones", () => {
  const f = fixture([stale, { dir: target, created: "newer", relocation: "same" }]); matching(f);
  expect(f.run()).toEqual({ moved: [], merged: [old] });
  expect(f.snapshot().rows).toEqual([{ dir: target, created: "newer", relocation: "same" }]); expect(f.snapshot().dismissed).toEqual([]);
});

test("extra roots are searched once each, candidates deduplicated before ambiguity", () => {
  const f = fixture([stale]); matching(f, [target, target]);
  const extra = path.join(path.sep, "elsewhere"); f.children.set(extra, [target]);
  expect(f.run([path.dirname(old), extra, extra])).toEqual({ moved: [{ from: old, to: target }], merged: [] });
  expect(f.listChildren.mock.calls.map(([input]) => input.root)).toEqual([path.dirname(old), extra, path.dirname(old), extra]);
});

test("no match and two copies leave the original row unchanged", () => {
  const f = fixture([stale]); expect(f.run()).toEqual({ moved: [], merged: [] });
  matching(f, [target, twin]); expect(f.run()).toEqual({ moved: [], merged: [] });
  expect(f.writes).toEqual([]); expect(f.snapshot().rows).toEqual([stale]);
});

test("dismissed targets cannot return, and dismissing one twin never removes ambiguity", () => {
  const f = fixture([stale], [target]); matching(f);
  expect(f.run()).toEqual({ moved: [], merged: [] }); expect(f.writes).toEqual([]);
  matching(f, [target, twin]); expect(f.run()).toEqual({ moved: [], merged: [] }); expect(f.writes).toEqual([]);
});

test("invalid original folders may retain a marker; names alone never imply identity", () => {
  const original = { dir: old, created: "original" }; const f = fixture([original]); matching(f);
  f.classes.set(old, "invalid"); expect(f.run()).toEqual({ moved: [], merged: [] });
  f.identities.set(old, "same"); expect(f.run().moved).toEqual([{ from: old, to: target }]);
});

test("recorded identity precedes relocation identity, then the original marker", () => {
  const f = fixture([{ ...stale, identity: "recorded" }]); matching(f); f.identities.set(old, "marker");
  expect(f.run().moved).toEqual([]); f.identities.set(target, "recorded");
  expect(f.run().moved).toEqual([{ from: old, to: target }]);
});

test("invalid candidates are excluded and valid tracked twins outside roots still merge", () => {
  const elsewhere = path.join(path.sep, "outside", "valid");
  const f = fixture([stale, { dir: elsewhere, created: "new", relocation: "same" }]); matching(f);
  f.classes.set(target, "invalid"); f.classes.set(elsewhere, "valid"); f.identities.set(elsewhere, "same");
  expect(f.run()).toEqual({ moved: [], merged: [old] }); expect(f.snapshot().rows.map(row => row.dir)).toEqual([elsewhere]);
});

test("locked recomputation preserves a twin and unrelated row adopted after the unlocked probe", () => {
  const f = fixture([stale]); matching(f); const unrelated = path.join(path.sep, "other");
  f.classes.set(unrelated, "valid");
  f.update.mockImplementation(({ change }) => {
    const locked: DirectoryRelocationSnapshot<Row> = { state: "ok", rows: [stale, { dir: target, created: "twin", relocation: "same" }, { dir: unrelated, created: "other" }], dismissed: [] };
    const next = change(locked); if (next) { f.writes.push(next); f.replace({ state: "ok", ...next }); }
  });
  expect(f.run()).toEqual({ moved: [], merged: [old] });
  expect(f.snapshot().rows.map(row => row.dir)).toEqual([target, unrelated]);
});

test("another writer healing before the lock causes no write or false report", () => {
  const f = fixture([stale]); matching(f);
  f.update.mockImplementation(({ change }) => {
    expect(change({ state: "ok", rows: [{ dir: target, created: "original", relocation: "same" }], dismissed: [] })).toBeNull();
  });
  expect(f.run()).toEqual({ moved: [], merged: [] }); expect(f.writes).toEqual([]);
});

test("damaged snapshots never update or quarantine, including damage observed only under lock", () => {
  const f = fixture([stale]); matching(f); f.replace({ ...f.snapshot(), state: "unreadable" });
  expect(f.run()).toEqual({ moved: [], merged: [] }); expect(f.update).not.toHaveBeenCalled();
  f.replace({ ...f.snapshot(), state: "ok" });
  f.update.mockImplementation(({ change }) => { expect(change({ ...f.snapshot(), state: "unreadable" })).toBeNull(); });
  expect(f.run()).toEqual({ moved: [], merged: [] }); expect(f.writes).toEqual([]);
});

test("claimed paths prevent two stale rows from producing duplicate cards", () => {
  const otherOld = path.join(path.dirname(old), "other-old"); const f = fixture([stale, { ...stale, dir: otherOld }]); matching(f);
  expect(f.run()).toEqual({ moved: [{ from: old, to: target }], merged: [otherOld] });
  expect(f.snapshot().rows).toHaveLength(1);
});

test("native default enumeration joins child names and unreadable roots fall back to no candidates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "directory-relocation-")); roots.push(root);
  const before = path.join(root, "before"); const after = path.join(root, "after"); fs.mkdirSync(after);
  const f = fixture([{ ...stale, dir: before }]); f.classes.set(after, "valid"); f.identities.set(after, "same");
  expect(reconcileDirectoryRelocations<WriteRow, Row>(f.ports).moved).toEqual([{ from: before, to: after }]);
  const missing = fixture([{ ...stale, dir: path.join(root, "absent", "old") }]);
  expect(reconcileDirectoryRelocations<WriteRow, Row>(missing.ports)).toEqual({ moved: [], merged: [] });
});

test("the gate compares the entire classification, rows and dismissals", () => {
  let at = 0; let classification = "missing";
  const gate = createDirectoryRelocationGate<Row>({ directoryOf: ({ row }) => row.dir, classifyDirectory: () => classification }, { now: () => at });
  const file = { rows: [stale], dismissed: [] as string[] };
  expect(gate.shouldRun({ file })).toBe(true); at += 4000; expect(gate.shouldRun({ file })).toBe(false);
  classification = "invalid"; expect(gate.shouldRun({ file })).toBe(true); expect(gate.shouldRun({ file })).toBe(false);
  classification = "valid"; expect(gate.shouldRun({ file })).toBe(true);
  expect(gate.shouldRun({ file: { ...file, dismissed: [target] } })).toBe(true);
  expect(gate.shouldRun({ file: { rows: [], dismissed: [target] } })).toBe(true);
});

test("the default idle deadline is exactly 60 seconds and restarts only on a pass", () => {
  let at = 0; const gate = createDirectoryRelocationGate<Row>({ directoryOf: ({ row }) => row.dir, classifyDirectory: () => "missing" }, { now: () => at });
  const file = { rows: [stale], dismissed: [] };
  expect(gate.shouldRun({ file })).toBe(true); at = 59_999; expect(gate.shouldRun({ file })).toBe(false);
  at = 60_000; expect(gate.shouldRun({ file })).toBe(true); at++; expect(gate.shouldRun({ file })).toBe(false);
});
