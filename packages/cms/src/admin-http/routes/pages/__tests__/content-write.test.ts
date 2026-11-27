import { describe, expect, it } from "vitest";

import { pageCreateRoute } from "../create.js";
import { pageDeleteRoute } from "../delete.js";
import { pageUpdateRoute } from "../update.js";
import { refusalOf } from "../../posts/__tests__/write-helpers.js";
import {
  FakeConflict, FakeHookFailure, FakeNotFound, FakeValidation, FakeVersionConflict, PRINCIPAL, WORKSPACE_ID, entryStore, gatewayFixture, postErrors, raw, rejectPluginHookFailure,
} from "../../posts/__tests__/content-write-fakes.js";

/** @file The pages create/update/delete specs: what differs from the posts ones (paths, summaries, the page-kind check, the ladders). */

const signal = new AbortController().signal;

function writeFixture({ fail }: { fail?: Error } = {}) {
  const gateway = gatewayFixture();
  const store = entryStore([{ id: "pg1", version: 1, kind: "page", title: "about" }, { id: "p1", version: 1, kind: "post", title: "hello" }]);
  const bump = async ({ id }: { id: string }) => {
    if (fail) throw fail;
    return { post: { ...store.rows.get(id)!, version: 2 } };
  };
  const deps = {
    ...gateway.base, postErrors, rejectPluginHookFailure,
    findEntry: store.findEntry, updateInverse: store.updateInverse, restoreEntry: store.restoreEntry,
    pageNotFound: ({ message }: { message: string }) => new FakeNotFound(message),
    updateEntry: bump, trashEntry: bump,
    createEntry: async ({ id }: { id: string }) => { if (fail) throw fail; return { post: { id, version: 1 } }; },
  };
  return { gateway, store, deps };
}

describe("pages write specs", () => {
  it("pin method, path, success status, no body cap, and parse the :pageId + Idempotency-Key", () => {
    expect([pageCreateRoute.method, pageCreateRoute.path, pageCreateRoute.successStatus, pageCreateRoute.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/pages", 201, undefined]);
    expect([pageUpdateRoute.method, pageUpdateRoute.path, pageUpdateRoute.successStatus]).toEqual(["put", "/api/admin/v1/workspaces/:workspaceId/pages/:pageId", undefined]);
    expect([pageDeleteRoute.method, pageDeleteRoute.path, pageDeleteRoute.successStatus]).toEqual(["delete", "/api/admin/v1/workspaces/:workspaceId/pages/:pageId", undefined]);
    expect(pageCreateRoute.parse(raw({}, { a: 1 }, { "idempotency-key": "" }))).toEqual({ ok: true, value: { body: { a: 1 }, idempotencyKey: undefined } });
    expect(pageUpdateRoute.parse(raw({}, { a: 1 }, { "idempotency-key": "k" }))).toEqual({ ok: true, value: { pageId: "", body: { a: 1 }, idempotencyKey: "k" } });
    expect(pageDeleteRoute.parse(raw({ pageId: "pg1" }))).toEqual({ ok: true, value: { pageId: "pg1", idempotencyKey: undefined } });
  });

  it("create runs a `Create page` command and answers the serialized page", async () => {
    const f = writeFixture();
    expect(await pageCreateRoute.handle({ input: { body: {}, idempotencyKey: undefined }, deps: f.deps, context: PRINCIPAL }, { signal })).toEqual({ ok: true, value: { serialized: { id: "id-1", version: 1 } } });
    expect((await f.gateway.changeSets.listByWorkspace({ workspaceId: WORKSPACE_ID }))[0]?.summary).toBe("Create page");
    expect(await refusalOf(() => pageCreateRoute.handle({ input: { body: {}, idempotencyKey: undefined }, deps: writeFixture({ fail: new FakeConflict("taken") }).deps, context: PRINCIPAL }, { signal }))).toEqual({ status: 409, body: { error: "taken", code: "SLUG_CONFLICT" } });
  });

  it("update and delete act on the raw :pageId (no slug resolution) and record their summaries", async () => {
    const f = writeFixture();
    await pageUpdateRoute.handle({ input: { pageId: "pg1", body: {}, idempotencyKey: undefined }, deps: f.deps, context: PRINCIPAL }, { signal });
    await pageDeleteRoute.handle({ input: { pageId: "pg1", idempotencyKey: undefined }, deps: f.deps, context: PRINCIPAL }, { signal });
    expect((await f.gateway.changeSets.listByWorkspace({ workspaceId: WORKSPACE_ID })).map((record) => record.summary).sort()).toEqual(["Delete page pg1", "Update page pg1"]);
    expect(f.gateway.drains).toEqual([1, 1]);
  });

  it.each([
    ["update", (deps: ReturnType<typeof writeFixture>["deps"], pageId: string) => pageUpdateRoute.handle({ input: { pageId, body: {}, idempotencyKey: undefined }, deps, context: PRINCIPAL }, { signal })],
    ["delete", (deps: ReturnType<typeof writeFixture>["deps"], pageId: string) => pageDeleteRoute.handle({ input: { pageId, idempotencyKey: undefined }, deps, context: PRINCIPAL }, { signal })],
  ])("%s: a post (or missing row) is not a page — 404 ENTRY_NOT_FOUND before any write", async (_name, run) => {
    const f = writeFixture();
    expect(await refusalOf(() => run(f.deps, "p1"))).toEqual({ status: 404, body: { error: "page 'p1' was not found", code: "ENTRY_NOT_FOUND" } });
    expect(await refusalOf(() => run(f.deps, "nope"))).toEqual({ status: 404, body: { error: "page 'nope' was not found", code: "ENTRY_NOT_FOUND" } });
    expect(f.store.rows.get("p1")?.version).toBe(1);
  });

  it.each([
    ["hook", new FakeHookFailure("x"), { status: 500, body: { error: "hook refused", code: "PLUGIN_HOOK_FAILED", pluginId: "p1" } }],
    ["validation", new FakeValidation("bad"), { status: 400, body: { error: "bad", code: "VALIDATION_ERROR" } }],
    ["version conflict", new FakeVersionConflict("moved"), { status: 409, body: { error: "moved", code: "VERSION_CONFLICT", currentVersion: 9 } }],
    ["slug conflict", new FakeConflict("taken"), { status: 409, body: { error: "taken", code: "SLUG_CONFLICT" } }],
    ["not found", new FakeNotFound("gone"), { status: 404, body: { error: "gone", code: "ENTRY_NOT_FOUND" } }],
  ])("update maps %s", async (_name, error, expected) => {
    expect(await refusalOf(() => pageUpdateRoute.handle({ input: { pageId: "pg1", body: {}, idempotencyKey: undefined }, deps: writeFixture({ fail: error }).deps, context: PRINCIPAL }, { signal }))).toEqual(expected);
  });

  it("delete maps a conflict to ENTRY_CONFLICT, runs no hook mapping, and rolls back a failed record", async () => {
    const run = (deps: ReturnType<typeof writeFixture>["deps"]) => pageDeleteRoute.handle({ input: { pageId: "pg1", idempotencyKey: undefined }, deps, context: PRINCIPAL }, { signal });
    expect(await refusalOf(() => run(writeFixture({ fail: new FakeVersionConflict("moved") }).deps))).toEqual({ status: 409, body: { error: "moved", code: "ENTRY_CONFLICT" } });
    await expect(run(writeFixture({ fail: new FakeHookFailure("x") }).deps)).rejects.toThrow("x");
    const f = writeFixture();
    f.gateway.changeSets.insert = async () => { throw new Error("insert failed"); };
    await expect(run(f.deps)).rejects.toThrow("insert failed");
    expect(f.store.restored).toEqual(["pg1"]);
  });

  it("a denied gateway answers 403; no principal fails closed", async () => {
    const f = writeFixture();
    f.deps.commandDeps.authorize = async () => ({ allowed: false, reason: "test_denied" });
    expect((await refusalOf(() => pageDeleteRoute.handle({ input: { pageId: "pg1", idempotencyKey: undefined }, deps: f.deps, context: PRINCIPAL }, { signal }))).status).toBe(403);
    await expect(pageUpdateRoute.handle({ input: { pageId: "pg1", body: {}, idempotencyKey: undefined }, deps: f.deps, context: undefined }, { signal })).rejects.toThrow(/pages admin route has no authenticated principal/);
  });
});

it("restores the original page and skips the drain when recording the updated page fails", async () => {
  const { deps, gateway, store } = writeFixture();
  const failure = new Error("change-set storage unavailable");
  const before = { id: "pg1", version: 1, kind: "page", title: "about" };
  const edits: unknown[] = [];
  deps.updateEntry = async ({ id }: { id: string }) => {
    const post = { id, version: 2, kind: "page" as const, title: "renamed" };
    store.rows.set(id, post);
    edits.push(post);
    return { post };
  };
  gateway.changeSets.insert = async () => { throw failure; };
  await expect(pageUpdateRoute.handle({
    input: { pageId: "pg1", body: { title: "renamed" }, idempotencyKey: undefined }, deps, context: PRINCIPAL,
  }, { signal })).rejects.toBe(failure);
  expect(edits).toEqual([{ id: "pg1", version: 2, kind: "page", title: "renamed" }]);
  expect(await store.findEntry({ workspaceId: WORKSPACE_ID, id: "pg1" })).toEqual(before);
  expect(gateway.drains).toEqual([]);
  expect(await gateway.changeSets.listByWorkspace({ workspaceId: WORKSPACE_ID })).toEqual([]);
});

it("compensates a real page trash write if the change-set ledger cannot record it", async () => {
  const { deps, gateway, store } = writeFixture();
  const before = { id: "pg1", kind: "page", version: 1, title: "about" };
  let trashed: unknown;
  deps.trashEntry = async ({ id }: { id: string }) => {
    const post = { id, kind: "page" as const, title: "about", version: 2, deletedAt: "2026-11-24T00:00:00Z" };
    store.rows.set(id, post);
    trashed = await store.findEntry({ workspaceId: WORKSPACE_ID, id });
    return { post };
  };
  const failure = new Error("cannot record trash change");
  gateway.changeSets.insert = async () => { throw failure; };
  await expect(pageDeleteRoute.handle({
    input: { pageId: "pg1", idempotencyKey: "trash-9" }, deps, context: PRINCIPAL,
  }, { signal })).rejects.toBe(failure);
  expect(trashed).toEqual({ ...before, version: 2, deletedAt: "2026-11-24T00:00:00Z" });
  expect(await store.findEntry({ workspaceId: WORKSPACE_ID, id: "pg1" })).toEqual(before);
  expect(gateway.drains).toEqual([]);
});
