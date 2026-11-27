import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChildRegistry } from "../supervisor-node.js";
import type { ChildRegistryStorage, ChildRegistryReport } from "../supervisor-node.js";

interface Row { key: string; pid: number }
const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "child-registry-"));
  roots.push(root);
  const registryDir = path.join(root, "instances");
  fs.mkdirSync(registryDir);
  const files = new Map<string, ReturnType<ChildRegistryStorage<Row>["read"]>>();
  const instancePath = ({ registryDir, instanceId }: { registryDir: string; instanceId: string }) => path.join(registryDir, `${instanceId}.json`);
  const legacyPath = () => path.join(root, "legacy.json");
  const writes = vi.fn(({ filePath, rows }: { filePath: string; rows: Row[] }) => {
    fs.writeFileSync(filePath, "placeholder");
    files.set(filePath, { state: "ok", rows });
  });
  const quarantine = vi.fn(() => true);
  const removeDeadFile = vi.fn();
  const processes = { isAlive: vi.fn((_input: { pid: number }) => false), isOrphan: vi.fn((_input: { pid: number }) => false), isLiveRow: vi.fn((_input: { row: Row }) => false), signal: vi.fn((_input: { pid: number; signal: NodeJS.Signals }) => {}) };
  const report = vi.fn<(event: ChildRegistryReport) => void>();
  const storage: ChildRegistryStorage<Row> = { instancePath, read: ({ filePath }) => files.get(filePath) ?? { state: "missing" }, write: writes, quarantine, removeDeadFile };
  const registry = createChildRegistry<Row>({ instanceId: "1-aa", legacyPath, parseInstanceName: ({ name }) => {
    const match = /^(\d+)-[a-f]+\.json$/.exec(name);
    return match ? { instanceId: name.slice(0, -5), ownerPid: Number(match[1]) } : null;
  }, keyOf: ({ row }) => row.key, storage, processes, report });
  const put = (id: string, rows: Row[]) => {
    const filePath = instancePath({ registryDir, instanceId: id });
    fs.writeFileSync(filePath, "placeholder");
    files.set(filePath, { state: "ok", rows });
    return filePath;
  };
  return { registry, registryDir, files, instancePath, legacyPath, writes, quarantine, removeDeadFile, processes, report, put };
}

test("read unions own, foreign and legacy files, ignoring temporary names", () => {
  const f = fixture();
  f.put("1-aa", [{ key: "own", pid: 10 }]); f.put("2-bb", [{ key: "foreign", pid: 20 }]);
  f.files.set(f.legacyPath(), { state: "ok", rows: [{ key: "legacy", pid: 30 }] });
  fs.writeFileSync(path.join(f.registryDir, "2-bb.json.2.tmp"), "partial");
  expect(f.registry.read({ registryDir: f.registryDir })).toEqual({ rows: [{ key: "own", pid: 10 }, { key: "foreign", pid: 20 }, { key: "legacy", pid: 30 }], unreadable: [] });
});

test("listing failure preserves unknown rows and still reads the legacy file", () => {
  const f = fixture();
  fs.rmSync(f.registryDir, { recursive: true }); fs.writeFileSync(f.registryDir, "not a directory");
  f.files.set(f.legacyPath(), { state: "ok", rows: [{ key: "legacy", pid: 30 }] });
  expect(f.registry.read({ registryDir: f.registryDir })).toEqual({ rows: [{ key: "legacy", pid: 30 }], unreadable: [f.registryDir] });
});

test("a missing directory is empty; unreadable files remain explicit", () => {
  const f = fixture();
  const filePath = f.put("2-bb", []); f.files.set(filePath, { state: "unreadable" });
  expect(f.registry.read({ registryDir: f.registryDir })).toEqual({ rows: [], unreadable: [filePath] });
  fs.rmSync(f.registryDir, { recursive: true });
  expect(f.registry.read({ registryDir: f.registryDir })).toEqual({ rows: [], unreadable: [] });
});

test("open retains a live same-key row, replaces dead rows, and close respects pid", () => {
  const f = fixture();
  const own = f.put("1-aa", [{ key: "a", pid: 10 }, { key: "a", pid: 11 }, { key: "b", pid: 12 }]);
  f.processes.isLiveRow.mockImplementation(({ row }: { row: Row }) => row.pid === 10);
  f.registry.recordOpened({ registryDir: f.registryDir, row: { key: "a", pid: 20 } });
  expect(f.files.get(own)).toEqual({ state: "ok", rows: [{ key: "a", pid: 20 }, { key: "a", pid: 10 }, { key: "b", pid: 12 }] });
  f.registry.recordClosed({ registryDir: f.registryDir, key: "a" }, { pid: 20 });
  expect(f.files.get(own)).toEqual({ state: "ok", rows: [{ key: "a", pid: 10 }, { key: "b", pid: 12 }] });
  f.registry.recordClosed({ registryDir: f.registryDir, key: "a" });
  expect(f.files.get(own)).toEqual({ state: "ok", rows: [{ key: "b", pid: 12 }] });
});

test("unreadable own file must be quarantined before either write", () => {
  const f = fixture(); const own = f.put("1-aa", []);
  f.files.set(own, { state: "unreadable" }); f.quarantine.mockReturnValue(false);
  f.registry.recordOpened({ registryDir: f.registryDir, row: { key: "a", pid: 10 } });
  f.registry.recordClosed({ registryDir: f.registryDir, key: "a" });
  expect(f.writes).not.toHaveBeenCalled();
  f.quarantine.mockReturnValue(true);
  f.registry.recordOpened({ registryDir: f.registryDir, row: { key: "a", pid: 10 } });
  expect(f.files.get(own)).toEqual({ state: "ok", rows: [{ key: "a", pid: 10 }] });
});

test("reconciliation never rewrites own, foreign or legacy rows across an await", async () => {
  vi.useFakeTimers();
  const f = fixture(); const own = f.put("1-aa", [{ key: "own", pid: 10 }]);
  const foreign = f.put("2-bb", [{ key: "orphan", pid: 20 }]);
  f.files.set(f.legacyPath(), { state: "ok", rows: [{ key: "legacy", pid: 30 }] });
  f.processes.isAlive.mockImplementation(({ pid }: { pid: number }) => pid === 2 || pid === 20);
  f.processes.isLiveRow.mockReturnValue(true); f.processes.isOrphan.mockReturnValue(true);
  const work = f.registry.reconcileOrphans({ registryDir: f.registryDir });
  f.files.set(foreign, { state: "ok", rows: [{ key: "new", pid: 40 }] });
  f.processes.isAlive.mockImplementation(({ pid }: { pid: number }) => pid === 2);
  await vi.advanceTimersByTimeAsync(200); await work;
  expect(f.files.get(own)).toEqual({ state: "ok", rows: [{ key: "own", pid: 10 }] });
  expect(f.files.get(foreign)).toEqual({ state: "ok", rows: [{ key: "new", pid: 40 }] });
  expect(f.files.get(f.legacyPath())).toEqual({ state: "ok", rows: [{ key: "legacy", pid: 30 }] });
  expect(f.writes).not.toHaveBeenCalled(); expect(f.removeDeadFile).not.toHaveBeenCalled();
});

test("live owners keep unreadable files; only dead owners permit quarantine or removal", async () => {
  const f = fixture(); const live = f.put("2-bb", []); const dead = f.put("3-cc", []); const missing = f.put("4-dd", []);
  f.files.set(live, { state: "unreadable" }); f.files.set(dead, { state: "unreadable" }); f.files.set(missing, { state: "missing" });
  f.processes.isAlive.mockImplementation(({ pid }: { pid: number }) => pid === 2);
  await f.registry.reconcileOrphans({ registryDir: f.registryDir });
  expect(f.report).toHaveBeenCalledWith({ type: "live-owner-unreadable", filePath: live, ownerPid: 2 });
  expect(f.quarantine).toHaveBeenCalledTimes(1); expect(f.quarantine).toHaveBeenCalledWith({ filePath: dead });
  expect(f.removeDeadFile).toHaveBeenCalledTimes(1); expect(f.removeDeadFile).toHaveBeenCalledWith({ filePath: missing, ownerPid: 4 });
});

test("listing failure reports the directory and still reconciles legacy rows", async () => {
  const f = fixture(); fs.rmSync(f.registryDir, { recursive: true }); fs.writeFileSync(f.registryDir, "not a directory");
  f.files.set(f.legacyPath(), { state: "unreadable" });
  expect(await f.registry.reconcileOrphans({ registryDir: f.registryDir })).toEqual([]);
  expect(f.report).toHaveBeenCalledTimes(1); expect(f.report).toHaveBeenCalledWith({ type: "list-failed", registryDir: f.registryDir });
  expect(f.quarantine).toHaveBeenCalledWith({ filePath: f.legacyPath() });
});

test("a sibling open interleaved with this instance's row check is preserved", () => {
  const f = fixture(); const own = f.put("1-aa", [{ key: "a", pid: 10 }]); const sibling = f.put("2-bb", []);
  f.registry.recordOpened({ registryDir: f.registryDir, row: { key: "a", pid: 20 } }, { isLiveRow: () => {
    f.registry.recordOpened({ registryDir: f.registryDir, row: { key: "b", pid: 30 } }, { instanceId: "2-bb" });
    return false;
  } });
  expect(f.files.get(own)).toEqual({ state: "ok", rows: [{ key: "a", pid: 20 }] });
  expect(f.files.get(sibling)).toEqual({ state: "ok", rows: [{ key: "b", pid: 30 }] });
});

test("legacy orphans are reconciled but the shared file is never rewritten or removed", async () => {
  const f = fixture(); const legacy = { key: "old-host", pid: 30 }; let alive = true;
  f.files.set(f.legacyPath(), { state: "ok", rows: [legacy] });
  f.processes.isAlive.mockImplementation(() => alive); f.processes.isLiveRow.mockReturnValue(true); f.processes.isOrphan.mockReturnValue(true);
  f.processes.signal.mockImplementation(() => { alive = false; });
  expect(await f.registry.reconcileOrphans({ registryDir: f.registryDir })).toEqual([legacy]);
  expect(f.processes.signal.mock.calls).toEqual([[{ pid: 30, signal: "SIGTERM" }]]);
  expect(f.files.get(f.legacyPath())).toEqual({ state: "ok", rows: [legacy] });
  expect(f.writes).not.toHaveBeenCalled(); expect(f.removeDeadFile).not.toHaveBeenCalled();
});

test("first child registration replaces a missing own record without changing sibling ownership", () => {
  const f = fixture();
  f.put("2-bb", [{ key: "worker", pid: 20 }]);
  const own = f.instancePath({ registryDir: f.registryDir, instanceId: "1-aa" });
  expect(f.registry.read({ registryDir: f.registryDir })).toEqual({ rows: [{ key: "worker", pid: 20 }], unreadable: [] });
  f.registry.recordOpened({ registryDir: f.registryDir, row: { key: "worker", pid: 10 } });
  expect(f.writes.mock.calls).toEqual([[{ filePath: own, rows: [{ key: "worker", pid: 10 }] }]]);
  expect(f.quarantine.mock.calls).toEqual([]);
  expect(new Set(f.registry.read({ registryDir: f.registryDir }).rows.map(row => row.pid))).toEqual(new Set([10, 20]));
});

test("close uses the supplied quarantine port and cannot discard unreadable data when it refuses", () => {
  const f = fixture();
  const own = f.put("1-aa", []);
  const quarantine = vi.fn((_input: { filePath: string }) => false);
  f.files.set(own, { state: "unreadable" });
  f.registry.recordClosed({ registryDir: f.registryDir, key: "worker" }, { quarantine });
  expect(quarantine.mock.calls).toEqual([[{ filePath: own }]]);
  expect(f.quarantine.mock.calls).toEqual([]);
  expect(f.writes.mock.calls).toEqual([]);
  expect(f.registry.read({ registryDir: f.registryDir })).toEqual({ rows: [], unreadable: [own] });
});
