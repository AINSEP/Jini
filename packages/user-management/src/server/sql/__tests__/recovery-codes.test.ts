import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { createSqlRecoveryCodeStore } from "../recovery-codes.js";
import { type TestSqliteKernel, sqliteTestKernel } from "./support/sqlite-kernel.js";

const TABLE = "host_recovery_digests";
let k: TestSqliteKernel;
beforeEach(async () => {
  k = sqliteTestKernel();
  await k.exec(`CREATE TABLE ${TABLE} (workspace_id text NOT NULL, principal_id text NOT NULL, code_hash text NOT NULL, PRIMARY KEY (workspace_id, principal_id, code_hash))`);
});
afterEach(() => k.close());
const make = () => createSqlRecoveryCodeStore({ kernel: k.kernel, tables: { recoveryCodes: TABLE } });
const scope = { workspaceId: "w1", principalId: "owner" };

test("replace swaps the whole scoped set, contains is scoped by workspace, principal and hash", async () => {
  const store = make();
  await store.replace({ ...scope, hashes: ["a", "b"] });
  await store.replace({ workspaceId: "w2", principalId: "owner", hashes: ["a"] });
  assert.equal(await store.contains({ ...scope, hash: "a" }), true);
  assert.equal(await store.contains({ ...scope, hash: "zz" }), false);
  assert.equal(await store.contains({ ...scope, principalId: "other", hash: "a" }), false);
  await store.replace({ ...scope, hashes: ["c"] });
  assert.equal(await store.contains({ ...scope, hash: "a" }), false);
  assert.equal(await store.contains({ ...scope, hash: "c" }), true);
  assert.equal(await store.contains({ workspaceId: "w2", principalId: "owner", hash: "a" }), true);
});

test("clear removes only the scoped rows; empty replace is delete-only; query counts are fixed", async () => {
  const store = make();
  await store.replace({ ...scope, hashes: ["a"] });
  await store.replace({ workspaceId: "w2", principalId: "owner", hashes: ["x"] });
  k.queries.length = 0;
  await store.replace({ ...scope, hashes: [] });
  assert.equal(k.queries.length, 1, "empty replace runs the scoped delete only");
  assert.equal(await store.contains({ ...scope, hash: "a" }), false);
  assert.equal(await store.contains({ workspaceId: "w2", principalId: "owner", hash: "x" }), true);
  k.queries.length = 0;
  await store.replace({ ...scope, hashes: ["n"] });
  assert.equal(k.queries.length, 2, "delete then one multi-row insert");
  await store.clear(scope);
  assert.equal(await store.contains({ ...scope, hash: "n" }), false);
});

test("more than ten digests is rejected before any statement runs", async () => {
  const store = make();
  await assert.rejects(() => store.replace({ ...scope, hashes: Array.from({ length: 11 }, (_, i) => `h${i}`) }), RangeError);
  assert.deepEqual(k.queries, []);
});
