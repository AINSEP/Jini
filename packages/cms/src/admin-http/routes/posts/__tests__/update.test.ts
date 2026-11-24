import { describe, expect, it } from "vitest";

import { postUpdateRoute } from "../update.js";
import { refusalOf } from "./write-helpers.js";
import {
  FakeConflict, FakeHookFailure, FakeNotFound, FakeValidation, FakeVersionConflict, PRINCIPAL, WORKSPACE_ID, entryStore, gatewayFixture, postErrors, raw, rejectPluginHookFailure,
  type FakeEntry,
} from "./content-write-fakes.js";

function fixture({ fail, rows = [{ id: "p1", version: 3, kind: "post", title: "hello" }] }: { fail?: Error; rows?: FakeEntry[] } = {}) {
  const gateway = gatewayFixture();
  const store = entryStore(rows);
  const updates: unknown[] = [];
  const deps = {
    ...gateway.base,
    postErrors,
    rejectPluginHookFailure,
    findPostId: store.findPostId,
    findEntry: store.findEntry,
    updateInverse: store.updateInverse,
    restoreEntry: store.restoreEntry,
    updateEntry: async (input: { workspaceId: string; id: string; actorId: string; body: unknown }) => {
      updates.push(input);
      if (fail) throw fail;
      const row = store.rows.get(input.id);
      if (!row) throw new FakeNotFound(`post '${input.id}' was not found`);
      return { post: { ...row, version: row.version + 1 } };
    },
  };
  return { gateway, store, updates, deps };
}

const run = (f: ReturnType<typeof fixture>, postId = "hello", idempotencyKey?: string) =>
  postUpdateRoute.handle({ input: { postId, body: { title: "x" }, idempotencyKey }, deps: f.deps, context: PRINCIPAL }, { signal: new AbortController().signal });

describe("posts update spec", () => {
  it("pins method, path, 200 and no spec body cap", () => {
    expect([postUpdateRoute.method, postUpdateRoute.path, postUpdateRoute.successStatus, postUpdateRoute.maxBodyBytes]).toEqual(["put", "/api/admin/v1/workspaces/:workspaceId/posts/:postId", undefined, undefined]);
  });

  it("parse reads the :postId (`?? \"\"`), the body and Idempotency-Key", () => {
    expect(postUpdateRoute.parse(raw({ postId: "a" }, { t: 1 }, { "idempotency-key": "k" }))).toEqual({ ok: true, value: { postId: "a", body: { t: 1 }, idempotencyKey: "k" } });
    expect(postUpdateRoute.parse(raw({}, null, { "idempotency-key": "" }))).toEqual({ ok: true, value: { postId: "", body: null, idempotencyKey: undefined } });
  });

  it("resolves a slug to the stable id and keys the command, inverse and update off it", async () => {
    const f = fixture();
    expect(await run(f)).toEqual({ ok: true, value: { serialized: { id: "p1", version: 4, kind: "post", title: "hello" } } });
    expect(f.updates).toEqual([{ workspaceId: WORKSPACE_ID, id: "p1", actorId: "principal-1", body: { title: "x" } }]);
    expect(f.gateway.authCalls).toEqual([{ principalId: "principal-1", permission: "content.write", workspaceId: WORKSPACE_ID, entityType: "post", entityId: "p1" }]);
    const [record] = await f.gateway.changeSets.listByWorkspace({ workspaceId: WORKSPACE_ID });
    expect(record?.summary).toBe("Update post p1");
    expect(f.gateway.drains).toEqual([1]);
  });

  it("a missing post keeps the raw param and answers the code-less 404", async () => {
    const f = fixture();
    expect(await refusalOf(() => run(f, "nope"))).toEqual({ status: 404, body: { error: "post 'nope' was not found" } });
    expect(f.gateway.drains).toEqual([]);
  });

  it("a lookup failure other than not-found is not swallowed", async () => {
    const f = fixture();
    f.deps.findPostId = async () => { throw new Error("db down"); };
    await expect(run(f)).rejects.toThrow("db down");
    expect(f.updates).toHaveLength(0);
  });

  it.each([
    ["hook", new FakeHookFailure("x"), { status: 500, body: { error: "hook refused", code: "PLUGIN_HOOK_FAILED", pluginId: "p1" } }],
    ["validation", new FakeValidation("bad"), { status: 400, body: { error: "bad", code: "VALIDATION_ERROR" } }],
    ["version conflict (before its superclass)", new FakeVersionConflict("moved"), { status: 409, body: { error: "moved", code: "VERSION_CONFLICT", currentVersion: 9 } }],
    ["slug conflict (no code)", new FakeConflict("taken"), { status: 409, body: { error: "taken" } }],
    ["not found (no code)", new FakeNotFound("gone"), { status: 404, body: { error: "gone" } }],
  ])("maps %s to its exact refusal", async (_name, error, expected) => {
    expect(await refusalOf(() => run(fixture({ fail: error })))).toEqual(expected);
  });

  it("rethrows an unmapped error unchanged", async () => {
    await expect(run(fixture({ fail: new Error("boom") }))).rejects.toThrow("boom");
  });

  it("a failed change-set insert rolls the update back through the host's restore", async () => {
    const f = fixture();
    f.gateway.changeSets.insert = async () => { throw new Error("insert failed"); };
    await expect(run(f)).rejects.toThrow("insert failed");
    expect(f.store.restored).toEqual(["p1"]);
  });

  it("a replayed Idempotency-Key answers 409 DUPLICATE_COMMAND", async () => {
    const f = fixture();
    await run(f, "p1", "k");
    expect((await refusalOf(() => run(f, "p1", "k"))).body).toMatchObject({ code: "DUPLICATE_COMMAND" });
  });

  it("fails closed without an authenticated principal", async () => {
    await expect(postUpdateRoute.handle({ input: { postId: "p1", body: {}, idempotencyKey: undefined }, deps: fixture().deps, context: undefined }, { signal: new AbortController().signal })).rejects.toThrow(/no authenticated principal/);
  });
});
