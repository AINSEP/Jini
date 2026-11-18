import assert from "node:assert/strict";
import { test } from "vitest";

import { MailActivityForbiddenError } from "../activity/activity.js";
import type { MailSuppressionAdminRepo, MailSuppressionEntry } from "../activity/ports.js";
import {
  listMailSuppressions, MailSuppressionsUnavailableError, planMailSuppressionRemoval, readMailSuppressionQuery, readMailSuppressionRemoval, runMailSuppressionRemoval, type MailSuppressionDeps,
} from "../activity/suppressions.js";

/** Neutral ids: the operations are given these by their host and never spell one themselves. */
const READ = "activity.read";
const STATUS = "status.read";
const MANAGE = "suppressions.manage";
const PERMISSION_IDS = { activityRead: READ, status: STATUS, suppressionsManage: MANAGE };

/** @file The suppression operations with in-memory fakes: list input, paging, removal input, plan warnings and the run. */

const AT = (s: number) => new Date(Date.parse("2026-10-22T12:00:00.000Z") + s * 1000).toISOString();

function entry(address: string, at: number, overrides: Partial<MailSuppressionEntry> = {}): MailSuppressionEntry {
  return { revision: address, address, scope: "all", reason: "bounced", createdAt: AT(at), ...overrides };
}

function memoryRepo(rows: MailSuppressionEntry[], removed: unknown[] = []): MailSuppressionAdminRepo {
  let store = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.address.localeCompare(a.address));
  return {
    list: async (required, optional = {}) => store.filter((row) => (!optional.before || row.createdAt < optional.before.createdAt || (row.createdAt === optional.before.createdAt && row.revision < optional.before.key)) && (!optional.scope || row.scope === optional.scope)
      && (!optional.reason || row.reason === optional.reason) && (!optional.search || row.address.includes(optional.search))).slice(0, required.limit),
    find: async ({ address, scope }) => store.find((row) => row.address === address && row.scope === scope) ?? null,
    remove: async (required) => {
      const found = store.find((row) => row.address === required.address && row.scope === required.scope && row.revision === required.revision);
      if (!found) return null;
      store = store.filter((row) => row !== found);
      const removal = { id: "r1", address: found.address, scope: found.scope, suppressionReason: found.reason, suppressedAt: found.createdAt, removalReason: required.removalReason, removedBy: required.removedBy, removedAt: AT(99) };
      removed.push(removal);
      return removal;
    },
    lastFeedbackEvent: async ({ providerId }) => (providerId === "hosted" ? { kind: "delivered", receivedAt: AT(50) } : null),
  };
}

function grantsFor(list: string[]) {
  const allowed = new Set(list);
  return { allowed, authorize: (async ({ permission }: { permission: string }) => ({ allowed: allowed.has("*") || allowed.has(permission), reason: "fixture" })) as MailSuppressionDeps["authorize"] };
}

function deps(rows: MailSuppressionEntry[], list = ["*"], removed: unknown[] = []): MailSuppressionDeps {
  return { ownerPrincipalId: Promise.resolve("owner"), workspaceId: "ws", authorize: grantsFor(list).authorize, permissions: PERMISSION_IDS, mailSuppressionAdmin: memoryRepo(rows, removed) };
}

test("readMailSuppressionQuery: defaults, filters, blank search and every refusal", () => {
  assert.deepEqual(readMailSuppressionQuery({ input: {} }), { limit: 25, filter: {} });
  assert.deepEqual(readMailSuppressionQuery({ input: { search: " example.com ", scope: "bulk", reason: "complained", limit: "5" } }), { limit: 5, filter: { search: "example.com", scope: "bulk", reason: "complained" } });
  assert.deepEqual(readMailSuppressionQuery({ input: { search: "   ", scope: "", reason: "" } }).filter, {});
  for (const input of [{ scope: "everything" }, { reason: "spam" }, { search: 5 }, { search: "x".repeat(255) }, { cursor: "%%" }]) {
    assert.throws(() => readMailSuppressionQuery({ input }), { name: "ToolInputError" });
  }
});

test("listMailSuppressions needs activity read, pages with a cursor and labels empty pages", async () => {
  const rows = [entry("a@x.test", 1), entry("b@x.test", 2), entry("c@x.test", 2, { scope: "bulk", reason: "complained" })];
  const first = await listMailSuppressions({ ...{ principalId: "p", query: readMailSuppressionQuery({ input: { limit: 2 } }) }, deps: deps(rows) });
  assert.deepEqual([first.items.map((row) => row.address), first.empty], [["c@x.test", "b@x.test"], null]);
  const second = await listMailSuppressions({ ...{ principalId: "p", query: readMailSuppressionQuery({ input: { limit: 2, cursor: first.nextCursor } }) }, deps: deps(rows) });
  assert.deepEqual([second.items, second.nextCursor, second.empty], [[entry("a@x.test", 1)], null, null]);
  assert.equal((await listMailSuppressions({ ...{ principalId: "p", query: readMailSuppressionQuery({ input: {} }) }, deps: deps([]) })).empty, "none_recorded");
  assert.equal((await listMailSuppressions({ ...{ principalId: "p", query: readMailSuppressionQuery({ input: { reason: "manual" } }) }, deps: deps(rows) })).empty, "no_matches");
  await assert.rejects(listMailSuppressions({ ...{ principalId: "p", query: readMailSuppressionQuery({ input: {} }) }, deps: deps(rows, [STATUS]) }),
    (err: unknown) => err instanceof MailActivityForbiddenError && err.permission === READ);
  await assert.rejects(listMailSuppressions({ ...{ principalId: "p", query: readMailSuppressionQuery({ input: {} }) }, deps: { workspaceId: "ws", authorize: grantsFor(["*"]).authorize, permissions: PERMISSION_IDS } }), MailSuppressionsUnavailableError);
});

test("readMailSuppressionRemoval normalizes the address and requires a scope and a 3-500 character reason", () => {
  assert.deepEqual(readMailSuppressionRemoval({ input: { address: " Ann@X.test ", scope: "all", reason: "  mailbox fixed  " } }), { address: "ann@x.test", scope: "all", reason: "mailbox fixed" });
  for (const [input, message] of [
    [{ address: "nobody", scope: "all", reason: "fine" }, /address must be the suppressed email address/],
    [{ address: 3, scope: "all", reason: "fine" }, /address/],
    [{ address: `${"a".repeat(250)}@x.test`, scope: "all", reason: "fine" }, /address/],
    [{ address: "a@x.test", reason: "fine" }, /scope must be one of all, bulk/],
    [{ address: "a@x.test", scope: "all" }, /reason is required/],
    [{ address: "a@x.test", scope: "all", reason: " ok " }, /reason is required/],
    [{ address: "a@x.test", scope: "all", reason: "x".repeat(501) }, /reason is required.*Nothing was changed/],
  ] as const) assert.throws(() => readMailSuppressionRemoval({ input: input as Record<string, unknown> }), { name: "ToolInputError", message });
});

test("removal plan warns per original reason and never implies consent; run re-checks and records who and why", async () => {
  const removed: unknown[] = [];
  const rows = [entry("a@x.test", 1), entry("b@x.test", 2, { scope: "bulk", reason: "complained" }), entry("c@x.test", 3, { reason: "manual" })];
  const d = deps(rows, [MANAGE], removed);
  const bounced = await planMailSuppressionRemoval({ ...{ principalId: "owner", input: { address: "a@x.test", scope: "all", reason: "fixed" } }, deps: d });
  assert.deepEqual([bounced.suppressionReason, bounced.suppressedAt, bounced.warnings.length], ["bounced", AT(1), 2]);
  assert.match(bounced.warnings[0]!, /hard-bounced/);
  assert.match(bounced.warnings[1]!, /does not subscribe this address or restore newsletter consent/);
  assert.match((await planMailSuppressionRemoval({ ...{ principalId: "owner", input: { address: "b@x.test", scope: "bulk", reason: "ok!" } }, deps: d })).warnings[0]!, /marked the site's mail as spam/);
  assert.equal((await planMailSuppressionRemoval({ ...{ principalId: "owner", input: { address: "c@x.test", scope: "all", reason: "ok!" } }, deps: d })).warnings.length, 1);
  await assert.rejects(planMailSuppressionRemoval({ ...{ principalId: "owner", input: { address: "a@x.test", scope: "bulk", reason: "fixed" } }, deps: d }), { name: "ToolInputError", message: /a@x.test is not suppressed for bulk mail/ });
  assert.deepEqual(await runMailSuppressionRemoval({ ...{ principalId: "owner", plan: bounced }, deps: d }), { removed: true, removal: removed[0] });
  assert.deepEqual(removed[0], { id: "r1", address: "a@x.test", scope: "all", suppressionReason: "bounced", suppressedAt: AT(1), removalReason: "fixed", removedBy: "owner", removedAt: AT(99) });
  assert.deepEqual(await runMailSuppressionRemoval({ ...{ principalId: "owner", plan: bounced }, deps: d }), { removed: false });
  await assert.rejects(planMailSuppressionRemoval({ ...{ principalId: "admin", input: { address: "c@x.test", scope: "all", reason: "ok!" } }, deps: deps(rows, [READ, STATUS]) }),
    (err: unknown) => err instanceof MailActivityForbiddenError && err.permission === MANAGE);
});
