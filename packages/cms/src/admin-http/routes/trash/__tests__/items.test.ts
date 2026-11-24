import { describe, expect, it } from "vitest";
import { trashMoveRoute, type TrashMoveFn, type TrashMoveOutcome } from "../items.js";
import { PRINCIPAL, raw, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const run = (body: unknown, moveToTrash: TrashMoveFn, context: { id: string } | null = PRINCIPAL) =>
  trashMoveRoute.handle({ input: { body }, deps: { workspaceId: WORKSPACE_ID, moveToTrash }, context: context ?? undefined }, { signal });

describe("trashMoveRoute", () => {
  it("keeps the method, path, default status and no body cap", () => {
    expect(trashMoveRoute.method).toBe("post");
    expect(trashMoveRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/trash/items");
    expect(trashMoveRoute.successStatus).toBeUndefined();
    expect(trashMoveRoute.maxBodyBytes).toBeUndefined();
    expect(trashMoveRoute.parse(raw({}, { type: "post", id: "p" }))).toEqual({ ok: true, value: { body: { type: "post", id: "p" } } });
  });

  it("refuses every malformed body with the flat 400 and never moves", async () => {
    let moves = 0;
    const move: TrashMoveFn = async () => { moves += 1; return { ok: true, version: 1 }; };
    for (const body of [null, 1, "x", {}, { type: 1, id: "i" }, { type: "", id: "i" }, { type: "t" }, { type: "t", id: 1 }, { type: "t", id: "" }]) {
      expect(await refusalOf(() => run(body, move))).toEqual({ status: 400, body: { error: "expected { type, id }", code: "INVALID_INPUT" } });
    }
    expect(moves).toBe(0);
  });

  it("fails closed without a principal before reading the body", async () => {
    await expect(run(null, async () => ({ ok: true, version: 1 }), null)).rejects.toThrow(/no authenticated principal/);
  });

  it("moves the item as the principal, without normalizing identifiers, and answers the version", async () => {
    const asked: unknown[] = [];
    const move: TrashMoveFn = async (input) => { asked.push(input); return { ok: true, version: 7 }; };
    expect(await run({ type: " theme ", id: " i ", ignored: true }, move)).toEqual({ ok: true, value: { ok: true, version: 7 } });
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID, entityType: " theme ", entityId: " i ", actor: { principalId: PRINCIPAL.id } }]);
  });

  const refusals: [TrashMoveOutcome, number, Record<string, unknown>][] = [
    [{ ok: false, reason: "unknown-type" }, 404, { error: "'form' is not a kind the Trash can hold", code: "TRASH_UNKNOWN_TYPE" }],
    [{ ok: false, reason: "not-found" }, 404, { error: "item was not found", code: "NOT_FOUND" }],
    [{ ok: false, reason: "forbidden", permission: "admin.forms.manage" }, 403, {
      error: `principal '${PRINCIPAL.id}' is not authorized for 'admin.forms.manage'`, code: "FORBIDDEN", details: { permission: "admin.forms.manage" } }],
    [{ ok: false, reason: "version-changed" }, 409, { error: "the item changed since it was last read", code: "TRASH_VERSION_CHANGED" }],
    [{ ok: false, reason: "blocked", code: "TERM_HAS_CHILDREN", count: 3 }, 409, {
      error: "this term has 3 sub-terms — move them under another parent, or delete them permanently, first", code: "TERM_HAS_CHILDREN", count: 3 }],
    [{ ok: false, reason: "blocked", code: "THEME_ACTIVE", count: 1 }, 409, { error: "this is the site's active theme — switch to another theme first", code: "THEME_ACTIVE", count: 1 }],
    [{ ok: false, reason: "blocked", code: "ALREADY_IN_TRASH", count: 1 }, 409, {
      error: "an item with this id is already in the Trash — restore or permanently delete that one first", code: "ALREADY_IN_TRASH", count: 1 }],
    [{ ok: false, reason: "blocked", code: "OTHER", count: 2 }, 409, { error: "this item cannot be moved to the Trash (OTHER)", code: "OTHER", count: 2 }],
  ];
  for (const [outcome, status, body] of refusals) {
    it(`maps ${outcome.ok ? "ok" : outcome.reason} ${"code" in outcome ? outcome.code : ""} to ${status}`, async () => {
      expect(await refusalOf(() => run({ type: "form", id: "f" }, async () => outcome))).toEqual({ status, body });
    });
  }

  it("rethrows an unexpected move failure unchanged (the host 500)", async () => {
    await expect(run({ type: "form", id: "f" }, async () => { throw new Error("private"); })).rejects.toThrow("private");
  });
});
