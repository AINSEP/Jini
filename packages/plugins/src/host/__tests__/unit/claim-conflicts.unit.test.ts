import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveClaimConflicts, type ClaimOwner, type ExtensionClaim } from "../../claim-conflicts.js";

/**
 * @file The product-neutral claim detector (`claim-conflicts.ts`): one test per conflict kind, the
 * shared-vs-exclusive rule, precedence, all-or-nothing refusal and route/prefix normalization.
 */

const exclusive = (kind: string, key: string): ExtensionClaim => ({ kind, key, mode: "exclusive" });
const shared = (kind: string, key: string): ExtensionClaim => ({ kind, key, mode: "shared" });
const owner = (id: string, ...claims: ExtensionClaim[]): ClaimOwner => ({ id, claims });

for (const kind of ["tool", "table", "setting", "widget", "permission"] as const) {
  test(`${kind}: a second owner claiming the same ${kind} is refused, naming the holder`, () => {
    const result = resolveClaimConflicts({ owners: [owner("a", exclusive(kind, "shop.items")), owner("b", exclusive(kind, "shop.items"))] });
    assert.deepEqual(result.accepted, ["a"]);
    assert.deepEqual(result.refused.get("b"), [{ ownerId: "b", kind, key: "shop.items", heldBy: "a", heldKey: "shop.items" }]);
  });
}

test("identifiers compare case-insensitively (SQLite table names and human-typed ids)", () => {
  const result = resolveClaimConflicts({ owners: [owner("a", exclusive("table", "p_shop__Items")), owner("b", exclusive("table", "P_SHOP__items"))] });
  assert.deepEqual(result.accepted, ["a"]);
  assert.equal(result.refused.get("b")?.[0]?.heldKey, "p_shop__Items");
});

test("route: the same method and path, differing only by parameter name and trailing slash, conflict", () => {
  const result = resolveClaimConflicts({ owners: [owner("a", exclusive("route", "GET /shop/:id")), owner("b", exclusive("route", "get /Shop/{slug}/"))] });
  assert.deepEqual(result.accepted, ["a"]);
  assert.equal(result.refused.get("b")?.[0]?.heldBy, "a");
});

test("route: different methods on one path are allowed sharing; a method-less route claims every method", () => {
  const split = resolveClaimConflicts({ owners: [owner("a", exclusive("route", "GET /shop")), owner("b", exclusive("route", "POST /shop"))] });
  assert.deepEqual(split.accepted, ["a", "b"]);
  const any = resolveClaimConflicts({ owners: [owner("a", exclusive("route", "POST /shop")), owner("b", exclusive("route", "/shop"))] });
  assert.deepEqual(any.accepted, ["a"]);
});

test("hook: two shared claims on one hook coexist; an exclusive claim conflicts with a shared one either way round", () => {
  const both = resolveClaimConflicts({ owners: [owner("a", shared("hook", "content.entry.beforeSave")), owner("b", shared("hook", "content.entry.beforeSave"))] });
  assert.deepEqual(both.accepted, ["a", "b"]);
  const exclusiveSecond = resolveClaimConflicts({ owners: [owner("a", shared("hook", "render.page")), owner("b", exclusive("hook", "render.page"))] });
  assert.deepEqual(exclusiveSecond.accepted, ["a"]);
  const exclusiveFirst = resolveClaimConflicts({ owners: [owner("a", exclusive("hook", "render.page")), owner("b", shared("hook", "render.page"))] });
  assert.deepEqual(exclusiveFirst.accepted, ["a"]);
});

test("kinds are separate namespaces: a tool and a setting with the same key do not conflict", () => {
  const result = resolveClaimConflicts({ owners: [owner("a", exclusive("tool", "shop")), owner("b", exclusive("setting", "shop"))] });
  assert.deepEqual(result.accepted, ["a", "b"]);
});

test("precedence: the earlier owner always wins, whatever the ids sort to", () => {
  const result = resolveClaimConflicts({ owners: [owner("zeta", exclusive("tool", "x")), owner("alpha", exclusive("tool", "x"))] });
  assert.deepEqual(result.accepted, ["zeta"]);
  assert.deepEqual([...result.refused.keys()], ["alpha"]);
});

test("refusal is all-or-nothing: a refused owner's other claims do not block a later owner", () => {
  const result = resolveClaimConflicts({
    owners: [owner("a", exclusive("tool", "x")), owner("b", exclusive("tool", "x"), exclusive("widget", "banner")), owner("c", exclusive("widget", "banner"))],
  });
  assert.deepEqual(result.accepted, ["a", "c"]);
  assert.deepEqual(result.refused.get("b")?.map((conflict) => conflict.key), ["x"]);
});

test("an owner repeating its own claim is not a conflict", () => {
  const result = resolveClaimConflicts({ owners: [owner("a", exclusive("tool", "x"), exclusive("tool", "x"))] });
  assert.deepEqual(result.accepted, ["a"]);
});

test("every conflicting claim of a refused owner is reported, once each", () => {
  const result = resolveClaimConflicts({
    owners: [owner("a", exclusive("tool", "x"), exclusive("route", "/y")), owner("b", exclusive("tool", "x"), exclusive("route", "/y"))],
  });
  assert.deepEqual(result.refused.get("b")?.map((conflict) => `${conflict.kind}:${conflict.key}`), ["tool:x", "route:/y"]);
});

test("prefix claims: core reserving `/api/*` and `admin.*` refuses anything inside them, and nothing outside", () => {
  const core = owner("core", exclusive("route", "/api/*"), exclusive("permission", "admin.*"));
  const result = resolveClaimConflicts({
    owners: [core, owner("inside-route", exclusive("route", "GET /api/shop")), owner("inside-permission", exclusive("permission", "admin.shop")), owner("outside", exclusive("route", "GET /shop"), exclusive("permission", "shop.manage"))],
  });
  assert.deepEqual(result.accepted, ["core", "outside"]);
  assert.equal(result.refused.get("inside-route")?.[0]?.heldKey, "/api/*");
});

test("prefix claims: a later prefix covering an earlier exact key conflicts too", () => {
  const result = resolveClaimConflicts({ owners: [owner("a", exclusive("tool", "shop_list")), owner("b", exclusive("tool", "shop_*"))] });
  assert.deepEqual(result.accepted, ["a"]);
});
