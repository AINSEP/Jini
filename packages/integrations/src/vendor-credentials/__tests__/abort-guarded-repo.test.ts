import assert from "node:assert/strict";
import { test } from "vitest";

import { abortGuardedCredentialRepo } from "../abort-guarded-repo.js";

function recordingRepo(calls: string[]) {
  const vault = { put: () => calls.push("vault.put"), applyBatch: () => calls.push("vault.applyBatch"), get: () => calls.push("vault.get"), name: "vault" };
  return { vault, insert: () => calls.push("insert"), update: () => calls.push("update"), get: () => calls.push("get"), delete: () => calls.push("delete"), label: "repo" };
}

test("an aborted signal refuses insert, update and the vault's put/applyBatch before they reach the repo", () => {
  const calls: string[] = [];
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const guarded = abortGuardedCredentialRepo({ store: recordingRepo(calls) as never, signal: controller.signal }) as ReturnType<typeof recordingRepo>;
  assert.throws(() => guarded.insert(), /cancelled/);
  assert.throws(() => guarded.update(), /cancelled/);
  assert.throws(() => guarded.vault.put(), /cancelled/);
  assert.throws(() => guarded.vault.applyBatch(), /cancelled/);
  assert.deepEqual(calls, []);
});

test("reads, deletes and non-function members pass straight through even after abort", () => {
  const calls: string[] = [];
  const controller = new AbortController();
  controller.abort();
  const guarded = abortGuardedCredentialRepo({ store: recordingRepo(calls) as never, signal: controller.signal }) as ReturnType<typeof recordingRepo>;
  guarded.get();
  guarded.delete();
  guarded.vault.get();
  assert.equal(guarded.label, "repo");
  assert.equal(guarded.vault.name, "vault");
  assert.deepEqual(calls, ["get", "delete", "vault.get"]);
});

test("a live signal lets every write through", () => {
  const calls: string[] = [];
  const guarded = abortGuardedCredentialRepo({ store: recordingRepo(calls) as never, signal: new AbortController().signal }) as ReturnType<typeof recordingRepo>;
  guarded.insert();
  guarded.update();
  guarded.vault.put();
  guarded.vault.applyBatch();
  assert.deepEqual(calls, ["insert", "update", "vault.put", "vault.applyBatch"]);
});

test("the project half's repo, createRepo and replaceRepo are guarded alike", () => {
  const calls: string[] = [];
  const controller = new AbortController();
  const store = { ...recordingRepo(calls), project: { workspaceId: "ws-p", repo: recordingRepo(calls), createRepo: recordingRepo(calls), replaceRepo: recordingRepo(calls) } };
  const guarded = abortGuardedCredentialRepo({ store: store as never, signal: controller.signal }) as typeof store;
  controller.abort(new Error("stop"));
  assert.throws(() => guarded.project.repo.insert(), /stop/);
  assert.throws(() => guarded.project.createRepo.vault.put(), /stop/);
  assert.throws(() => guarded.project.replaceRepo.update(), /stop/);
  assert.equal(guarded.project.workspaceId, "ws-p");
  assert.deepEqual(calls, []);
});
