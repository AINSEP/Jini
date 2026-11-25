import { describe, expect, it } from "vitest";
import type { TrashItem } from "../../../../trash/index.js";
import { toAdminTrashResponse } from "../../../http/trash.js";
import { trashListRoute, type TrashListRouteDeps } from "../list.js";
import { DEFAULT_TRASH_PAGE_SIZE, MAX_TRASH_PAGE_SIZE } from "../shared.js";
import { ENTRY_FORBIDDEN, fakeItem, NOW, PRINCIPAL, raw, recordingGate, refusalOf, signal, unexpected, WORKSPACE_ID } from "./helpers.js";

const parse = (query: Record<string, unknown>) => trashListRoute.parse(raw({}, undefined, query));

function deps(overrides: Partial<TrashListRouteDeps> = {}): TrashListRouteDeps {
  return {
    workspaceId: WORKSPACE_ID, authorizeEntry: recordingGate().authorizeEntry, clock: { nowIso: () => NOW },
    trash: { list: async () => ({ items: [], nextCursor: null }) }, filterVisible: async ({ items }) => [...items],
    userRepo: { list: unexpected }, loadPostDisplayKinds: async () => new Map(), retentionDays: 30, ...overrides,
  };
}
const run = (d: TrashListRouteDeps, input = { limit: 50, entityTypes: undefined, cursor: null } as { limit: number; entityTypes: string[] | undefined; cursor: string | null }, context: { id: string } | null = PRINCIPAL) =>
  trashListRoute.handle({ input, deps: d, context: context ?? undefined }, { signal });

describe("trashListRoute", () => {
  it("keeps the method, path, default status and no body cap", () => {
    expect(trashListRoute.method).toBe("get");
    expect(trashListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/trash");
    expect(trashListRoute.successStatus).toBeUndefined();
    expect(trashListRoute.maxBodyBytes).toBeUndefined();
  });

  it("clamps the limit, splits the kind filter and reads the cursor without ever refusing", () => {
    expect(parse({})).toEqual({ ok: true, value: { limit: DEFAULT_TRASH_PAGE_SIZE, entityTypes: undefined, cursor: null } });
    expect(parse({ limit: "10", entityTypes: " post, ,comment ", cursor: "c1" })).toEqual({ ok: true, value: { limit: 10, entityTypes: ["post", "comment"], cursor: "c1" } });
    expect(parse({ limit: "9999", entityTypes: ["post", "media,redirect"] })).toEqual({ ok: true, value: { limit: MAX_TRASH_PAGE_SIZE, entityTypes: ["post", "media", "redirect"], cursor: null } });
    for (const limit of ["0", "-3", "abc", 5, ["7"]]) expect(parse({ limit })).toMatchObject({ value: { limit: DEFAULT_TRASH_PAGE_SIZE } });
    expect(parse({ entityTypes: " , ", cursor: "" })).toMatchObject({ value: { entityTypes: undefined, cursor: null } });
    expect(parse({ entityTypes: 4, cursor: 9 })).toMatchObject({ value: { entityTypes: undefined, cursor: null } });
  });

  it("refuses through the entry gate before listing anything", async () => {
    const gate = recordingGate({ allowed: false, reason: "no_grant" });
    expect(await refusalOf(() => run(deps({ authorizeEntry: gate.authorizeEntry, trash: { list: unexpected } })))).toEqual(ENTRY_FORBIDDEN);
    expect(gate.calls).toEqual([{ principalId: PRINCIPAL.id }]);
  });

  it("lists, filters per kind, resolves usernames once and adds the post display kind", async () => {
    const listed: unknown[] = [];
    const post = fakeItem();
    const comment = fakeItem({ id: "trash-2", entityType: "comment", entityId: "c-1", actorPrincipalId: "system" });
    const hidden = fakeItem({ id: "trash-3", entityType: "media", entityId: "m-1" });
    const kindsAsked: TrashItem[][] = [];
    const d = deps({
      trash: { list: async (required, optional) => { listed.push({ required, optional }); return { items: [post, comment, hidden], nextCursor: "next" }; } },
      filterVisible: async ({ principalId, items }) => { expect(principalId).toBe(PRINCIPAL.id); return items.filter((i) => i.entityType !== "media"); },
      userRepo: { list: async ({ workspaceId }) => { expect(workspaceId).toBe(WORKSPACE_ID); return [{ principalId: "principal-1", username: "ada" }]; } },
      loadPostDisplayKinds: async ({ items }) => { kindsAsked.push([...items]); return new Map([["post-1", "page"]]); },
      // Not the default 30: the page must echo the host-injected window, so the admin can state it.
      retentionDays: 14,
    });
    const usernames = new Map([["principal-1", "ada"]]);
    expect(await run(d, { limit: 10, entityTypes: ["post"], cursor: "c" })).toEqual({ ok: true, value: {
      items: [{ ...toAdminTrashResponse({ item: post, now: NOW, usernameByPrincipalId: usernames }), displayKind: "page" },
        toAdminTrashResponse({ item: comment, now: NOW, usernameByPrincipalId: usernames })],
      nextCursor: "next",
      retentionDays: 14,
    } });
    expect(listed).toEqual([{ required: { workspaceId: WORKSPACE_ID, now: NOW, limit: 10 }, optional: { entityTypes: ["post"], cursor: "c" } }]);
    expect(kindsAsked).toEqual([[post, comment]]);
  });

  it("skips the username lookup on an empty visible page", async () => {
    expect(await run(deps({ trash: { list: async () => ({ items: [fakeItem()], nextCursor: null }) }, filterVisible: async () => [] })))
      .toEqual({ ok: true, value: { items: [], nextCursor: null, retentionDays: 30 } });
  });

  it("fails closed without a principal and rethrows unexpected failures", async () => {
    await expect(run(deps(), undefined, null)).rejects.toThrow(/no authenticated principal/);
    await expect(run(deps({ trash: { list: async () => { throw new Error("private"); } } }))).rejects.toThrow("private");
  });
});

describe("toAdminTrashResponse", () => {
  it("projects the row, counts whole days left (floored at 0) and never sends a raw id as the username", () => {
    const item = fakeItem({ actorPrincipalId: "gone-user", purgeAfter: "2026-10-02T12:00:00.001Z" });
    expect(toAdminTrashResponse({ item, now: NOW, usernameByPrincipalId: new Map() })).toEqual({
      id: "trash-1", entityType: "post", entityId: "post-1", title: "Hello", subtitle: "hello", trashedAt: item.trashedAt, purgeAfter: item.purgeAfter,
      daysRemaining: 2, actorPrincipalId: "gone-user", actorPluginId: null, actorUsername: null, actorIsSystem: false,
    });
    expect(toAdminTrashResponse({ item: fakeItem({ purgeAfter: NOW }), now: NOW, usernameByPrincipalId: new Map() }).daysRemaining).toBe(0);
    expect(toAdminTrashResponse({ item: fakeItem({ purgeAfter: "2026-09-01T00:00:00.000Z" }), now: NOW, usernameByPrincipalId: new Map() }).daysRemaining).toBe(0);
    const system = toAdminTrashResponse({ item: fakeItem({ actorPrincipalId: "system" }), now: NOW, usernameByPrincipalId: new Map([["system", "x"]]) });
    expect(system).toMatchObject({ actorUsername: "x", actorIsSystem: true });
  });
});
