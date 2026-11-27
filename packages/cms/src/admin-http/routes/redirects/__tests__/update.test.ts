import { describe, expect, it } from "vitest";
import { EntityNotLiveError } from "../../../../core/entity-liveness.js";
import { redirectUpdateRoute } from "../update.js";
import { fakeRule, makeWriteDeps, manageRule, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (params: Record<string, string>, body?: unknown) => ({ body, query: {}, params });

async function seeded() {
  const redirectsWriteDeps = makeWriteDeps();
  const record = fakeRule({ workspaceId: WORKSPACE_ID });
  await redirectsWriteDeps.repo.save({ record, revision: { redirectId: record.id, workspaceId: WORKSPACE_ID, seq: 1, state: record, tombstoned: false, actorId: "system", recordedAt: record.createdAt } });
  return redirectsWriteDeps;
}

const call = async (body: Record<string, unknown>, redirectsWriteDeps: ReturnType<typeof makeWriteDeps>, id = "red-1") =>
  redirectUpdateRoute.handle({ input: { id, body }, deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps }, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal });

describe("redirectUpdateRoute", () => {
  it("keeps the path and defaults a missing id and body", () => {
    expect(redirectUpdateRoute.method).toBe("patch");
    expect(redirectUpdateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/redirects/:id");
    expect(redirectUpdateRoute.parse(raw({}))).toEqual({ ok: true, value: { id: "", body: {} } });
    expect(redirectUpdateRoute.parse(raw({ id: "red-1" }, { toTarget: "/x" }))).toEqual({ ok: true, value: { id: "red-1", body: { toTarget: "/x" } } });
  });

  it("authorizes and answers the updated rule, ignoring non-boolean override and non-number priority", async () => {
    const { authorize, calls } = recordingAuthorize();
    const deps = { workspaceId: WORKSPACE_ID, redirectsWriteDeps: await seeded() };
    const result = await redirectUpdateRoute.handle({ input: { id: "red-1", body: { toTarget: "/next", override: "yes", priority: "9" } }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([manageRule("red-1")]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.data).toMatchObject({ id: "red-1", toTarget: "/next", override: false, priority: 0, version: 2 });
  });

  it("maps the chokepoint's errors to the same status/code pairs", async () => {
    expect(await refusalOf(() => call({ toTarget: "/x" }, makeWriteDeps(), "nope"))).toEqual({ status: 404, body: { error: "redirect 'nope' was not found", code: "REDIRECT_NOT_FOUND" } });
    expect(await refusalOf(async () => call({ fromPattern: "/loop", toTarget: "/loop" }, await seeded()))).toMatchObject({ status: 409, body: { code: "REDIRECT_LOOP_DETECTED" } });
    expect(await refusalOf(async () => call({ statusCode: 200 }, await seeded()))).toMatchObject({ status: 400, body: { code: "REDIRECT_VALIDATION_ERROR" } });
    const trashed = await seeded();
    trashed.isInTrash = async () => true;
    expect(await refusalOf(() => call({ toTarget: "/x" }, trashed))).toEqual({
      status: 409, body: { error: new EntityNotLiveError({ entityType: "redirect", entityId: "red-1", state: "trashed" }).message, code: "ENTITY_IN_TRASH" },
    });
  });

  it("lets an unexpected failure (and an authorization refusal) through unmapped", async () => {
    const deps = await seeded();
    deps.repo.findById = async () => { throw new Error("db down"); };
    await expect(call({ toTarget: "/x" }, deps)).rejects.toThrow("db down");
    await expect(redirectUpdateRoute.handle({ input: { id: "red-1", body: {} }, deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps: await seeded() }, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
  });
});

it("persists explicit boolean override and numeric priority on the selected redirect", async () => {
  const deps = await seeded();
  expect(await call({ override: true, priority: 9 }, deps)).toMatchObject({
    ok: true, value: { data: { id: "red-1", override: true, priority: 9, version: 2 } },
  });
  expect(await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: "red-1" }))
    .toMatchObject({ override: true, priority: 9, version: 2 });
});
