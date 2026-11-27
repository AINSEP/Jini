import { describe, expect, it } from "vitest";
import type { ModerationResult } from "../../../../comments/write-service.js";
import { commentsModerationActionRoutes, commentsPurgeRoute } from "../moderate.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function writeService(result: ModerationResult = { ok: true }) {
  const calls: unknown[] = [];
  return { calls, commentWriteService: {
    applyModeration: async (input: unknown) => { calls.push(input); return result; },
    purge: async (input: unknown) => { calls.push(input); return result; },
  } };
}

const [approve, spam, trash, restore] = commentsModerationActionRoutes;

describe("commentsModerationActionRoutes", () => {
  it("declares approve/spam/trash/restore, in order, each answering 204", () => {
    expect(commentsModerationActionRoutes.map((r) => [r.method, r.path, r.successStatus])).toEqual(["approve", "spam", "trash", "restore"].map((p) =>
      ["post", `/api/admin/v1/workspaces/:workspaceId/comments/:commentId/${p}`, 204]));
    expect(approve!.parse(raw({ params: { commentId: "c-1" }, body: { expectedVersion: 1 } }))).toEqual({ ok: true, value: { commentId: "c-1", body: { expectedVersion: 1 } } });
  });

  it("gates each action on its own permission and applies the transition as the principal", async () => {
    const pairs = [[approve, "comments.moderate", "approve", "approved"], [spam, "comments.moderate", "mark_spam", "spam"], [trash, "comments.delete", "trash", "trash"], [restore, "comments.moderate", "restore", "approved"]] as const;
    for (const [route, permission, action, toStatus] of pairs) {
      const { calls: writes, commentWriteService } = writeService();
      const { authorize, calls } = recordingAuthorize();
      const result = await route!.handle({ input: { commentId: "c-1", body: { expectedVersion: "3", note: "n" } }, deps: { workspaceId: WORKSPACE_ID, commentWriteService }, context: PRINCIPAL, authorize }, { signal });
      expect(result).toEqual({ ok: true, value: undefined });
      expect(calls).toEqual([{ permission, entityType: "comment", entityId: "c-1" }]);
      expect(writes).toEqual([{ workspaceId: WORKSPACE_ID, id: "c-1", expectedVersion: 3, action, toStatus, actorPrincipalId: PRINCIPAL.id, note: "n" }]);
    }
  });

  it("refuses a missing, negative, fractional or non-numeric expectedVersion with the flat 400, after authorization", async () => {
    for (const body of [undefined, {}, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: "abc" }]) {
      const { calls, commentWriteService } = writeService();
      expect(await refusalOf(() => approve!.handle({ input: { commentId: "c-1", body }, deps: { workspaceId: WORKSPACE_ID, commentWriteService }, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal })))
        .toEqual({ status: 400, body: { error: "expectedVersion is required and must be a non-negative integer" } });
      expect(calls).toEqual([]);
    }
    const { commentWriteService } = writeService();
    await expect(approve!.handle({ input: { commentId: "c-1", body: {} }, deps: { workspaceId: WORKSPACE_ID, commentWriteService }, context: PRINCIPAL, authorize: recordingAuthorize({ deny: "comments.moderate" }).authorize }, { signal })).rejects.toThrow("denied");
  });

  it("maps not-found to 404 and a conflict to 409 carrying currentVersion when known", async () => {
    const run = (result: ModerationResult) => refusalOf(() => approve!.handle({ input: { commentId: "c-1", body: { expectedVersion: 0 } }, deps: { workspaceId: WORKSPACE_ID, commentWriteService: writeService(result).commentWriteService }, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal }));
    expect(await run({ ok: false, reason: "not-found" })).toEqual({ status: 404, body: { error: "not-found", currentVersion: undefined } });
    expect(await run({ ok: false, reason: "conflict", currentVersion: 4 })).toEqual({ status: 409, body: { error: "conflict", currentVersion: 4 } });
  });
});

describe("commentsPurgeRoute", () => {
  it("gates on comments.delete.force, purges as the principal (note only when a string) and answers 204", async () => {
    expect([commentsPurgeRoute.method, commentsPurgeRoute.path, commentsPurgeRoute.successStatus]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/comments/:commentId/purge", 204]);
    const { calls: writes, commentWriteService } = writeService();
    const { authorize, calls } = recordingAuthorize();
    expect(await commentsPurgeRoute.handle({ input: { commentId: "c-1", body: { note: 7 } }, deps: { workspaceId: WORKSPACE_ID, commentWriteService }, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual([{ permission: "comments.delete.force", entityType: "comment", entityId: "c-1" }]);
    expect(writes).toEqual([{ workspaceId: WORKSPACE_ID, id: "c-1", actorPrincipalId: PRINCIPAL.id, note: null }]);
  });

  it("refuses a gone comment with a code-less 404", async () => {
    const { commentWriteService } = writeService({ ok: false, reason: "not-found" });
    expect(await refusalOf(() => commentsPurgeRoute.handle({ input: { commentId: "c-1", body: { note: "bye" } }, deps: { workspaceId: WORKSPACE_ID, commentWriteService }, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal })))
      .toEqual({ status: 404, body: { error: "not-found" } });
  });
});

it("a missing comment mount authorizer or principal never purges a comment", async () => {
  const { calls, commentWriteService } = writeService();
  const input = { commentId: "c-1", body: { note: "duplicate" } };
  const deps = { workspaceId: WORKSPACE_ID, commentWriteService };
  await expect(commentsPurgeRoute.handle({ input, deps, context: PRINCIPAL }, { signal }))
    .rejects.toThrow(new Error("comments admin route has no authorizer"));
  const authorization = recordingAuthorize();
  await expect(commentsPurgeRoute.handle({ input, deps, authorize: authorization.authorize }, { signal }))
    .rejects.toThrow(new Error("comments admin route has no authenticated principal"));
  expect(calls).toEqual([]);
});
