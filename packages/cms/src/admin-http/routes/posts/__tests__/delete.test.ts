import { describe, expect, it } from "vitest";

import { postDeleteRoute } from "../delete.js";
import { refusalOf } from "./write-helpers.js";
import { FakeConflict, FakeNotFound, FakeVersionConflict, PRINCIPAL, WORKSPACE_ID, entryStore, gatewayFixture, postErrors, raw } from "./content-write-fakes.js";

function fixture({ fail }: { fail?: Error } = {}) {
  const gateway = gatewayFixture();
  const store = entryStore([{ id: "p1", version: 2, kind: "post", title: "hello" }]);
  const deps = {
    ...gateway.base,
    postErrors,
    findPostId: store.findPostId,
    findEntry: store.findEntry,
    restoreEntry: store.restoreEntry,
    trashEntry: async ({ id }: { workspaceId: string; id: string; actorId: string }) => {
      if (fail) throw fail;
      const row = store.rows.get(id);
      if (!row) throw new FakeNotFound(`post '${id}' was not found`);
      return { post: { ...row, version: row.version + 1, deletedAt: "now" } };
    },
  };
  return { gateway, store, deps };
}

const run = (f: ReturnType<typeof fixture>, postId = "hello", idempotencyKey?: string) =>
  postDeleteRoute.handle({ input: { postId, idempotencyKey }, deps: f.deps, context: PRINCIPAL }, { signal: new AbortController().signal });

describe("posts delete spec", () => {
  it("pins method, path, 200 and no body cap", () => {
    expect([postDeleteRoute.method, postDeleteRoute.path, postDeleteRoute.successStatus, postDeleteRoute.maxBodyBytes]).toEqual(["delete", "/api/admin/v1/workspaces/:workspaceId/posts/:postId", undefined, undefined]);
  });

  it("parse reads the :postId (`?? \"\"`) and Idempotency-Key", () => {
    expect(postDeleteRoute.parse(raw({ postId: "a" }, undefined, { "idempotency-key": "k" }))).toEqual({ ok: true, value: { postId: "a", idempotencyKey: "k" } });
    expect(postDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { postId: "", idempotencyKey: undefined } });
  });

  it("trashes the resolved post as a `delete` command whose inverse clears the marker", async () => {
    const f = fixture();
    expect(await run(f)).toEqual({ ok: true, value: { serialized: { id: "p1", version: 3, kind: "post", title: "hello", deletedAt: "now" } } });
    const [record] = await f.gateway.changeSets.listByWorkspace({ workspaceId: WORKSPACE_ID });
    expect(record?.summary).toBe("Delete post p1");
    expect(JSON.stringify(await f.gateway.changeSets.findById({ workspaceId: WORKSPACE_ID, id: record!.id }))).toContain('"deletedAt":null');
    expect(f.gateway.authCalls).toEqual([{ principalId: "principal-1", permission: "content.write", workspaceId: WORKSPACE_ID, entityType: "post", entityId: "p1" }]);
    expect(f.gateway.drains).toEqual([1]);
  });

  it.each([
    ["not found", new FakeNotFound("gone"), { status: 404, body: { error: "gone", code: "ENTRY_NOT_FOUND" } }],
    ["conflict", new FakeConflict("moved"), { status: 409, body: { error: "moved", code: "ENTRY_CONFLICT" } }],
    ["version conflict (a conflict subclass)", new FakeVersionConflict("moved"), { status: 409, body: { error: "moved", code: "ENTRY_CONFLICT" } }],
  ])("maps %s to its exact refusal", async (_name, error, expected) => {
    expect(await refusalOf(() => run(fixture({ fail: error })))).toEqual(expected);
  });

  it("a missing post keeps the raw id and answers 404 ENTRY_NOT_FOUND", async () => {
    expect(await refusalOf(() => run(fixture(), "nope"))).toEqual({ status: 404, body: { error: "post 'nope' was not found", code: "ENTRY_NOT_FOUND" } });
  });

  it("a denied gateway answers 403 and trashes nothing", async () => {
    const f = fixture();
    f.deps.commandDeps.authorize = async () => ({ allowed: false, reason: "test_denied" });
    expect((await refusalOf(() => run(f))).body).toMatchObject({ code: "FORBIDDEN", details: { permission: "content.write", reason: "test_denied" } });
    expect(f.store.rows.get("p1")?.version).toBe(2);
  });

  it("a failed change-set insert restores the prior post; unmapped errors rethrow", async () => {
    const f = fixture();
    f.gateway.changeSets.insert = async () => { throw new Error("insert failed"); };
    await expect(run(f)).rejects.toThrow("insert failed");
    expect(f.store.restored).toEqual(["p1"]);
    await expect(run(fixture({ fail: new Error("boom") }))).rejects.toThrow("boom");
  });
});
