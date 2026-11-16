import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onTestFinished, test } from "vitest";

import type { SqliteClient } from "../types.js";

import { checkpointStoppedSqliteWal } from "../stopped.js";

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
  } as unknown as Pick<SqliteClient, "pragma">;

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
  } as unknown as Pick<SqliteClient, "pragma">;

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
  } as unknown as Pick<SqliteClient, "pragma">;

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
  } as unknown as Pick<SqliteClient, "pragma">;

  assert.throws(() => checkpointStoppedSqliteWal({ db, path: file }), {
    message: `Database journal could not be checkpointed: ${file}-wal. Open and stop the site, then retry.`,
  });
  assert.deepEqual(calls, ["wal_checkpoint(TRUNCATE)"]);
  assert.equal(fs.readFileSync(file + "-wal", "utf8"), "committed frames");
});
