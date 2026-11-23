import { describe, expect, it } from "vitest";
import { newsletterListListsRoute as route } from "../list-lists.js";
import { baseDeps, fakeList, PRINCIPAL, raw, recordingAuthorize, WORKSPACE_ID } from "./helpers.js";

/** @file LIST_LISTS: every list of this workspace, whole, in the `{ data }` envelope. */

describe("newsletterListListsRoute", () => {
  it("keeps the method, path and default status and takes no input", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/newsletter/lists", undefined, undefined]);
    expect(route.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("answers every list the repo returns for this workspace, unpaged and unfiltered", async () => {
    const reads: unknown[] = [];
    const lists = [fakeList({ id: "a" }), fakeList({ id: "b", slug: "second" })];
    const deps = { ...baseDeps(), newsletterListRepo: { list: async (r: unknown) => { reads.push(r); return lists; } } };
    const result = await route.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(reads).toEqual([{ workspaceId: WORKSPACE_ID }]);
    expect(result).toEqual({ ok: true, value: { data: lists } });
  });
});
