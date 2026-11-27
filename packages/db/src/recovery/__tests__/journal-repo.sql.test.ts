import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { expect, onTestFinished, test, vi } from "vitest";

import { openSqlite } from "../../__tests__/helpers.js";
import { openMemorySqliteKernel } from "../../kernel/sqlite/index.js";
import type { JournalDatabase } from "../journal-kernel.js";
import { SqliteDatabaseLedgerRepo, SqliteMigrationRunsRepo, SqliteRestorePointsRepo } from "../journal-repo.sql.js";
import { applyDatabaseJournalSchema } from "../journal-schema.js";

async function journal() {
  const db = openMemorySqliteKernel<JournalDatabase>({ open: openSqlite });
  onTestFinished(() => db.close());
  await applyDatabaseJournalSchema({ kernel: db });
  return db;
}

const at = (day: string) => `2026-09-${day}T12:00:00.000Z`;

test("the ledger applies each filter and paginates tied dates without skipping under insertion", async () => {
  const db = await journal();
  const repo = new SqliteDatabaseLedgerRepo({ db, siteId: "site-a" });
  const other = new SqliteDatabaseLedgerRepo({ db, siteId: "site-b" });
  const row = (id: string, day: string, kind = "restored", outcome = "ok") => ({ id, kind, outcome, createdAt: at(day), restorePointId: "rp-1" });
  const first = row("29", "24");
  const second = row("28", "24");
  const third = row("27", "24");
  const fourth = row("19", "23");
  for (const value of [fourth, third, first, second, row("too-old", "22"), row("too-new", "25"), row("wrong-kind", "24", "created"), row("wrong-state", "24", "restored", "failed")]) {
    await repo.append(value);
  }
  await other.append(row("foreign", "24"));
  const criteria = { kind: "restored", outcome: "ok", fromDate: "2026-09-23", toDate: "2026-09-24", limit: 2 };
  const page = await repo.query(criteria);
  expect(page.items).toEqual([first, second]);
  expect(page.nextCursor).toEqual(expect.any(String));
  await repo.append(row("new-head", "24"));
  expect(await repo.query({ ...criteria, cursor: page.nextCursor })).toEqual({ items: [third, fourth], nextCursor: null });
  expect(await repo.query({ ...criteria, toDate: "2026-09-24T11:59:59.999Z", limit: 10 })).toEqual({ items: [fourth], nextCursor: null });
  expect(await repo.query({ limit: 0 })).toEqual({ items: [], nextCursor: null });
});

test("the ledger preserves migration metadata and deduplicates repeat boot incidents", async () => {
  const db = await journal();
  const repo = new SqliteDatabaseLedgerRepo({ db, siteId: "site-a" });
  const clock = vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(at("24")));
    await repo.append({ id: "detailed", kind: "migration.completed", outcome: "ok", createdAt: at("23"),
      correlationId: "corr-1", restorePointId: "rp-2", schemaBeforeVersion: 8, schemaBeforeTag: "before",
      schemaAfterVersion: 9, schemaAfterTag: "after", driftStatus: "in-sync", detailJson: '{"source":"manual"}',
      actorWorkspaceId: "actor-ws", actorId: "actor-1", delegatedByWorkspaceId: "delegate-ws", delegatedById: "delegate-1" });
    await repo.appendInterruptedRow({ siteId: "site-a", migrationRunId: "resume-1" });
    vi.setSystemTime(new Date(at("25")));
    await repo.appendInterruptedRow({ siteId: "site-a", migrationRunId: "resume-1" });
    expect(await repo.query({ limit: 10 })).toEqual({ items: [
      { id: "interrupted-resume-1", kind: "migration.interrupted", createdAt: at("24"), restorePointId: null, outcome: "blocked_pending_recovery" },
      { id: "detailed", kind: "migration.completed", createdAt: at("23"), restorePointId: "rp-2", outcome: "ok" },
    ], nextCursor: null });
    expect(await db.run(k => k.selectFrom("database_ledger").selectAll().where("id", "=", "detailed").executeTakeFirstOrThrow())).toEqual({
      id: "detailed", site_id: "site-a", kind: "migration.completed", outcome: "ok", created_at: at("23"),
      correlation_id: "corr-1", restore_point_id: "rp-2", schema_before_version: 8, schema_before_tag: "before",
      schema_after_version: 9, schema_after_tag: "after", drift_status: "in-sync", detail_json: '{"source":"manual"}',
      actor_workspace_id: "actor-ws", actor_id: "actor-1", delegated_by_workspace_id: "delegate-ws", delegated_by_id: "delegate-1",
    });
    expect(await db.query(sql`SELECT detail_json AS detail FROM database_ledger WHERE id='interrupted-resume-1'`))
      .toEqual([{ detail: '{"migrationRunId":"resume-1"}' }]);
  } finally { clock.useRealTimers(); }
});

test("migration state updates preserve omitted fields and clear explicit nulls before resolution", async () => {
  const db = await journal();
  const repo = new SqliteMigrationRunsRepo({ db, siteId: "site-a" });
  await repo.insert({ id: "active", dialect: "postgres", status: "PLANNED", correlationId: "corr-1", createdAt: at("20"), updatedAt: at("20") });
  await repo.updateState({ id: "active", status: "VERIFYING", revisionSeqAtQuiesce: 71, quiesceIntegrity: "checked", blueTouched: true, restorePointId: "rp-2", updatedAt: at("21") });
  await repo.updateState({ id: "active", status: "SWITCHING", updatedAt: at("22") });
  const load = () => db.query(sql`SELECT dialect, status, correlation_id, revision_seq_at_quiesce, quiesce_integrity, blue_touched, restore_point_id, updated_at FROM migration_runs WHERE id='active'`);
  expect(await load()).toEqual([{ dialect: "postgres", status: "SWITCHING", correlation_id: "corr-1", revision_seq_at_quiesce: 71,
    quiesce_integrity: "checked", blue_touched: 1, restore_point_id: "rp-2", updated_at: at("22") }]);
  await repo.updateState({ id: "active", status: "VERIFYING", revisionSeqAtQuiesce: null, quiesceIntegrity: null, blueTouched: false, restorePointId: null, updatedAt: at("23") });
  expect(await load()).toEqual([{ dialect: "postgres", status: "VERIFYING", correlation_id: "corr-1", revision_seq_at_quiesce: null,
    quiesce_integrity: null, blue_touched: 0, restore_point_id: null, updated_at: at("23") }]);
  const clock = vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(at("24")));
    await repo.markResolved({ id: "active" });
    expect(await repo.findNonTerminalForSite("site-a")).toBeNull();
    expect(await load()).toEqual([{ dialect: "postgres", status: "RESTORED", correlation_id: "corr-1", revision_seq_at_quiesce: null,
      quiesce_integrity: null, blue_touched: 0, restore_point_id: null, updated_at: at("24") }]);
  } finally { clock.useRealTimers(); }
});

test("a site-scoped migration repository must not resolve another site's run", async () => {
  const db = await journal();
  const own = new SqliteMigrationRunsRepo({ db, siteId: "site-a" });
  const other = new SqliteMigrationRunsRepo({ db, siteId: "site-b" });
  await other.insert({ id: "other-run", dialect: "sqlite", status: "VERIFYING", createdAt: at("24"), updatedAt: at("24") });
  await own.updateState({ id: "other-run", status: "DONE", updatedAt: at("25") });
  expect(await other.findNonTerminalForSite("site-b")).toEqual({ id: "other-run", status: "VERIFYING" });
  await own.markResolved({ id: "other-run" });
  expect(await other.findNonTerminalForSite("site-b")).toEqual({ id: "other-run", status: "VERIFYING" });
});

function restoreRow(id: string, day: string, artifactRef?: string) {
  return { restorePointId: id, idempotencyKey: `key-${id}`, trigger: "manual", createdAt: at(day), createdBy: "owner", ...(artifactRef === undefined ? {} : { artifactRef }) };
}

test("restore-point reads round-trip optional metadata and scope idempotency keys to their site", async () => {
  const db = await journal();
  const onPruneWarning = vi.fn();
  const repo = new SqliteRestorePointsRepo({ db, siteId: "site-a", onPruneWarning });
  const other = new SqliteRestorePointsRepo({ db, siteId: "site-b", onPruneWarning });
  await other.save({ ...restoreRow("foreign", "26"), idempotencyKey: "key-legacy" });
  await repo.save(restoreRow("legacy", "23"));
  await repo.save({ ...restoreRow("rich", "24", "external://artifact-2"), costClass: "expensive", kind: "logical-dump",
    watermarkAtCapture: 25, capturedSchemaVersion: 7, capturedSchemaTag: "site-v7" });
  expect(await repo.findByIdempotencyKey("key-legacy")).toEqual({ restorePointId: "legacy", idempotencyKey: "key-legacy" });
  expect(await other.findByIdempotencyKey("key-legacy")).toEqual({ restorePointId: "foreign", idempotencyKey: "key-legacy" });
  expect(await other.findByIdempotencyKey("key-rich")).toBeNull();
  expect(await repo.list()).toEqual([
    { id: "rich", trigger: "manual", costClass: "expensive", kind: "logical-dump", watermarkAtCapture: 25, createdAt: at("24"), artifactRef: "external://artifact-2" },
    { id: "legacy", trigger: "manual", costClass: "cheap", kind: "file-snapshot", watermarkAtCapture: null, createdAt: at("23"), artifactRef: "" },
  ]);
  expect(await db.query(sql`SELECT captured_schema_version, captured_schema_tag, actor_id FROM restore_points WHERE id='rich'`))
    .toEqual([{ captured_schema_version: 7, captured_schema_tag: "site-v7", actor_id: "owner" }]);
  expect(onPruneWarning.mock.calls).toEqual([]);
});

test("pruning removes expired files and rows while keeping active, protected and foreign restore points", async () => {
  const db = await journal();
  const dir = mkdtempSync(join(tmpdir(), "jini-journal-prune-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const onPruneWarning = vi.fn();
  const repo = new SqliteRestorePointsRepo({ db, siteId: "site-a", onPruneWarning, protectedRestorePointIds: async () => new Set(["pinned"]) });
  const other = new SqliteRestorePointsRepo({ db, siteId: "site-b", onPruneWarning });
  const file = (id: string) => join(dir, `restore-point-${id}-wm4-600.db`);
  const put = async (id: string, day: string, target = repo) => {
    writeFileSync(file(id), id);
    await target.save(restoreRow(id, day, file(id)));
  };
  const migrations = new SqliteMigrationRunsRepo({ db, siteId: "site-a" });
  await migrations.insert({ id: "run", dialect: "sqlite", status: "VERIFYING", createdAt: at("21"), updatedAt: at("21") });
  await migrations.updateState({ id: "run", status: "VERIFYING", restorePointId: "running", updatedAt: at("21") });
  await put("foreign", "01", other);
  await put("pinned", "02");
  await put("running", "03");
  await put("expire", "04");
  for (const day of ["21", "22", "23", "24", "25"]) await put(`keep-${day}`, day);
  expect(existsSync(file("expire"))).toBe(false);
  expect((await repo.list()).map(row => row.id)).toEqual(["keep-25", "keep-24", "keep-23", "keep-22", "keep-21", "running", "pinned"]);
  expect((await other.list()).map(row => row.id)).toEqual(["foreign"]);
  for (const id of ["keep-25", "keep-21", "running", "pinned", "foreign"]) expect(existsSync(file(id))).toBe(true);
  expect(onPruneWarning.mock.calls).toEqual([]);
});

test("a failed unlink reports the original failure and leaves the restore-point row available for retry", async () => {
  const db = await journal();
  const dir = mkdtempSync(join(tmpdir(), "jini-journal-unlink-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const onPruneWarning = vi.fn();
  const repo = new SqliteRestorePointsRepo({ db, siteId: "site-a", onPruneWarning });
  const blockedPath = join(dir, "restore-point-blocked-wm3-150.db");
  mkdirSync(blockedPath);
  await repo.save(restoreRow("blocked", "10", blockedPath));
  for (const day of ["11", "12", "13", "14", "15"]) {
    const artifact = join(dir, `restore-point-recent-${day}-wm3-150.db`);
    writeFileSync(artifact, day);
    await repo.save(restoreRow(`recent-${day}`, day, artifact));
  }
  expect(onPruneWarning.mock.calls).toEqual([[{ error: expect.objectContaining({ code: "ERR_FS_EISDIR" }) }]]);
  expect(await repo.findByIdempotencyKey("key-blocked")).toEqual({ restorePointId: "blocked", idempotencyKey: "key-blocked" });
  expect(await repo.findByIdempotencyKey("key-recent-15")).toEqual({ restorePointId: "recent-15", idempotencyKey: "key-recent-15" });
  expect(existsSync(blockedPath)).toBe(true);
});
