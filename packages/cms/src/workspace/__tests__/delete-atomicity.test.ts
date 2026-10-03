import assert from "node:assert/strict";
import { test } from "vitest";
import { WorkspaceLastRemainingError, type WorkspaceRepoPort } from "../create.js";
import { deleteWorkspace } from "../delete.js";
import { InMemoryWorkspaceRepo } from "../repo.memory.js";

const rows = [
  { id: "first", name: "First", slug: "first", createdAt: "t0" },
  { id: "second", name: "Second", slug: "second", createdAt: "t0" },
];

test("concurrent deletions preserve the last workspace even when list yields", async () => {
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: rows });
  const list = repo.list.bind(repo);
  repo.list = async () => {
    const snapshot = await list();
    await Promise.resolve();
    return snapshot;
  };
  const results = await Promise.allSettled(rows.map(({ id }) => deleteWorkspace({ deps: { repo, transaction: repo.transaction.bind(repo) }, input: { id } })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof WorkspaceLastRemainingError);
  assert.equal((await repo.list()).length, 1);
});

test("an injected transaction encloses the existence check, count and delete", async () => {
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: rows });
  let inside = false;
  const calls: string[] = [];
  const findById = repo.findById.bind(repo);
  const list = repo.list.bind(repo);
  const remove = repo.delete.bind(repo);
  repo.findById = async required => { assert.equal(inside, true); calls.push("findById"); return findById(required); };
  repo.list = async () => { assert.equal(inside, true); calls.push("list"); return list(); };
  repo.delete = async required => { assert.equal(inside, true); calls.push("delete"); return remove(required); };
  await deleteWorkspace({ deps: { repo, transaction: async ({ fn }) => {
    inside = true;
    try { return await fn(); } finally { inside = false; }
  } }, input: { id: "first" } });
  assert.deepEqual(calls, ["findById", "list", "delete"]);
});

// REGRESSION: fails if deleteWorkspace again falls back to a repo transaction.
test("workspace deletion requires an explicitly bound transaction even when the repo has one", async () => {
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: rows });
  // @ts-expect-error Deliberate JavaScript caller without the required transaction.
  await assert.rejects(deleteWorkspace({ deps: { repo }, input: { id: "first" } }),
    { message: "workspace deletion requires a transaction port" });
  assert.deepEqual(await repo.list(), rows);
});

test("the memory transaction restores its rows on failure and releases queued callers", async () => {
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: rows });
  const error = new Error("after delete");
  await assert.rejects(repo.transaction({ fn: async () => {
    await repo.delete({ id: "first" });
    throw error;
  } }), (actual) => actual === error);
  assert.deepEqual(await repo.list(), rows);
  await deleteWorkspace({ deps: { repo, transaction: repo.transaction.bind(repo) }, input: { id: "second" } });
  assert.deepEqual((await repo.list()).map((row) => row.id), ["first"]);
});
