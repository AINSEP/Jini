import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { sql } from "kysely";
import { sqliteKernel } from "../../kernel/sqlite/index.js";
import {
  createCheckedSqliteClient, SqliteClientError, withSqliteTransaction,
  type IntegerSource, type IntegerStatement, type TransactionSession,
} from "../../sqlite/index.js";

/** Native controls are injected so uncertain commits and cleanup failures are deterministic. */
function nativeFake() {
  const controls: string[] = [];
  const statements: string[] = [];
  const exactModes: boolean[] = [];
  const commitFailure = new Error("native commit failed");
  const rollbackFailure = new Error("native rollback failed");
  const state = {
    rows: [{ value: 1n }] as unknown[], changes: 1n, lastInsertRowid: 1n,
    transaction: false, commit: "ok" as "ok" | "before" | "after", failRollback: false,
    closes: 0, yielded: 0,
  };
  const database: IntegerSource = {
    memory: true, name: ":memory:",
    get inTransaction() { return state.transaction; },
    exec(source) {
      controls.push(source);
      if (source === "BEGIN IMMEDIATE") state.transaction = true;
      if (source === "COMMIT") {
        if (state.commit === "before") throw commitFailure;
        state.transaction = false;
        if (state.commit === "after") throw commitFailure;
      }
      if (source === "ROLLBACK") {
        if (state.failRollback) throw rollbackFailure;
        state.transaction = false;
      }
    },
    prepare(source): IntegerStatement {
      statements.push(source);
      return {
        reader: /^select/i.test(source),
        safeIntegers(enabled) { exactModes.push(enabled); },
        all: () => state.rows,
        run: () => ({ changes: state.changes, lastInsertRowid: state.lastInsertRowid }),
        *iterate() { for (const row of state.rows) { state.yielded++; yield row; } },
      };
    },
    pragma() {}, backup: async () => {}, close() { state.closes++; },
  };
  return { database, state, controls, statements, exactModes, commitFailure, rollbackFailure };
}

function checkedFixture() {
  const fake = nativeFake();
  const client = createCheckedSqliteClient({ database: fake.database });
  const kernel = sqliteKernel<unknown>(client);
  return { ...fake, client, kernel };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("checked SQLite integer boundary", () => {
  for (const value of [BigInt(Number.MIN_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER)]) {
    test(`decodes the exact safe boundary ${value} on every result path`, () => {
      const f = checkedFixture();
      const blob = new Uint8Array([1, 255]);
      f.state.rows = [{ value, blob, float: 1.25, missing: null }];
      f.state.changes = value;
      f.state.lastInsertRowid = value;
      const statement = f.client.prepare("select value");
      const expected = { value: Number(value), blob, float: 1.25, missing: null };
      assert.deepEqual(statement.all(), [expected]);
      assert.equal((statement.all()[0] as { blob: unknown }).blob, blob);
      assert.deepEqual([...statement.iterate()], [expected]);
      assert.deepEqual(statement.run(), { changes: Number(value), lastInsertRowid: Number(value) });
      assert.deepEqual(f.exactModes, [true]);
    });
  }

  for (const value of [BigInt(Number.MIN_SAFE_INTEGER) - 1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) {
    test(`rejects overflow ${value} in reads, iteration and both write metadata fields`, () => {
      const f = checkedFixture();
      f.state.rows = [{ value }];
      const statement = f.client.prepare("select value");
      assert.throws(() => statement.all(), /unsafe_integer/);
      assert.throws(() => [...statement.iterate()], /unsafe_integer/);
      f.state.changes = value;
      assert.throws(() => statement.run(), /unsafe_integer/);
      f.state.changes = 1n;
      f.state.lastInsertRowid = value;
      assert.throws(() => statement.run(), /unsafe_integer/);
    });
  }

  test("decodes iterators lazily, memoizes the borrowed wrapper and never closes its host", () => {
    const f = checkedFixture();
    f.state.rows = [{ value: 1n }, { value: 9007199254740992n }];
    const rows = f.client.prepare("select value").iterate();
    assert.equal(f.state.yielded, 0);
    assert.deepEqual(rows.next().value, { value: 1 });
    assert.equal(f.state.yielded, 1);
    assert.throws(() => rows.next(), /unsafe_integer/);
    assert.equal(createCheckedSqliteClient({ database: f.database }), f.client);
    f.client.close();
    assert.equal(f.state.closes, 0);
  });

  test("raw clients retain bigint results and original control failures; mixed kernel ownership is refused", async () => {
    const raw = nativeFake();
    const kernel = sqliteKernel(raw.database);
    assert.deepEqual(await kernel.query(sql`select value`), [{ value: 1n }]);
    assert.deepEqual(raw.exactModes, []);
    raw.state.commit = "before";
    await assert.rejects(kernel.transaction(async () => 1), (error) => error === raw.commitFailure);
    assert.throws(() => createCheckedSqliteClient({ database: raw.database }), /mix raw and checked/);
    const checked = checkedFixture();
    assert.throws(() => sqliteKernel(checked.database), /mix raw and checked/);
  });
});

describe("leased SQLite transactions", () => {
  for (const option of [undefined, false, true]) {
    test(`root denial identity is preserved with rollbackOnFailedOutcome=${option}`, async () => {
      const f = checkedFixture();
      const denied = { ok: false, error: "denied" };
      const result = await withSqliteTransaction({ ...f, work: async ({ session }) => {
        await session.execute({ statement: sql`update things set value = 1` });
        return denied;
      } }, option === undefined ? {} : { rollbackOnFailedOutcome: option });
      assert.equal(result, denied);
      assert.deepEqual(f.controls, ["BEGIN IMMEDIATE", option === true ? "ROLLBACK" : "COMMIT"]);
    });
  }

  test("handled nested denial joins the root and retained sessions cannot schedule SQL", async () => {
    const f = checkedFixture();
    let retained!: TransactionSession;
    const denied = { ok: false };
    const result = await withSqliteTransaction({ ...f, work: async ({ session }) => {
      retained = session;
      assert.equal(await session.transaction({ work: async () => denied }), denied);
      assert.deepEqual(await session.query({ statement: sql`select value` }), [{ value: 1 }]);
      return { ok: true };
    } }, { rollbackOnFailedOutcome: true });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(f.controls, ["BEGIN IMMEDIATE", "COMMIT"]);
    const before = f.statements.length;
    await assert.rejects(retained.query({ statement: sql`select value` }), /session_expired/);
    await assert.rejects(retained.execute({ statement: sql`delete from things` }), /session_expired/);
    await assert.rejects(retained.transaction({ work: async () => 1 }), /session_expired/);
    assert.equal(f.statements.length, before);
  });

  test("checks lifetime again for detached work inherited from an expired session", async () => {
    const f = checkedFixture();
    const release = deferred();
    let detached!: Promise<void>;
    await withSqliteTransaction({ ...f, work: async ({ session }) => {
      detached = release.promise.then(() => session.execute({ statement: sql`delete from things` }));
      return 1;
    } });
    const rejection = assert.rejects(detached, /session_expired/);
    release.resolve();
    await rejection;
    assert.deepEqual(f.statements, []);
  });

  test("rechecks lifetime inside a queued executor before it can prepare SQL", async () => {
    const f = checkedFixture();
    const release = deferred();
    const run = f.kernel.run;
    f.kernel.run = async (work) => { await release.promise; return run(work); };
    let pending!: Promise<unknown[]>;
    await withSqliteTransaction({ ...f, work: async ({ session }) => {
      pending = session.query({ statement: sql`select value` });
      return 1;
    } });
    const rejection = assert.rejects(pending, /session_expired/);
    release.resolve();
    await rejection;
    assert.deepEqual(f.statements, []);
  });

  test("rejects overlapping helpers, foreign transactions and mismatched kernels", async () => {
    const f = checkedFixture();
    const entered = deferred();
    const release = deferred();
    const running = withSqliteTransaction({ ...f, work: async () => { entered.resolve(); await release.promise; return 1; } });
    await entered.promise;
    await assert.rejects(withSqliteTransaction({ ...f, work: async () => 2 }), /transaction_busy/);
    release.resolve();
    assert.equal(await running, 1);
    await assert.rejects(f.kernel.transaction(() => withSqliteTransaction({ ...f, work: async () => 2 })), /cannot join/);
    f.database.exec("BEGIN IMMEDIATE");
    await assert.rejects(withSqliteTransaction({ ...f, work: async () => 2 }), /cannot join/);
    f.database.exec("ROLLBACK");
    await assert.rejects(withSqliteTransaction({ client: f.client, kernel: checkedFixture().kernel, work: async () => 2 }), /matching checked/);
  });

  test("a public transaction queued behind an owned one runs once the owner's turn ends", async () => {
    const f = checkedFixture();
    const entered = deferred();
    const release = deferred();
    const owned = withSqliteTransaction({ ...f, work: async () => { entered.resolve(); await release.promise; return "owned"; } });
    await entered.promise;
    const queued = f.kernel.transaction(async () => f.kernel.query(sql`select value`));
    release.resolve();
    assert.deepEqual(await Promise.allSettled([owned, queued]), [
      { status: "fulfilled", value: "owned" }, { status: "fulfilled", value: [{ value: 1 }] },
    ]);
    assert.deepEqual(f.controls, ["BEGIN IMMEDIATE", "COMMIT", "BEGIN IMMEDIATE", "COMMIT"]);
  });

  test("refuses an independently open kernel transaction without disrupting its owner", async () => {
    const f = checkedFixture();
    const entered = deferred();
    const release = deferred();
    const running = f.kernel.transaction(async () => {
      entered.resolve();
      await release.promise;
      return f.kernel.query(sql`select value`);
    });
    await entered.promise;
    await assert.rejects(withSqliteTransaction({ ...f, work: async () => 1 }), /cannot join/);
    release.resolve();
    assert.deepEqual(await running, [{ value: 1 }]);
    assert.deepEqual(f.controls, ["BEGIN IMMEDIATE", "COMMIT"]);
  });

  test("quarantines shared callers after commit fails after the native commit", async () => {
    const f = checkedFixture();
    f.state.commit = "after";
    const entered = deferred();
    const release = deferred();
    const running = withSqliteTransaction({ ...f, work: async () => { entered.resolve(); await release.promise; return 1; } });
    await entered.promise;
    const queued = assert.rejects(f.kernel.query(sql`select value`), /quarantined/);
    const failed = assert.rejects(running, (error) => error instanceof SqliteClientError && error.code === "commit_failed" && error.cause === f.commitFailure);
    release.resolve();
    await failed;
    await queued;
    assert.deepEqual(f.controls, ["BEGIN IMMEDIATE", "COMMIT"]);
    const same = createCheckedSqliteClient({ database: f.database });
    assert.throws(() => same.prepare("select value"), /quarantined/);
    assert.throws(() => same.exec("ROLLBACK"), /quarantined/);
    await assert.rejects(withSqliteTransaction({ ...f, work: async () => 2 }), /quarantined/);
    assert.equal(f.state.closes, 0);
  });

  test("a commit refused before applying and then rolled back is a known outcome, not quarantined", async () => {
    const f = checkedFixture();
    f.state.commit = "before";
    const entered = deferred();
    const release = deferred();
    const running = withSqliteTransaction({ ...f, work: async () => { entered.resolve(); await release.promise; return 1; } });
    await entered.promise;
    const queued = f.kernel.query(sql`select value`);
    release.resolve();
    await assert.rejects(running, (error) => error instanceof SqliteClientError && error.code === "commit_failed" && error.cause === f.commitFailure);
    assert.deepEqual(await queued, [{ value: 1 }]);
    assert.deepEqual(f.controls, ["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"]);
    f.state.commit = "ok";
    assert.equal(await withSqliteTransaction({ ...f, work: async () => 2 }), 2);
  });

  test("a stray ROLLBACK failing with nothing open does not quarantine the handle", () => {
    const f = checkedFixture();
    f.state.failRollback = true;
    assert.throws(() => f.client.exec("ROLLBACK"), (error) => error instanceof SqliteClientError && error.code === "rollback_failed");
    assert.deepEqual(f.client.prepare("select value").all(), [{ value: 1 }]);
  });

  test("preserves commit plus rollback failures as typed causes", async () => {
    const f = checkedFixture();
    f.state.commit = "before";
    f.state.failRollback = true;
    await assert.rejects(withSqliteTransaction({ ...f, work: async () => 1 }), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors.map((part: SqliteClientError) => [part.code, part.cause]), [
        ["commit_failed", f.commitFailure], ["rollback_failed", f.rollbackFailure],
      ]);
      return true;
    });
  });

  for (const denial of [false, true]) {
    test(`preserves ${denial ? "denial" : "body error"} together with rollback failure`, async () => {
      const f = checkedFixture();
      f.state.failRollback = true;
      const original = denial ? { ok: false } : new Error("body failed");
      await assert.rejects(withSqliteTransaction({ ...f, work: async () => {
        if (!denial) throw original;
        return original;
      } }, { rollbackOnFailedOutcome: true }), (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], original);
        assert.equal(error.errors[1].code, "rollback_failed");
        assert.equal(error.errors[1].cause, f.rollbackFailure);
        return true;
      });
      await assert.rejects(f.kernel.query(sql`select value`), /quarantined/);
    });
  }
});
