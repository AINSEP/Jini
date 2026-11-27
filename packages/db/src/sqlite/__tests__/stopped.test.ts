import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, onTestFinished, test, vi } from "vitest";

import type { SqliteDb } from "@jini-ai/core/contracts/storage";

import { assertSqliteStopped, checkpointStoppedSqliteWal, inspectStoppedSqlite, type StoppedSqliteOpener } from "../stopped.js";

test("an absent WAL returns without requesting a checkpoint", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-checkpoint-wal-"));
  onTestFinished(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const file = path.join(tmp, "content.db");
  const calls: string[] = [];
  const db = {
    pragma(argument: string) {
      calls.push(argument);
      return [{ busy: 0 }];
    },
  } as unknown as Pick<SqliteDb, "pragma">;

  assert.equal(checkpointStoppedSqliteWal({ db, path: file }), undefined);
  assert.deepEqual(calls, []);
});

test("an existing WAL is checkpointed once with TRUNCATE and returns when emptied", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-checkpoint-wal-"));
  onTestFinished(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const file = path.join(tmp, "content.db");
  fs.writeFileSync(file + "-wal", "committed frames");
  const calls: string[] = [];
  const db = {
    pragma(argument: string) {
      calls.push(argument);
      fs.truncateSync(file + "-wal", 0);
      return [{ busy: 0 }];
    },
  } as unknown as Pick<SqliteDb, "pragma">;

  assert.equal(checkpointStoppedSqliteWal({ db, path: file }), undefined);
  assert.deepEqual(calls, ["wal_checkpoint(TRUNCATE)"]);
  assert.equal(fs.statSync(file + "-wal").size, 0);
});

test("a busy checkpoint is refused even when the WAL is empty", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-checkpoint-wal-"));
  onTestFinished(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const file = path.join(tmp, "content.db");
  // Keep the WAL empty so only the busy result can cause this refusal.
  fs.writeFileSync(file + "-wal", "");
  const calls: string[] = [];
  const db = {
    pragma(argument: string) {
      calls.push(argument);
      return [{ busy: 1 }];
    },
  } as unknown as Pick<SqliteDb, "pragma">;

  assert.throws(() => checkpointStoppedSqliteWal({ db, path: file }), {
    message: `Database journal could not be checkpointed: ${file}-wal. Open and stop the site, then retry.`,
  });
  assert.deepEqual(calls, ["wal_checkpoint(TRUNCATE)"]);
});

test("a non-empty WAL is refused even when the checkpoint reports no busy writer", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-checkpoint-wal-"));
  onTestFinished(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const file = path.join(tmp, "content.db");
  fs.writeFileSync(file + "-wal", "committed frames");
  const calls: string[] = [];
  const db = {
    pragma(argument: string) {
      calls.push(argument);
      return [{ busy: 0 }];
    },
  } as unknown as Pick<SqliteDb, "pragma">;

  assert.throws(() => checkpointStoppedSqliteWal({ db, path: file }), {
    message: `Database journal could not be checkpointed: ${file}-wal. Open and stop the site, then retry.`,
  });
  assert.deepEqual(calls, ["wal_checkpoint(TRUNCATE)"]);
  assert.equal(fs.readFileSync(file + "-wal", "utf8"), "committed frames");
});

function stoppedFile() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-stopped-"));
  onTestFinished(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const file = path.join(tmp, "content.db");
  const db = new Database(file);
  try { db.exec(`CREATE TABLE "odd "" table" (id INTEGER); INSERT INTO "odd "" table" VALUES (4), (5); CREATE TABLE empty (id INTEGER)`); }
  finally { db.close(); }
  return file;
}

test("stopped admission refuses a live writer, closes its probe, and re-admits after the writer stops", () => {
  const file = stoppedFile();
  const writer = new Database(file);
  const handles: Database.Database[] = [];
  const open = vi.fn<StoppedSqliteOpener>((name, options) => {
    const db = new Database(name, options);
    handles.push(db);
    return db;
  });
  try {
    writer.exec(`BEGIN IMMEDIATE; INSERT INTO "odd "" table" VALUES (6)`);
    expect(() => assertSqliteStopped({ path: file, open }))
      .toThrow(`Database is open in another process: ${file}. Stop it before moving it.`);
    expect(handles.map(db => db.open)).toEqual([false]);
    writer.exec("COMMIT");
  } finally { writer.close(); }
  fs.writeFileSync(file + "-shm", "stale index");
  assertSqliteStopped({ path: file, open });
  expect(open.mock.calls).toEqual([[file, { fileMustExist: true, timeout: 0 }], [file, { fileMustExist: true, timeout: 0 }]]);
  expect(handles.map(db => db.open)).toEqual([false, false]);
  expect(fs.existsSync(file + "-shm")).toBe(false);
  expect(JSON.parse(inspectStoppedSqlite({ path: file, open }))).toEqual([
    { name: "empty", rowCount: 0 }, { name: 'odd " table', rowCount: 3 },
  ]);
  expect(open.mock.calls[2]).toEqual([file, { readonly: true, fileMustExist: true }]);
  expect(handles.map(db => db.open)).toEqual([false, false, false]);
});

test("stopped admission propagates a non-lock error and closes the admitted probe", () => {
  const file = stoppedFile();
  const handle = new Database(file);
  const fault = Object.assign(new Error("fixture read error"), { code: "SQLITE_IOERR" });
  const original = handle.exec.bind(handle);
  handle.exec = (statement: string) => {
    if (statement === "PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; ROLLBACK;") throw fault;
    return original(statement);
  };
  try {
    assert.throws(() => assertSqliteStopped({ path: file, open: () => handle }), error => error === fault);
    expect(handle.open).toBe(false);
  } finally { if (handle.open) handle.close(); }
});

test.each(["-wal", "-shm"])("admission refuses a sidecar %s still present after the connection closes", (suffix) => {
  const file = stoppedFile();
  const handle = new Database(file);
  const close = handle.close.bind(handle);
  handle.close = () => {
    const result = close();
    fs.writeFileSync(file + suffix, "still present");
    return result;
  };
  try {
    expect(() => assertSqliteStopped({ path: file, open: () => handle }))
      .toThrow(`Database journal exists: ${file + suffix}. Stop the site and close/checkpoint its database before moving it.`);
    expect(fs.readFileSync(file + suffix, "utf8")).toBe("still present");
  } finally { if (handle.open) handle.close(); }
});

test.each(["integrity", "absent counts"] as const)("inspection rejects %s, closes, and cleans up only its own sidecar", (failure) => {
  const file = stoppedFile();
  const handle = new Database(file, { readonly: true, fileMustExist: true });
  const open = vi.fn<StoppedSqliteOpener>(() => handle);
  fs.writeFileSync(file + "-shm", "existing journal");
  const verifyIntegrity: NonNullable<NonNullable<Parameters<typeof inspectStoppedSqlite>[1]>["verifyIntegrity"]> = ({ db }, options) => {
    expect(db).toBe(handle);
    expect(options).toEqual({ includeRowCounts: true });
    fs.writeFileSync(file + "-wal", "created during inspection");
    return { ok: failure !== "integrity", mode: "integrity_check", elapsedMs: 0, generatedAt: 0,
      issues: failure === "integrity" ? [{ kind: "integrity", message: "page 7 is corrupt" }] : [] };
  };
  try {
    expect(() => inspectStoppedSqlite({ path: file, open }, { verifyIntegrity })).toThrow(failure === "integrity"
      ? "SQLite integrity_check failed for content.db: page 7 is corrupt"
      : "Build @jini-ai/db before running the stopped-site database mover.");
    expect(open.mock.calls).toEqual([[file, { readonly: true, fileMustExist: true }]]);
    expect(handle.open).toBe(false);
    expect(fs.existsSync(file + "-wal")).toBe(false);
    expect(fs.readFileSync(file + "-shm", "utf8")).toBe("existing journal");
  } finally { if (handle.open) handle.close(); }
});

test("an opener failure removes a newly created inspection artifact and preserves the original error", () => {
  const file = stoppedFile();
  const failure = new Error("could not open the database read-only");
  const open = vi.fn<StoppedSqliteOpener>((name, options) => {
    if (name !== file || options.readonly !== true || options.fileMustExist !== true) {
      throw new Error("unexpected open arguments");
    }
    fs.writeFileSync(file + "-shm", "partial native open");
    throw failure;
  });
  assert.throws(() => inspectStoppedSqlite({ path: file, open }), error => error === failure);
  expect(open.mock.calls).toEqual([[file, { readonly: true, fileMustExist: true }]]);
  expect(fs.existsSync(file + "-shm")).toBe(false);
});
