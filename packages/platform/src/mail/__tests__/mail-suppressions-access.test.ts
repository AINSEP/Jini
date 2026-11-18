import assert from "node:assert/strict";
import { test } from "vitest";

import { MailActivityForbiddenError } from "../activity/activity.js";
import type { MailSuppressionAdminRepo, MailSuppressionEntry } from "../activity/ports.js";
import {
  listMailSuppressions, planMailSuppressionRemoval, readMailSuppressionQuery, runMailSuppressionRemoval, type MailSuppressionDeps, type MailSuppressionRemovalInput,
} from "../activity/suppressions.js";

/** Neutral ids: the operations are given these by their host and never spell one themselves. */
const READ = "activity.read";
const STATUS = "status.read";
const MANAGE = "suppressions.manage";
const PERMISSION_IDS = { activityRead: READ, status: STATUS, suppressionsManage: MANAGE };

/**
 * @file Security acceptance for the suppression list and its removal (`../activity/suppressions.ts`).
 * Removal has TWO gates that are tested separately: the suppressions-manage permission, and the
 * owner comparison, which holding the permission does not satisfy. Every refusal asserts that the repository fake recorded ZERO calls, so a
 * refused caller neither reads nor changes the do-not-send list.
 */

const AT = (s: number) => new Date(Date.parse("2026-10-22T12:00:00.000Z") + s * 1000).toISOString();
const OWNER_ONLY = "Only the site owner may remove a suppression.";

interface Fixture {
  deps: MailSuppressionDeps;
  repoCalls: string[];
  removals: { removedBy: string; revision: string; removalReason: string }[];
  grant: Set<string>;
  store: MailSuppressionEntry[];
}

function entry(overrides: Partial<MailSuppressionEntry> = {}): MailSuppressionEntry {
  return { address: "ann@example.com", scope: "all", reason: "bounced", createdAt: AT(1), revision: "rev-1", ...overrides };
}

/**
 * Recording repo with the real repo's claim rule: remove deletes only the reviewed revision.
 * `grant` is mutable so a test can revoke a permission between plan and run.
 */
function fixture(granted: readonly string[], options: { owner?: Promise<string> | null; withRepo?: boolean } = {}): Fixture {
  const repoCalls: string[] = [];
  const removals: Fixture["removals"] = [];
  const grant = new Set(granted);
  const store: MailSuppressionEntry[] = [entry()];
  const repo: MailSuppressionAdminRepo = {
    list: async (required) => { repoCalls.push("list"); return store.slice(0, required.limit); },
    find: async ({ address, scope }) => { repoCalls.push("find"); return store.find((row) => row.address === address && row.scope === scope) ?? null; },
    remove: async (required) => {
      repoCalls.push("remove");
      const found = store.find((row) => row.address === required.address && row.scope === required.scope && row.revision === required.revision);
      if (!found) return null;
      store.splice(store.indexOf(found), 1);
      removals.push({ removedBy: required.removedBy, revision: required.revision, removalReason: required.removalReason });
      return { id: "r1", address: found.address, scope: found.scope, suppressionReason: found.reason, suppressedAt: found.createdAt, removalReason: required.removalReason, removedBy: required.removedBy, removedAt: AT(99) };
    },
    lastFeedbackEvent: async () => { repoCalls.push("lastFeedbackEvent"); return null; },
  };
  const owner = options.owner === undefined ? Promise.resolve("owner") : options.owner;
  const deps: MailSuppressionDeps = {
    workspaceId: "ws-1",
    authorize: async ({ permission }) => ({ allowed: grant.has(permission), reason: "fixture" }),
    permissions: PERMISSION_IDS,
    ...(owner ? { ownerPrincipalId: owner } : {}),
    ...(options.withRepo === false ? {} : { mailSuppressionAdmin: repo }),
  };
  return { deps, repoCalls, removals, grant, store };
}

const INPUT: MailSuppressionRemovalInput = { address: "ann@example.com", scope: "all", reason: "mailbox fixed" };
const plan = (f: Fixture, principalId: string) => planMailSuppressionRemoval({ principalId, input: INPUT, deps: f.deps });
const notAuthorized = (principalId: string, permission: string) => (err: unknown) =>
  err instanceof MailActivityForbiddenError && err.permission === permission && err.message === `principal '${principalId}' is not authorized for '${permission}'`;
const ownerOnly = (err: unknown) => err instanceof MailActivityForbiddenError && err.permission === MANAGE && err.message === OWNER_ONLY;

test("listing needs activity read: no permission, the status permission and the manage permission alone are all refused with zero reads", async () => {
  for (const granted of [[], [STATUS], [MANAGE]]) {
    const f = fixture(granted);
    await assert.rejects(listMailSuppressions({ principalId: "p", query: readMailSuppressionQuery({ input: {} }), deps: f.deps }), notAuthorized("p", READ));
    assert.deepEqual(f.repoCalls, [], `granted ${granted.join(",") || "nothing"}`);
  }
});

test("listing with activity read works for a non-owner: the owner gate applies to removal only", async () => {
  const f = fixture([READ]);
  const page = await listMailSuppressions({ principalId: "not-the-owner", query: readMailSuppressionQuery({ input: {} }), deps: f.deps });
  assert.deepEqual(page.items, [entry()]);
  assert.deepEqual(f.repoCalls, ["list"]);
});

test("a refused caller learns nothing about availability: no repo plus no permission is forbidden, not unavailable", async () => {
  const f = fixture([], { withRepo: false });
  await assert.rejects(listMailSuppressions({ principalId: "p", query: readMailSuppressionQuery({ input: {} }), deps: f.deps }), MailActivityForbiddenError);
  await assert.rejects(plan(f, "owner"), MailActivityForbiddenError);
});

test("removal: a non-owner who holds the manage permission is refused in plan and in run, with zero repo calls", async () => {
  const f = fixture([MANAGE]);
  await assert.rejects(plan(f, "admin"), ownerOnly);
  const forged = { ...INPUT, suppressionReason: "bounced" as const, suppressedAt: AT(1), revision: "rev-1", warnings: [] };
  await assert.rejects(runMailSuppressionRemoval({ principalId: "admin", plan: forged, deps: f.deps }), ownerOnly);
  assert.deepEqual([f.repoCalls, f.removals, f.store.length], [[], [], 1]);
});

test("removal: the owner holding the manage permission plans and removes, recording who and why", async () => {
  const f = fixture([MANAGE]);
  const planned = await plan(f, "owner");
  assert.equal(planned.revision, "rev-1");
  assert.deepEqual(await runMailSuppressionRemoval({ principalId: "owner", plan: planned, deps: f.deps }), {
    removed: true,
    removal: { id: "r1", address: "ann@example.com", scope: "all", suppressionReason: "bounced", suppressedAt: AT(1), removalReason: "mailbox fixed", removedBy: "owner", removedAt: AT(99) },
  });
  assert.deepEqual([f.repoCalls, f.removals], [["find", "remove"], [{ removedBy: "owner", revision: "rev-1", removalReason: "mailbox fixed" }]]);
});

test("removal: the owner WITHOUT the manage permission is refused with the permission wording, zero repo calls", async () => {
  const f = fixture([READ, STATUS]);
  await assert.rejects(plan(f, "owner"), notAuthorized("owner", MANAGE));
  assert.deepEqual([f.repoCalls, f.removals], [[], []]);
});

test("removal: with no owner known (ownerPrincipalId absent) everyone is refused, even with the permission", async () => {
  const f = fixture([MANAGE], { owner: null });
  for (const principalId of ["owner", "admin", "undefined", ""]) await assert.rejects(plan(f, principalId), ownerOnly, principalId);
  assert.deepEqual(f.repoCalls, []);
});

test("removal: an owner lookup that resolves to another principal refuses a holder of the permission", async () => {
  const f = fixture([MANAGE], { owner: Promise.resolve("someone-else") });
  await assert.rejects(plan(f, "owner"), ownerOnly);
  assert.deepEqual(f.repoCalls, []);
});

test("removal: authorization revoked between plan and run refuses the run and removes nothing", async () => {
  const f = fixture([MANAGE]);
  const planned = await plan(f, "owner");
  assert.deepEqual(f.repoCalls, ["find"]);
  f.grant.delete(MANAGE);
  await assert.rejects(runMailSuppressionRemoval({ principalId: "owner", plan: planned, deps: f.deps }), notAuthorized("owner", MANAGE));
  assert.deepEqual([f.repoCalls, f.removals, f.store.length], [["find"], [], 1]);
});

test("removal: ownership lost between plan and run refuses the run as well", async () => {
  const f = fixture([MANAGE]);
  const planned = await plan(f, "owner");
  const transferred = { ...f.deps, ownerPrincipalId: Promise.resolve("new-owner") };
  await assert.rejects(runMailSuppressionRemoval({ principalId: "owner", plan: planned, deps: transferred }), ownerOnly);
  assert.deepEqual([f.repoCalls, f.removals], [["find"], []]);
});

test("removal: an entry replaced between plan and run is NOT removed (the run claims the planned revision only)", async () => {
  const f = fixture([MANAGE]);
  const planned = await plan(f, "owner");
  f.store.splice(0, 1, entry({ revision: "rev-2", reason: "complained", createdAt: AT(5) }));
  assert.deepEqual(await runMailSuppressionRemoval({ principalId: "owner", plan: planned, deps: f.deps }), { removed: false });
  assert.deepEqual([f.removals, f.store.map((row) => row.revision)], [[], ["rev-2"]]);
});

test("removal: an entry already removed between plan and run answers removed:false, not an error", async () => {
  const f = fixture([MANAGE]);
  const planned = await plan(f, "owner");
  f.store.splice(0, 1);
  assert.deepEqual(await runMailSuppressionRemoval({ principalId: "owner", plan: planned, deps: f.deps }), { removed: false });
});
