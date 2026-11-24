import { describe, expect, it } from "vitest";

import { DuplicateCommandError } from "../../../../core/commands/command.js";
import { postCreateRoute } from "../create.js";
import { refusalOf } from "./write-helpers.js";
import { FakeConflict, FakeHookFailure, FakeValidation, PRINCIPAL, WORKSPACE_ID, gatewayFixture, postErrors, raw, rejectPluginHookFailure } from "./content-write-fakes.js";

function fixture({ allow = true, fail }: { allow?: boolean; fail?: Error } = {}) {
  const gateway = gatewayFixture({ allow });
  const created: unknown[] = [];
  const deps = {
    ...gateway.base,
    postErrors,
    rejectPluginHookFailure,
    createEntry: async (input: { workspaceId: string; id: string; actorId: string; body: unknown }) => {
      created.push(input);
      if (fail) throw fail;
      return { post: { id: input.id, version: 1 } };
    },
  };
  return { gateway, created, deps };
}

const run = (f: ReturnType<typeof fixture>, input: { body: unknown; idempotencyKey: string | undefined } = { body: { title: "Hello" }, idempotencyKey: undefined }) =>
  postCreateRoute.handle({ input, deps: f.deps, context: PRINCIPAL }, { signal: new AbortController().signal });

describe("posts create spec", () => {
  it("pins method, path, 201 and no spec body cap (the host keeps its own 1 MiB binding)", () => {
    expect([postCreateRoute.method, postCreateRoute.path, postCreateRoute.successStatus, postCreateRoute.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/posts", 201, undefined]);
  });

  it("parse forwards the body untouched and reads Idempotency-Key, an empty value as absent", () => {
    expect(postCreateRoute.parse(raw({}, { title: 7 }, { "idempotency-key": "k1" }))).toEqual({ ok: true, value: { body: { title: 7 }, idempotencyKey: "k1" } });
    expect(postCreateRoute.parse(raw({}, null, { "idempotency-key": "" }))).toEqual({ ok: true, value: { body: null, idempotencyKey: undefined } });
    expect(postCreateRoute.parse(raw({}, {}))).toEqual({ ok: true, value: { body: {}, idempotencyKey: undefined } });
  });

  it("creates through the gateway as content.write by the principal, drains, then serializes", async () => {
    const f = fixture();
    expect(await run(f)).toEqual({ ok: true, value: { serialized: { id: "id-1", version: 1 } } });
    expect(f.created).toEqual([{ workspaceId: WORKSPACE_ID, id: "id-1", actorId: "principal-1", body: { title: "Hello" } }]);
    expect(f.gateway.authCalls).toEqual([{ principalId: "principal-1", permission: "content.write", workspaceId: WORKSPACE_ID, entityType: "post", entityId: "id-1" }]);
    expect(f.gateway.drains).toEqual([1]);
    const [record] = await f.gateway.changeSets.listByWorkspace({ workspaceId: WORKSPACE_ID });
    expect(record?.summary).toBe("Create post");
    expect(JSON.stringify(record)).toContain("principal-1");
  });

  it("a denied gateway answers the 403 envelope and writes nothing", async () => {
    const f = fixture({ allow: false });
    const refusal = await refusalOf(() => run(f));
    expect(refusal.status).toBe(403);
    expect(refusal.body).toMatchObject({ code: "FORBIDDEN", details: { permission: "content.write", reason: "test_denied" } });
    expect([f.created.length, f.gateway.drains.length]).toEqual([0, 0]);
  });

  it("a replayed Idempotency-Key answers 409 DUPLICATE_COMMAND with the first change set", async () => {
    const f = fixture();
    await run(f, { body: {}, idempotencyKey: "same" });
    const refusal = await refusalOf(() => run(f, { body: {}, idempotencyKey: "same" }));
    expect(refusal.status).toBe(409);
    expect(refusal.body).toMatchObject({ code: "DUPLICATE_COMMAND", changeSetId: expect.any(String) });
    expect(f.created).toHaveLength(1);
  });

  it.each([
    ["hook", new FakeHookFailure("secret"), { status: 500, body: { error: "hook refused", code: "PLUGIN_HOOK_FAILED", pluginId: "p1" } }],
    ["validation", new FakeValidation("bad title"), { status: 400, body: { error: "bad title", code: "VALIDATION_ERROR" } }],
    ["slug conflict", new FakeConflict("taken"), { status: 409, body: { error: "taken", code: "SLUG_CONFLICT" } }],
    ["duplicate (thrown by the service)", new DuplicateCommandError({ message: "dup", changeSetId: "cs-1" }), { status: 409, body: { error: "dup", code: "DUPLICATE_COMMAND", changeSetId: "cs-1" } }],
  ])("maps %s to its exact refusal", async (_name, error, expected) => {
    expect(await refusalOf(() => run(fixture({ fail: error })))).toEqual(expected);
  });

  it("rethrows an unmapped error unchanged (the host's redacted 500)", async () => {
    await expect(run(fixture({ fail: new Error("boom") }))).rejects.toThrow("boom");
  });

  it("fails closed without an authenticated principal", async () => {
    const f = fixture();
    await expect(postCreateRoute.handle({ input: { body: {}, idempotencyKey: undefined }, deps: f.deps, context: undefined }, { signal: new AbortController().signal })).rejects.toThrow(/no authenticated principal/);
    expect(f.created).toHaveLength(0);
  });
});
