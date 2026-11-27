import { expect, it, vi } from "vitest";
import { InMemoryDatabaseIntrospectionAdapter, InMemoryDatabaseLedgerRepo, InMemoryDbOpsAdapter, InMemoryMigrationRunsRepo, InMemoryRestorePointsRepo, InMemorySiteStatusRepo } from "../repo.memory.js";

it("resolving a migration clears only the tracked run", async () => {
  const repo = new InMemoryMigrationRunsRepo();
  repo.setNonTerminal({ value: { id: "tracked", status: "running" } });
  await repo.markResolved({ id: "different" });
  expect(await repo.findNonTerminalForSite("site")).toEqual({ id: "tracked", status: "running" });
  await repo.markResolved({ id: "tracked" });
  expect(await repo.findNonTerminalForSite("site")).toBeNull();
});

const at = (day: string) => `2026-10-${day}T12:00:00Z`;
const ledgerRow = (id: string, day: string, kind = "restore", outcome = "ok") => ({
  id, kind, outcome, createdAt: at(day), restorePointId: "rp-1",
});

it("ledger queries filter each field, break timestamp ties by descending id, and continue from the last row", async () => {
  const first = ledgerRow("c", "06");
  const second = ledgerRow("b", "06");
  const third = ledgerRow("a", "06");
  const fourth = ledgerRow("older", "05");
  const initial = [second, ledgerRow("old", "04"), fourth, third, ledgerRow("new", "07"),
    ledgerRow("wrong-kind", "06", "migration"), ledgerRow("wrong-outcome", "06", "restore", "failed")];
  const repo = new InMemoryDatabaseLedgerRepo({}, { initial });
  await repo.append(first);
  expect(initial).toHaveLength(7);
  const filter = { kind: "restore", outcome: "ok", fromDate: at("05"), toDate: at("06"), limit: 2 };
  expect(await repo.query(filter)).toEqual({ items: [first, second], nextCursor: "b" });
  expect(await repo.query({ ...filter, cursor: "b" })).toEqual({ items: [third, fourth], nextCursor: null });
  expect(await repo.query({ ...filter, cursor: "missing" })).toEqual({ items: [first, second], nextCursor: "b" });
  expect((await repo.query({ limit: 1 })).items).toEqual([ledgerRow("new", "07")]);
});

it("interrupted migration rows use the original incident timestamp after repeat boot", async () => {
  const now = vi.fn().mockReturnValueOnce(at("06")).mockReturnValueOnce(at("07"));
  const repo = new InMemoryDatabaseLedgerRepo({}, { now });
  await repo.appendInterruptedRow({ siteId: "site", migrationRunId: "r-1" });
  await repo.appendInterruptedRow({ siteId: "site", migrationRunId: "r-1" });
  await repo.appendInterruptedRow({ siteId: "site", migrationRunId: "r-2" });
  expect(await repo.query({ limit: 10 })).toEqual({ items: [
    { id: "interrupted-r-2", kind: "migration.interrupted", createdAt: at("07"), restorePointId: null, outcome: "blocked_pending_recovery" },
    { id: "interrupted-r-1", kind: "migration.interrupted", createdAt: at("06"), restorePointId: null, outcome: "blocked_pending_recovery" },
  ], nextCursor: null });
});

it("the default ledger clock supplies a timestamp without a host clock", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(at("06")));
    const repo = new InMemoryDatabaseLedgerRepo();
    await repo.appendInterruptedRow({ siteId: "site", migrationRunId: "r-1" });
    expect(await repo.query({ limit: 1 })).toEqual({ items: [
      { id: "interrupted-r-1", kind: "migration.interrupted", createdAt: "2026-10-06T12:00:00.000Z", restorePointId: null, outcome: "blocked_pending_recovery" },
    ], nextCursor: null });
  } finally { vi.useRealTimers(); }
});

it("restore-point listing preserves stored metadata, fills legacy defaults and looks up idempotency keys", async () => {
  const repo = new InMemoryRestorePointsRepo();
  await repo.save({ restorePointId: "rich", idempotencyKey: "key-rich", trigger: "pre-migration", createdBy: "operator", createdAt: at("07"),
    costClass: "expensive", kind: "logical-dump", artifactRef: "external://dump", watermarkAtCapture: 19 });
  await repo.save({ restorePointId: "legacy", idempotencyKey: "key-old", trigger: "manual", createdBy: "operator", createdAt: at("06") });
  expect(await repo.findByIdempotencyKey("key-old")).toEqual({ restorePointId: "legacy", idempotencyKey: "key-old" });
  expect(await repo.findByIdempotencyKey("legacy")).toBeNull();
  expect(await repo.list()).toEqual([
    { id: "rich", trigger: "pre-migration", costClass: "expensive", kind: "logical-dump", artifactRef: "external://dump", watermarkAtCapture: 19, createdAt: at("07") },
    { id: "legacy", trigger: "manual", costClass: "cheap", kind: "file-snapshot", artifactRef: "memory://restore-point/legacy", watermarkAtCapture: null, createdAt: at("06") },
  ]);
});

it("the site status starts serving and preserves the replacement status", async () => {
  const repo = new InMemorySiteStatusRepo();
  expect(await repo.get("site")).toBe("SERVING");
  await repo.set("site", "BLOCKED_PENDING_RECOVERY");
  expect(await repo.get("site")).toBe("BLOCKED_PENDING_RECOVERY");
  expect(await new InMemorySiteStatusRepo().get("site")).toBe("SERVING");
});

it("the memory database adapter uses unique increasing watermarks and never asks for a restart", async () => {
  const db = new InMemoryDbOpsAdapter();
  expect(await db.getCapabilities()).toEqual({ restorePoint: { costClass: "cheap", kind: "file-snapshot" } });
  const first = await db.captureRestorePoint({ scopeId: "site-a" });
  const second = await db.captureRestorePoint({ scopeId: "site-b" });
  expect(first).toEqual({ artifactRef: "memory://restore-point/site-a/1", watermarkAtCapture: 1 });
  expect(second).toEqual({ artifactRef: "memory://restore-point/site-b/2", watermarkAtCapture: 2 });
  expect(await db.restoreFromArtifact({ artifactRef: first.artifactRef })).toEqual({ restartRequired: false });
});

it("memory introspection reports an in-sync version-zero site and no pending migrations", async () => {
  const inspector = new InMemoryDatabaseIntrospectionAdapter();
  expect(await inspector.getHealth()).toEqual({ canOpenDb: true, migrationsTableReadable: true, driftStatus: "in-sync" });
  expect(await inspector.getSchemaState()).toEqual({ status: "in-sync", siteMeta: { version: 0, tag: "memory" }, runtime: { version: 0, tag: "memory" } });
  expect(await inspector.listPendingMigrations()).toEqual({ items: [] });
});
