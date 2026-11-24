import { describe, expect, it } from "vitest";
import { InMemoryChangeSetRepo } from "../../../../core/commands/repo.memory.js";
import { changeSetGetRoute } from "../get.js";
import { fakeChangeSet, fakeItem, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, toChangeSetHeader, toChangeSetItem, WORKSPACE_ID } from "./helpers.js";

/** @file GET /change-sets/:changeSetId: one change set with its items, behind `changeset.read` for that change set. */

const deps = (changeSets = new InMemoryChangeSetRepo([fakeChangeSet()], [fakeItem({ id: "i0", position: 0 }), fakeItem({ id: "i1", position: 1 })])) => ({ workspaceId: WORKSPACE_ID, changeSets, toChangeSetHeader, toChangeSetItem });

describe("changeSetGetRoute", () => {
  it("keeps the method and path, reads :changeSetId (empty when missing) and declares no body cap", () => {
    expect(changeSetGetRoute.method).toBe("get");
    expect(changeSetGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/change-sets/:changeSetId");
    expect(changeSetGetRoute.successStatus).toBeUndefined();
    expect(changeSetGetRoute.maxBodyBytes).toBeUndefined();
    expect(changeSetGetRoute.parse(raw({ changeSetId: "cs-1" }))).toEqual({ ok: true, value: { changeSetId: "cs-1" } });
    expect(changeSetGetRoute.parse(raw({}))).toEqual({ ok: true, value: { changeSetId: "" } });
  });

  it("authorizes changeset.read on that change set and answers header + items through the injected DTOs", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await changeSetGetRoute.handle({ input: { changeSetId: "cs-1" }, deps: deps(), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "changeset.read", entityType: "change_set", entityId: "cs-1" }]);
    expect(result).toEqual({ ok: true, value: { changeSet: { header: "cs-1", status: "applied" }, items: [{ item: "i0" }, { item: "i1" }] } });
  });

  it("refuses an unknown change set with 404 and its code", async () => {
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => changeSetGetRoute.handle({ input: { changeSetId: "nope" }, deps: deps(), context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "change set was not found", code: "CHANGE_SET_NOT_FOUND" },
    });
  });

  it("does not read the repo when authorization refuses", async () => {
    let reads = 0;
    const changeSets = { findById: async () => { reads += 1; return null; } };
    const { authorize } = recordingAuthorize(["changeset.read"]);
    await expect(changeSetGetRoute.handle({ input: { changeSetId: "cs-1" }, deps: { ...deps(), changeSets }, context: PRINCIPAL, authorize })).rejects.toThrow("denied changeset.read");
    expect(reads).toBe(0);
  });

  it("rethrows a repository failure unchanged, so the host's error port answers the 500", async () => {
    const changeSets = { findById: async () => { throw new Error("private storage details"); } };
    const { authorize } = recordingAuthorize();
    await expect(changeSetGetRoute.handle({ input: { changeSetId: "cs-1" }, deps: { ...deps(), changeSets }, context: PRINCIPAL, authorize })).rejects.toThrow("private storage details");
  });

  it("fails closed when the host mounted it without an authorizer", async () => {
    await expect(changeSetGetRoute.handle({ input: { changeSetId: "cs-1" }, deps: deps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
