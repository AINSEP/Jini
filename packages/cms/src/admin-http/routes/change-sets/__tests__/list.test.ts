import { describe, expect, it } from "vitest";
import { InMemoryChangeSetRepo } from "../../../../core/commands/repo.memory.js";
import { changeSetListRoute } from "../list.js";
import { fakeChangeSet, PRINCIPAL, raw, recordingAuthorize, signal, toChangeSetHeader, WORKSPACE_ID } from "./helpers.js";

/** @file GET /change-sets: the workspace's change sets through the host's header DTO, behind `changeset.read`. */

describe("changeSetListRoute", () => {
  it("keeps the method and path, takes no input and declares no body cap", () => {
    expect(changeSetListRoute.method).toBe("get");
    expect(changeSetListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/change-sets");
    expect(changeSetListRoute.successStatus).toBeUndefined();
    expect(changeSetListRoute.maxBodyBytes).toBeUndefined();
    expect(changeSetListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("authorizes changeset.read on change_set with no entity id", async () => {
    const { authorize, calls } = recordingAuthorize();
    await changeSetListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, changeSets: new InMemoryChangeSetRepo(), toChangeSetHeader }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "changeset.read", entityType: "change_set" }]);
    expect(Object.keys(calls[0]!)).not.toContain("entityId");
  });

  it("lists this workspace's change sets through the injected header DTO, in the repo's order", async () => {
    const asked: string[] = [];
    const changeSets = { listByWorkspace: async ({ workspaceId }: { workspaceId: string }) => { asked.push(workspaceId); return [fakeChangeSet({ id: "b", status: "reverted" }), fakeChangeSet({ id: "a" })]; } };
    const { authorize } = recordingAuthorize();
    const result = await changeSetListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, changeSets, toChangeSetHeader }, context: PRINCIPAL, authorize });
    expect(asked).toEqual([WORKSPACE_ID]);
    expect(result).toEqual({ ok: true, value: { changeSets: [{ header: "b", status: "reverted" }, { header: "a", status: "applied" }] } });
  });

  it("scopes the listing to the workspace over the real in-memory repo", async () => {
    const changeSets = new InMemoryChangeSetRepo([fakeChangeSet({ id: "a" }), fakeChangeSet({ id: "other", workspaceId: "ws-2" })]);
    const { authorize } = recordingAuthorize();
    const result = await changeSetListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, changeSets, toChangeSetHeader }, context: PRINCIPAL, authorize });
    expect(result).toEqual({ ok: true, value: { changeSets: [{ header: "a", status: "applied" }] } });
  });

  it("does not read the repo when authorization refuses", async () => {
    let reads = 0;
    const changeSets = { listByWorkspace: async () => { reads += 1; return []; } };
    const { authorize } = recordingAuthorize(["changeset.read"]);
    await expect(changeSetListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, changeSets, toChangeSetHeader }, context: PRINCIPAL, authorize })).rejects.toThrow("denied changeset.read");
    expect(reads).toBe(0);
  });

  it("rethrows a repository failure unchanged, so the host's error port answers the 500", async () => {
    const changeSets = { listByWorkspace: async () => { throw new Error("private storage details"); } };
    const { authorize } = recordingAuthorize();
    await expect(changeSetListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, changeSets, toChangeSetHeader }, context: PRINCIPAL, authorize })).rejects.toThrow("private storage details");
  });

  it("fails closed when the host mounted it without an authorizer", async () => {
    await expect(changeSetListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, changeSets: new InMemoryChangeSetRepo(), toChangeSetHeader }, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
