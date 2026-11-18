import assert from "node:assert/strict";
import { test } from "vitest";

import {
  DEFAULT_MAIL_ACTIVITY_LIMIT, getMailActivity, listMailActivity, MailActivityForbiddenError, MailActivityUnavailableError, maskRecipient, readMailActivityId, readMailActivityQuery, resolveMailActivityAccess, type MailActivityDeps,
} from "../activity/activity.js";
import type { MailActivityRecord, MailActivityRepo } from "../activity/ports.js";

/** Neutral ids: the operations are given these by their host and never spell one themselves. */
const READ = "activity.read";
const STATUS = "status.read";
const MANAGE = "suppressions.manage";
const PERMISSION_IDS = { activityRead: READ, status: STATUS, suppressionsManage: MANAGE };

/** @file The mail activity operations with in-memory fakes: input parsing, paging, masking, empty-page labels and detail lookup. */

const AT = (s: number) => new Date(Date.parse("2026-10-22T12:00:00.000Z") + s * 1000).toISOString();

function record(key: string, at: number, overrides: Partial<MailActivityRecord> = {}): MailActivityRecord {
  return { cursorKey: key, idempotencyKey: key, recipient: "ann@example.com", lane: "transactional", providerId: "smtp", use: "sign_in", outcome: "accepted", providerMessageId: `m-${key}`, errorCode: null, message: null, createdAt: AT(at), updatedAt: AT(at + 1), ...overrides };
}

/** Same ordering and keyset semantics as the SQL repo: newest first, `created_at <= c`, OFFSET skip. */
function memoryActivity(rows: MailActivityRecord[], calls: unknown[] = []): MailActivityRepo {
  const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.idempotencyKey.localeCompare(a.idempotencyKey));
  return {
    list: async (required, optional = {}) => {
      calls.push({ ...required, ...optional });
      const matching = sorted.filter((row) => (!optional.before || row.createdAt <= optional.before.createdAt && (row.createdAt !== optional.before.createdAt || row.cursorKey < optional.before.key)) && (!optional.outcome || row.outcome === optional.outcome)
        && (!optional.use || row.use === optional.use) && (!optional.recipient || row.recipient === optional.recipient));
      return matching.slice(0, required.limit);
    },
    get: async ({ idempotencyKey, recipient }) => {
      const found = sorted.find((row) => row.idempotencyKey === idempotencyKey && row.recipient === recipient);
      return found ? { record: found, feedback: [{ kind: "delivered", hardBounce: false, providerId: "smtp", occurredAt: AT(50), receivedAt: AT(51) }] } : null;
    },
  };
}

function grants(list: string[]): MailActivityDeps["authorize"] {
  return async ({ permission }) => ({ allowed: list.includes("*") || list.includes(permission), reason: "fixture" });
}

function activityDeps(rows: MailActivityRecord[], granted = ["*"], calls: unknown[] = []): MailActivityDeps {
  return { workspaceId: "ws", authorize: grants(granted), permissions: PERMISSION_IDS, mailActivity: memoryActivity(rows, calls) };
}

const all = (input: Record<string, unknown> = {}) => readMailActivityQuery({ input });

test("readMailActivityQuery: defaults, string limits from a query string, filters and every refusal", () => {
  assert.deepEqual(all(), { limit: DEFAULT_MAIL_ACTIVITY_LIMIT, filter: {} });
  assert.deepEqual(all({ limit: "10", outcome: "bounced", use: "", recipient: " Ann@Example.com ", cursor: "" }), { limit: 10, filter: { outcome: "bounced", recipient: "ann@example.com" } });
  assert.deepEqual(all({ limit: 5, use: "newsletter" }), { limit: 5, filter: { use: "newsletter" } });
  const cursor = Buffer.from(JSON.stringify({ c: AT(1), k: "key-2" })).toString("base64url");
  assert.deepEqual(all({ cursor }).before, { createdAt: AT(1), key: "key-2" });
  for (const [input, message] of [
    [{ outcome: "sent" }, /outcome must be one of accepted, delivered/], [{ use: 3 }, /use must be one of/],
    [{ limit: 0 }, /limit must be a whole number from 1 to 100/], [{ limit: "1.5" }, /limit/], [{ limit: true }, /limit/],
    [{ recipient: "nobody" }, /recipient must be one email address/], [{ recipient: 7 }, /recipient/],
    [{ cursor: "%%%" }, /cursor is not a nextCursor/], [{ cursor: 9 }, /cursor/],
    [{ cursor: Buffer.from(JSON.stringify({ c: AT(1), s: -1 })).toString("base64url") }, /cursor/],
    [{ cursor: Buffer.from(JSON.stringify({ c: 1, s: 0 })).toString("base64url") }, /cursor/],
  ] as const) assert.throws(() => all(input as Record<string, unknown>), { name: "ToolInputError", message });
});

test("maskRecipient keeps the first letter and the domain only", () => {
  assert.equal(maskRecipient({ address: "ann@example.com" }), "a***@example.com");
  assert.equal(maskRecipient({ address: "@example.com" }), "***");
  assert.equal(maskRecipient({ address: "no-at" }), "***");
});

test("access: activity read is full, the status permission alone is masked, neither is refused", async () => {
  const deps = (list: string[]) => ({ workspaceId: "ws", authorize: grants(list), permissions: PERMISSION_IDS });
  assert.equal(await resolveMailActivityAccess({ deps: deps([READ]), principalId: "p" }), "full");
  assert.equal(await resolveMailActivityAccess({ deps: deps([STATUS]), principalId: "p" }), "masked");
  await assert.rejects(resolveMailActivityAccess({ deps: deps([STATUS]), principalId: "p" }, { requireFull: true }),
    (err: unknown) => err instanceof MailActivityForbiddenError && err.permission === READ && err.message === `principal 'p' is not authorized for '${READ}'`);
  await assert.rejects(resolveMailActivityAccess({ deps: deps([]), principalId: "p" }),
    (err: unknown) => err instanceof MailActivityForbiddenError && err.permission === `${READ} or ${STATUS}`);
});

test("list pages newest first with an opaque cursor that resumes inside a shared timestamp", async () => {
  const rows = [record("a", 1), record("b", 2), record("c", 2), record("d", 2), record("e", 3)];
  const deps = activityDeps(rows);
  const first = await listMailActivity({ ...{ principalId: "p", query: all({ limit: 2 }) }, deps: deps });
  assert.deepEqual(first.items.map((item) => item.id && JSON.parse(Buffer.from(item.id, "base64url").toString())[0]), ["e", "d"]);
  assert.deepEqual([first.access, first.empty], ["full", null]);
  assert.deepEqual(first.items[0], { id: first.items[0]!.id, recipient: "ann@example.com", providerMessageId: "m-e", use: "sign_in", outcome: "accepted", lane: "transactional", providerId: "smtp", errorCode: null, message: null, createdAt: AT(3), updatedAt: AT(4) });
  const second = await listMailActivity({ ...{ principalId: "p", query: all({ limit: 2, cursor: first.nextCursor }) }, deps: deps });
  assert.deepEqual(second.items.map((item) => item.providerMessageId), ["m-c", "m-b"]);
  // The second page ended at the same timestamp it started in: the skip accumulates.
  assert.deepEqual(JSON.parse(Buffer.from(second.nextCursor as string, "base64url").toString()), { c: AT(2), k: "b" });
  const third = await listMailActivity({ ...{ principalId: "p", query: all({ limit: 2, cursor: second.nextCursor }) }, deps: deps });
  assert.deepEqual([third.items.map((item) => item.providerMessageId), third.nextCursor, third.empty], [["m-a"], null, null]);
  const past = await listMailActivity({ ...{ principalId: "p", query: all({ cursor: Buffer.from(JSON.stringify({ c: AT(0), k: "z" })).toString("base64url") }) }, deps: deps });
  assert.deepEqual([past.items, past.empty], [[], null]);
});

test("masked access hides addresses, ids and message ids; a recipient filter needs full access", async () => {
  const calls: unknown[] = [];
  const deps = activityDeps([record("a", 1, { outcome: "bounced", errorCode: null })], [STATUS], calls);
  const page = await listMailActivity({ ...{ principalId: "p", query: all() }, deps: deps });
  assert.deepEqual(page.items, [{ recipient: "a***@example.com", use: "sign_in", outcome: "bounced", lane: "transactional", providerId: "smtp", errorCode: null, createdAt: AT(1), updatedAt: AT(2) }]);
  assert.equal(page.access, "masked");
  assert.deepEqual(calls, [{ workspaceId: "ws", limit: 26 }]);
  await assert.rejects(listMailActivity({ ...{ principalId: "p", query: all({ recipient: "ann@example.com" }) }, deps: deps }), MailActivityForbiddenError);
});

test("empty first pages say whether nothing was recorded or nothing matched; no repo is unavailable", async () => {
  assert.equal((await listMailActivity({ ...{ principalId: "p", query: all() }, deps: activityDeps([]) })).empty, "none_recorded");
  assert.equal((await listMailActivity({ ...{ principalId: "p", query: all({ outcome: "failed" }) }, deps: activityDeps([record("a", 1)]) })).empty, "no_matches");
  await assert.rejects(listMailActivity({ ...{ principalId: "p", query: all() }, deps: { workspaceId: "ws", authorize: grants(["*"]), permissions: PERMISSION_IDS } }), MailActivityUnavailableError);
});

test("get returns the full item with its feedback, null when absent, and needs activity read", async () => {
  const deps = activityDeps([record("a", 1)]);
  const [item] = (await listMailActivity({ ...{ principalId: "p", query: all() }, deps: deps })).items;
  const id = readMailActivityId({ value: item!.id });
  assert.deepEqual(id, { idempotencyKey: "a", recipient: "ann@example.com" });
  const found = await getMailActivity({ ...{ principalId: "p", activityId: id }, deps: deps });
  assert.deepEqual([found?.activity.id, found?.feedback.length], [item!.id, 1]);
  assert.equal(await getMailActivity({ ...{ principalId: "p", activityId: { idempotencyKey: "zz", recipient: "x@y.z" } }, deps: deps }), null);
  await assert.rejects(getMailActivity({ ...{ principalId: "p", activityId: id }, deps: activityDeps([], [STATUS]) }), MailActivityForbiddenError);
  for (const value of [undefined, "", "%%", Buffer.from(JSON.stringify(["only"])).toString("base64url"), Buffer.from(JSON.stringify([1, 2])).toString("base64url")]) {
    assert.throws(() => readMailActivityId({ value }), { name: "ToolInputError", message: /activityId must be an id from mail_list_activity/ });
  }
});

