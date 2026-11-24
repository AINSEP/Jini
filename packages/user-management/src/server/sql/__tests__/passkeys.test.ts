import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { createSqlPasskeyStore } from "../passkeys.js";
import { type TestSqliteKernel, sqliteTestKernel } from "./support/sqlite-kernel.js";

const TABLE = "host_passkeys";
let k: TestSqliteKernel;
beforeEach(async () => {
  k = sqliteTestKernel();
  await k.exec(`CREATE TABLE ${TABLE} (workspace_id text NOT NULL, principal_id text NOT NULL, credential_id text NOT NULL, public_key text NOT NULL, counter integer NOT NULL, rp_id text NOT NULL, PRIMARY KEY (workspace_id, credential_id))`);
});
afterEach(() => k.close());
const make = () => createSqlPasskeyStore({ kernel: k.kernel, transactions: k.transactions, tables: { passkeys: TABLE } });
const scope = { workspaceId: "w1", principalId: "owner" };
const cred = { ...scope, id: "c1", publicKey: "pk", counter: 1, rpId: "example.test" };

test("save, list (ordered, scoped), counter bump and remove/clear", async () => {
  const store = make();
  await store.save(cred);
  await store.save({ ...cred, id: "a0", publicKey: "pk0" });
  await store.save({ ...cred, workspaceId: "w2", id: "zz" });
  assert.deepEqual((await store.list(scope)).map(c => c.id), ["a0", "c1"]);
  await store.save({ ...cred, counter: 9 });
  assert.equal((await store.list(scope)).find(c => c.id === "c1")?.counter, 9);
  await store.remove({ ...scope, principalId: "other", id: "c1" });
  assert.equal((await store.list(scope)).length, 2, "remove is principal scoped");
  await store.remove({ ...scope, id: "c1" });
  assert.deepEqual((await store.list(scope)).map(c => c.id), ["a0"]);
  await store.clear(scope);
  assert.deepEqual(await store.list(scope), []);
  assert.equal((await store.list({ workspaceId: "w2", principalId: "owner" })).length, 1);
});

test("a credential id owned by another principal, key or rp id is a conflict, not an overwrite", async () => {
  const store = make();
  await store.save(cred);
  for (const clash of [{ principalId: "thief" }, { publicKey: "other-key" }, { rpId: "evil.test" }]) {
    await assert.rejects(() => store.save({ ...cred, ...clash, counter: 77 }), /ownership conflict/);
  }
  assert.equal((await store.list(scope))[0]?.counter, 1);
});

test("every method runs inside the injected identity transaction: one lock, one statement", async () => {
  const store = make();
  await store.save(cred);
  assert.deepEqual(k.events, ["begin", "lock:identity:w1", "commit"]);
  assert.equal(k.queries.length, 1);
  k.events.length = 0; k.queries.length = 0;
  await store.list(scope);
  assert.deepEqual(k.events, ["begin", "lock:identity:w1", "commit"]);
  assert.equal(k.queries.length, 1);
});

test("list is bounded to six rows", async () => {
  const store = make();
  for (let i = 0; i < 8; i++) await store.save({ ...cred, id: `c${i}`, publicKey: `pk${i}` });
  assert.equal((await store.list(scope)).length, 6);
});
