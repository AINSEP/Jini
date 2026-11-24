import assert from "node:assert/strict";
import { sql } from "kysely";
import { afterEach, beforeEach, test } from "vitest";
import { createSqlMfaStore } from "../mfa.js";
import { type TestSqliteKernel, sqliteTestKernel } from "./support/sqlite-kernel.js";

let k: TestSqliteKernel;
beforeEach(async () => {
  k = sqliteTestKernel();
  await k.exec("CREATE TABLE host_factors (workspace_id text NOT NULL, principal_id text NOT NULL, sealed_secret text NOT NULL, last_step integer NOT NULL, PRIMARY KEY (workspace_id, principal_id))");
  await k.exec("CREATE TABLE host_pending (workspace_id text NOT NULL, principal_id text NOT NULL, purpose text NOT NULL, token_hash text NOT NULL, expires_at integer NOT NULL, attempts integer NOT NULL, sealed_secret text, PRIMARY KEY (workspace_id, principal_id, purpose), UNIQUE (workspace_id, token_hash))");
  await k.exec("CREATE TABLE host_passkeys (workspace_id text NOT NULL, principal_id text NOT NULL, credential_id text NOT NULL, public_key text NOT NULL, counter integer NOT NULL, rp_id text NOT NULL, PRIMARY KEY (workspace_id, credential_id))");
});
afterEach(() => k.close());
const make = () => createSqlMfaStore({ kernel: k.kernel, transactions: k.transactions, tables: { factors: "host_factors", pending: "host_pending", passkeys: "host_passkeys" } });
const scope = { workspaceId: "a", principalId: "owner" };
const factor = { ...scope, sealedSecret: "sealed", lastStep: 100 };
const pending = { ...scope, purpose: "login" as const, tokenHash: "first", expiresAt: 1_800_000_000_000, attempts: 0 };

test("factor round-trips, is scoped by workspace and principal, and saveFactor upserts", async () => {
  const store = make();
  assert.equal(await store.factor(scope), null);
  await store.saveFactor(factor);
  assert.deepEqual(await store.factor(scope), factor);
  assert.equal(await store.factor({ ...scope, workspaceId: "b" }), null);
  assert.equal(await store.factor({ ...scope, principalId: "other" }), null);
  await store.saveFactor({ ...factor, lastStep: 101 });
  assert.equal((await store.factor(scope))?.lastStep, 101);
});

test("pending proofs: lookup by token hash per workspace, upsert per purpose, sealed secret optional", async () => {
  const store = make();
  await store.savePending(pending);
  assert.deepEqual(await store.pending({ workspaceId: "a", tokenHash: "first" }), pending);
  assert.equal(await store.pending({ workspaceId: "b", tokenHash: "first" }), null);
  await store.savePending({ ...pending, tokenHash: "second", attempts: 1 });
  assert.equal(await store.pending({ workspaceId: "a", tokenHash: "first" }), null);
  assert.equal((await store.pending({ workspaceId: "a", tokenHash: "second" }))?.attempts, 1);
  await store.savePending({ ...pending, purpose: "enroll", tokenHash: "enroll", sealedSecret: "pending-sealed" });
  assert.equal((await store.pending({ workspaceId: "a", tokenHash: "enroll" }))?.sealedSecret, "pending-sealed");
});

test("clearPending leaves factors; clear removes pending, passkeys and the factor for the scope only", async () => {
  const store = make();
  await store.saveFactor(factor);
  await store.saveFactor({ ...factor, workspaceId: "b" });
  await store.savePending(pending);
  await store.savePending({ ...pending, workspaceId: "b" });
  await k.kernel.run(async db => { await sql.raw("INSERT INTO host_passkeys VALUES ('a','owner','c1','pk',1,'rp'),('b','owner','c2','pk',1,'rp')").execute(db); });
  await store.clearPending(scope);
  assert.equal(await store.pending({ workspaceId: "a", tokenHash: "first" }), null);
  assert.ok(await store.factor(scope));
  k.queries.length = 0;
  await store.clear(scope);
  assert.equal(k.queries.length, 3, "pending, passkeys, factor deletes");
  assert.equal(await store.factor(scope), null);
  const left = await k.kernel.run(async db => (await sql.raw<{ workspace_id: string }>("SELECT workspace_id FROM host_passkeys").execute(db)).rows);
  assert.deepEqual(left, [{ workspace_id: "b" }]);
  assert.ok(await store.factor({ ...scope, workspaceId: "b" }));
  assert.ok(await store.pending({ workspaceId: "b", tokenHash: "first" }));
});

test("every call joins the injected identity transaction and rolls back with it", async () => {
  const store = make();
  await store.saveFactor(factor);
  assert.deepEqual(k.events, ["begin", "lock:identity:a", "commit"]);
  await assert.rejects(() => k.transactions.run({ workspaceId: "a", execute: async () => {
    await store.saveFactor({ ...factor, lastStep: 5 });
    throw new Error("boom");
  } }), /boom/);
  assert.equal((await store.factor(scope))?.lastStep, 100);
});
