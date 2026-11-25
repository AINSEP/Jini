import { describe, expect, it } from "vitest";
import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import { createRevertRegistry } from "../../../../core/commands/appliers.js";
import { InMemoryChangeSetRepo } from "../../../../core/commands/repo.memory.js";
import { changeSetRevertRoute, type ChangeSetRevertRouteDeps } from "../revert.js";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { fakeChangeSet, fakeItem, PRINCIPAL, raw, recordingAuthorize, refusalOf, toChangeSetHeader, WORKSPACE_ID, type RecordedAuthorize } from "./helpers.js";

/** @file POST /change-sets/:changeSetId/revert over the real `revertChangeSet` service and in-memory repos. */

function setup(options: { status?: "applied" | "proposed"; current?: number | null; actor?: string | null; registered?: boolean } = {}) {
  const events: DomainEvent[] = [];
  const applied: string[] = [];
  const registry = createRevertRegistry({});
  if (options.registered !== false) {
    registry.register("post", "update", {
      currentVersion: async () => (options.current === undefined ? 2 : options.current),
      currentActor: async () => options.actor ?? null,
      applyInverse: async ({ item }) => { applied.push(item.id); },
    });
  }
  const changeSets = new InMemoryChangeSetRepo([fakeChangeSet({ status: options.status ?? "applied" })], [fakeItem()]);
  const outbox = { enqueue: async (event: DomainEvent) => { events.push(event); } } as unknown as OutboxPort;
  const deps: ChangeSetRevertRouteDeps = {
    workspaceId: WORKSPACE_ID, changeSets, revertRegistry: registry, outbox,
    clock: { nowMs: () => Date.parse("2026-10-05T00:00:00.000Z") }, idGen: { newId: () => "evt-1" }, toChangeSetHeader,
  } as ChangeSetRevertRouteDeps;
  return { deps, events, applied, changeSets };
}

const run = (deps: ChangeSetRevertRouteDeps, input: { changeSetId: string; force: boolean }, context: { id: string; kind: "user" | "agent" | "api_key" | "system" } = PRINCIPAL, authorize = recordingAuthorize().authorize) =>
  changeSetRevertRoute.handle({ input, deps, context, authorize });

describe("changeSetRevertRoute", () => {
  it("keeps the method and path, answers 200 and declares no body cap", () => {
    expect(changeSetRevertRoute.method).toBe("post");
    expect(changeSetRevertRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/change-sets/:changeSetId/revert");
    expect(changeSetRevertRoute.successStatus).toBeUndefined();
    expect(changeSetRevertRoute.maxBodyBytes).toBeUndefined();
  });

  it("reads :changeSetId (empty when missing) and forces only on a literal `true` body field", () => {
    expect(changeSetRevertRoute.parse(raw({ changeSetId: "cs-1" }, { force: true }))).toEqual({ ok: true, value: { changeSetId: "cs-1", force: true } });
    expect(changeSetRevertRoute.parse(raw({}, {}))).toEqual({ ok: true, value: { changeSetId: "", force: false } });
    for (const body of [{ force: "true" }, { force: 1 }, { force: false }, null, undefined, "force", [true]]) {
      expect(changeSetRevertRoute.parse(raw({ changeSetId: "cs-1" }, body))).toEqual({ ok: true, value: { changeSetId: "cs-1", force: false } });
    }
  });

  it("authorizes changeset.revert on that change set, reverts, and answers through the injected header DTO", async () => {
    const { deps, applied, events } = setup();
    const { authorize, calls } = recordingAuthorize();
    const result = await run(deps, { changeSetId: "cs-1", force: false }, PRINCIPAL, authorize);
    expect(calls).toEqual([{ permission: "changeset.revert", entityType: "change_set", entityId: "cs-1" }]);
    expect(result).toEqual({ ok: true, value: { changeSet: { header: "cs-1", status: "reverted" } } });
    expect(applied).toEqual(["item-1"]);
    expect(events.map((event) => event.name)).toEqual(["change-set.reverted"]);
  });

  it("does not revert anything when authorization refuses", async () => {
    const { deps, applied, events } = setup();
    const { authorize } = recordingAuthorize(["changeset.revert"]);
    await expect(run(deps, { changeSetId: "cs-1", force: false }, PRINCIPAL, authorize)).rejects.toThrow("denied changeset.revert");
    expect([applied, events]).toEqual([[], []]);
  });

  it("maps every revert error to its status, code and details, from the real service", async () => {
    const cases: Array<[string, ReturnType<typeof setup>, { changeSetId: string; force: boolean }, "user" | "agent", { status: number; body: unknown }]> = [
      ["not found", setup(), { changeSetId: "nope", force: false }, "user", { status: 404, body: { error: "change set 'nope' was not found", code: "CHANGE_SET_NOT_FOUND" } }],
      ["invalid status", setup({ status: "proposed" }), { changeSetId: "cs-1", force: false }, "user", { status: 409, body: { error: "change set 'cs-1' is 'proposed', only 'applied' can be reverted", code: "CHANGE_SET_INVALID_STATUS" } }],
      ["forbidden", setup(), { changeSetId: "cs-1", force: true }, "agent", { status: 403, body: { error: "agent principals may not force a revert past a version conflict", code: "REVERT_FORBIDDEN", details: { reason: "AGENT_CANNOT_FORCE" } } }],
      ["conflict", setup({ current: 5, actor: "editor-9" }), { changeSetId: "cs-1", force: false }, "user", {
        status: 409,
        body: {
          error: "entity 'post:post-1' changed since this change set (expected version 2, found 5, last changed by principal 'editor-9')",
          code: "REVERT_CONFLICT", details: { currentVersion: 5, currentActorId: "editor-9" },
        },
      }],
      ["missing entity", setup({ current: null }), { changeSetId: "cs-1", force: false }, "user", {
        status: 409,
        body: { error: "entity 'post:post-1' changed since this change set (expected version 2, found missing)", code: "REVERT_CONFLICT", details: { currentVersion: null, currentActorId: null } },
      }],
      ["not possible", setup({ registered: false }), { changeSetId: "cs-1", force: false }, "user", { status: 422, body: { error: "no inverse applier registered for 'post/update'", code: "REVERT_NOT_POSSIBLE" } }],
    ];
    for (const [name, fixture, input, kind, expected] of cases) {
      expect({ name, refusal: await refusalOf(() => run(fixture.deps, input, { id: "p", kind })) }).toEqual({ name, refusal: expected });
    }
  });

  it("lets a user force past a stale version (the agent-cannot-force rule is the service's, not this layer's)", async () => {
    const { deps, applied } = setup({ current: 5 });
    const result = await run(deps, { changeSetId: "cs-1", force: true }, { id: "p", kind: "user" });
    expect(result.ok).toBe(true);
    expect(applied).toEqual(["item-1"]);
  });

  it("rethrows an unmapped failure unchanged, so the host's error port answers the 500", async () => {
    const { deps } = setup();
    const broken = { ...deps, changeSets: { ...deps.changeSets, findById: async () => { throw new Error("private storage details"); } } } as unknown as ChangeSetRevertRouteDeps;
    await expect(run(broken, { changeSetId: "cs-1", force: false })).rejects.toThrow("private storage details");
  });

  it("fails closed without an authorizer or without an authenticated principal", async () => {
    const { deps } = setup();
    await expect(changeSetRevertRoute.handle({ input: { changeSetId: "cs-1", force: false }, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(changeSetRevertRoute.handle({ input: { changeSetId: "cs-1", force: false }, deps, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});

/** A change set holding one ordinary item and one item whose reverter declares a policy. */
function policySetup(options: { allowForce?: boolean; current?: number } = {}) {
  const writes: Array<{ id: string; actorId: string | undefined }> = [];
  const registry = createRevertRegistry({});
  const reverter = (extra: object) => ({
    ...extra,
    currentVersion: async () => options.current ?? 2,
    applyInverse: async ({ item }: { item: { id: string } }, second?: { actorId?: string }) => { writes.push({ id: item.id, actorId: second?.actorId }); },
  });
  registry.register("post", "update", reverter({}));
  registry.register("raw-doc", "update", reverter({ policy: { permission: "documents.write_raw", authorizationEntityType: "document", ...(options.allowForce === undefined ? {} : { allowForce: options.allowForce }) } }));
  const changeSets = new InMemoryChangeSetRepo(
    [fakeChangeSet({ actorId: "original-writer" })],
    [fakeItem(), fakeItem({ id: "item-2", entityType: "raw-doc", entityId: "raw-1", position: 1, inversePayload: { body: "inverse" } })],
  );
  const deps = {
    workspaceId: WORKSPACE_ID, changeSets, revertRegistry: registry, outbox: { enqueue: async () => {} } as unknown as OutboxPort,
    clock: { nowMs: () => Date.parse("2026-10-05T00:00:00.000Z") }, idGen: { newId: () => "evt-1" }, toChangeSetHeader,
  } as ChangeSetRevertRouteDeps;
  return { deps, writes, changeSets };
}

/** An authorizer that answers a classified 403 refusal for the listed permissions, as a host port does. */
function refusingAuthorize(denied: readonly string[]) {
  const calls: RecordedAuthorize[] = [];
  const authorize = async ({ permission, entityType }: { permission: string; entityType: string }, optional: { entityId?: string } = {}) => {
    calls.push({ permission, entityType, ...optional });
    if (denied.includes(permission)) throw new RouteRefusalError({ status: 403, body: { error: "internal grant detail", code: "FORBIDDEN" } });
  };
  return { authorize, calls };
}

describe("changeSetRevertRoute per-item policy", () => {
  it("tool and admin revert forward the current principal and authorize the scoped item", async () => {
    const { deps, writes } = policySetup();
    const { authorize, calls } = recordingAuthorize();
    const result = await run(deps, { changeSetId: "cs-1", force: false }, { id: "current-reverter", kind: "user" }, authorize);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { permission: "changeset.revert", entityType: "change_set", entityId: "cs-1" },
      { permission: "documents.write_raw", entityType: "document", entityId: "raw-1" },
    ]);
    expect(writes).toEqual([{ id: "item-2", actorId: "current-reverter" }, { id: "item-1", actorId: "current-reverter" }]);
  });

  it("admin revert answers 403, not 500, for a denied item and for force on a non-forceable item", async () => {
    const denied = policySetup();
    const refusal = await refusalOf(() => run(denied.deps, { changeSetId: "cs-1", force: false }, PRINCIPAL, refusingAuthorize(["documents.write_raw"]).authorize));
    expect(refusal).toEqual({ status: 403, body: { error: expect.any(String), code: "REVERT_FORBIDDEN", details: { reason: "ITEM_PERMISSION_DENIED" } } });
    expect(JSON.stringify(refusal)).not.toContain("internal grant detail");
    expect(JSON.stringify(refusal)).not.toContain("documents.write_raw");
    expect(denied.writes).toEqual([]);

    const strict = policySetup({ allowForce: false, current: 7 });
    const forced = await refusalOf(() => run(strict.deps, { changeSetId: "cs-1", force: true }, PRINCIPAL, recordingAuthorize().authorize));
    expect(forced).toEqual({ status: 403, body: { error: expect.stringMatching(/keep the newer version and edit it again/i), code: "REVERT_FORBIDDEN", details: { reason: "ITEM_CANNOT_FORCE" } } });
    expect(strict.writes).toEqual([]);
    expect((await strict.changeSets.findById({ workspaceId: WORKSPACE_ID, id: "cs-1" }))?.changeSet.status).toBe("applied");
  });

  it("keeps the outer changeset.revert refusal unchanged and propagates an unclassified item-check failure", async () => {
    const outer = policySetup();
    const outerRefusal = new RouteRefusalError({ status: 403, body: { error: "outer", code: "FORBIDDEN" } });
    const outerCalls: string[] = [];
    await expect(run(outer.deps, { changeSetId: "cs-1", force: false }, PRINCIPAL, async ({ permission }) => { outerCalls.push(permission); throw outerRefusal; })).rejects.toBe(outerRefusal);
    expect(outerCalls).toEqual(["changeset.revert"]);

    const broken = policySetup();
    const failure = new Error("authorizer storage down");
    await expect(run(broken.deps, { changeSetId: "cs-1", force: false }, PRINCIPAL, async ({ permission }) => { if (permission !== "changeset.revert") throw failure; })).rejects.toBe(failure);
    expect(broken.writes).toEqual([]);
  });
});
