import { describe, expect, it } from "vitest";
import { redirectTombstoneRoute } from "../tombstone.js";
import { fakeRule, makeWriteDeps, MANAGE, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (params: Record<string, string>) => ({ body: {}, query: {}, params });

async function seeded() {
  const redirectsWriteDeps = makeWriteDeps();
  const record = fakeRule({ workspaceId: WORKSPACE_ID });
  await redirectsWriteDeps.repo.save({ record, revision: { redirectId: record.id, workspaceId: WORKSPACE_ID, seq: 1, state: record, tombstoned: false, actorId: "system", recordedAt: record.createdAt } });
  return redirectsWriteDeps;
}

describe("redirectTombstoneRoute", () => {
  it("keeps the path and reads :id, falling back to an empty id", () => {
    expect(redirectTombstoneRoute.method).toBe("delete");
    expect(redirectTombstoneRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/redirects/:id");
    expect(redirectTombstoneRoute.parse(raw({}))).toEqual({ ok: true, value: { id: "" } });
  });

  it("authorizes and answers the removed rule (200, not 204)", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await redirectTombstoneRoute.handle({ input: { id: "red-1" }, deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps: await seeded() }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([MANAGE]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.data.id).toBe("red-1");
    expect(result.value.data.status).toBe("disabled");
  });

  it("refuses an unknown rule with 404 REDIRECT_NOT_FOUND and the chokepoint's message", async () => {
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => redirectTombstoneRoute.handle({ input: { id: "nope" }, deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps: makeWriteDeps() }, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "redirect 'nope' was not found", code: "REDIRECT_NOT_FOUND" },
    });
  });

  it("lets an unexpected failure through to the host error port", async () => {
    const { authorize } = recordingAuthorize();
    const redirectsWriteDeps = makeWriteDeps();
    redirectsWriteDeps.repo.findById = async () => { throw new Error("db down"); };
    await expect(redirectTombstoneRoute.handle({ input: { id: "red-1" }, deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps }, context: PRINCIPAL, authorize })).rejects.toThrow("db down");
  });
});
