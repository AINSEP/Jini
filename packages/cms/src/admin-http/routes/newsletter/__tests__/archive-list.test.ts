import { describe, expect, it } from "vitest";
import { newsletterArchiveListRoute as route } from "../archive-list.js";
import { baseDeps, fakeList, PRINCIPAL, raw, recordingAuthorize, WORKSPACE_ID } from "./helpers.js";

/** @file ARCHIVE_LIST: the host's `archiveList` for `:id` (it refuses the default list), answered in the data envelope. */

describe("newsletterArchiveListRoute", () => {
  it("keeps the method, path and default status and reads :id as sent", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:id/archive", undefined, undefined]);
    expect(route.parse(raw({ id: "list-1" }))).toEqual({ ok: true, value: { id: "list-1" } });
    // `String(req.params.id)`: a missing param was never defaulted to "".
    expect(route.parse(raw({}))).toEqual({ ok: true, value: { id: "undefined" } });
  });

  it("archives the list in this workspace and answers the archived row", async () => {
    const calls: unknown[] = [];
    const archived = fakeList({ id: "list-9" });
    const deps = { ...baseDeps(), archiveList: async (input: unknown) => { calls.push(input); return { list: archived }; } };
    const result = await route.handle({ input: { id: "list-9" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(calls).toEqual([{ workspaceId: WORKSPACE_ID, id: "list-9" }]);
    expect(result).toEqual({ ok: true, value: { data: archived } });
  });
});
