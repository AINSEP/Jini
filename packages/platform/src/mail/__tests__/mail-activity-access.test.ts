import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getMailActivity, listMailActivity, MailActivityForbiddenError, maskRecipient, nextMailCursor, readMailActivityQuery, readMailCursor, readMailPageLimit, type MailActivityDeps,
} from "../activity/activity.js";
import type { MailActivityRecord, MailActivityRepo, MailFeedbackRecord } from "../activity/ports.js";

/** Neutral ids: the operations are given these by their host and never spell one themselves. */
const READ = "activity.read";
const STATUS = "status.read";
const MANAGE = "suppressions.manage";
const PERMISSION_IDS = { activityRead: READ, status: STATUS, suppressionsManage: MANAGE };

/**
 * @file Security acceptance for the mail activity read path (`../activity/activity.ts`). Every denial case
 * asserts two things: the refusal, and that the repository fake recorded ZERO calls (a refusal that
 * still read the ledger would be a leak even if the caller never saw the rows). The masked tier
 * asserts the COMPLETE key list of an item, so a field added to the masked shape fails here.
 * Paging inputs (limits, cursors) are pinned at their boundaries. The SQL is covered elsewhere.
 */

const AT = (s: number) => new Date(Date.parse("2026-10-22T12:00:00.000Z") + s * 1000).toISOString();

/** Sentinels that must never reach a masked item: each is unique so a leak is findable by text. */
const SECRET_MESSAGE_ID = "provider-message-id-SENTINEL";
const SECRET_DIAGNOSTIC = "mailbox full for ann.private@example.com SENTINEL";
const SECRET_ORIGINAL = "original.person@example.org";
const SECRET_KEY = "idempotency-key-SENTINEL";

function record(overrides: Partial<MailActivityRecord> = {}): MailActivityRecord {
  return {
    cursorKey: "row-1", idempotencyKey: SECRET_KEY, recipient: "ann.private@example.com", lane: "transactional", providerId: "smtp", use: "sign_in", outcome: "bounced",
    providerMessageId: SECRET_MESSAGE_ID, errorCode: "mailbox_full", message: SECRET_DIAGNOSTIC, deliveryMode: "redirect", originalRecipient: SECRET_ORIGINAL,
    createdAt: AT(1), updatedAt: AT(2), ...overrides,
  };
}

const TIMELINE: MailFeedbackRecord[] = [
  { kind: "delivered", hardBounce: false, providerId: "smtp", occurredAt: AT(10), receivedAt: AT(11) },
  { kind: "bounced", hardBounce: true, providerId: "smtp", occurredAt: AT(20), receivedAt: AT(21) },
];

interface Calls { list: unknown[]; get: unknown[]; asked: { principalId: string; permission: string; workspaceId: string; entityType?: string | undefined }[] }

/** A repo that records every call and answers from one row; `calls` is the proof of "never read". */
function fixture(granted: readonly string[], rows: MailActivityRecord[] = [record()]) {
  const calls: Calls = { list: [], get: [], asked: [] };
  const repo: MailActivityRepo = {
    list: async (required, optional = {}) => { calls.list.push({ ...required, ...optional }); return rows.slice(0, required.limit); },
    get: async (required) => { calls.get.push(required); return rows[0] ? { record: rows[0], feedback: TIMELINE } : null; },
  };
  const authorize: MailActivityDeps["authorize"] = async (check) => {
    calls.asked.push({ principalId: check.principalId, permission: check.permission, workspaceId: check.workspaceId, entityType: check.entityType });
    return { allowed: granted.includes(check.permission), reason: "fixture" };
  };
  const deps: MailActivityDeps = { workspaceId: "ws-1", authorize, permissions: PERMISSION_IDS, mailActivity: repo };
  return { deps, calls };
}

const query = (input: Record<string, unknown> = {}) => readMailActivityQuery({ input });
const ID = { idempotencyKey: SECRET_KEY, recipient: "ann.private@example.com" };
const refusedFor = (permission: string) => (err: unknown) => err instanceof MailActivityForbiddenError && err.permission === permission && err.message === `principal 'p' is not authorized for '${permission}'`;

test("no permission: list, filtered list and detail are refused and the ledger is never read", async () => {
  const either = `${READ} or ${STATUS}`;
  const list = fixture([]);
  await assert.rejects(listMailActivity({ principalId: "p", query: query(), deps: list.deps }), refusedFor(either));
  const filtered = fixture([]);
  await assert.rejects(listMailActivity({ principalId: "p", query: query({ recipient: "ann.private@example.com" }), deps: filtered.deps }), refusedFor(READ));
  const detail = fixture([]);
  await assert.rejects(getMailActivity({ principalId: "p", activityId: ID, deps: detail.deps }), refusedFor(READ));
  for (const { calls } of [list, filtered, detail]) assert.deepEqual([calls.list, calls.get], [[], []]);
});

test("a principal with a different permission only (not activity read, not the status permission) gets nothing", async () => {
  const { deps, calls } = fixture(["suppressions.manage", "other.permission"]);
  await assert.rejects(listMailActivity({ principalId: "p", query: query(), deps }), MailActivityForbiddenError);
  await assert.rejects(getMailActivity({ principalId: "p", activityId: ID, deps }), MailActivityForbiddenError);
  assert.deepEqual([calls.list, calls.get], [[], []]);
});

test("a refused caller learns nothing about availability: no repo plus no permission is forbidden, not unavailable", async () => {
  const { deps } = fixture([]);
  const noRepo: MailActivityDeps = { workspaceId: deps.workspaceId, authorize: deps.authorize, permissions: PERMISSION_IDS };
  await assert.rejects(listMailActivity({ principalId: "p", query: query(), deps: noRepo }), MailActivityForbiddenError);
  await assert.rejects(getMailActivity({ principalId: "p", activityId: ID, deps: noRepo }), MailActivityForbiddenError);
});

test("the permission question names the principal, the workspace and the mail entity", async () => {
  const { deps, calls } = fixture([READ]);
  await listMailActivity({ principalId: "p-7", query: query(), deps });
  assert.deepEqual(calls.asked, [{ principalId: "p-7", permission: READ, workspaceId: "ws-1", entityType: "mail" }]);
});

test("status permission only: access is masked and every item has exactly the masked field set", async () => {
  const { deps, calls } = fixture([STATUS]);
  const page = await listMailActivity({ principalId: "p", query: query(), deps });
  assert.equal(page.access, "masked");
  assert.equal(page.items.length, 1);
  const [item] = page.items;
  assert.deepEqual(Object.keys(item!).sort(), ["createdAt", "errorCode", "lane", "outcome", "providerId", "recipient", "updatedAt", "use"]);
  assert.equal(item!.recipient, maskRecipient({ address: "ann.private@example.com" }));
  assert.deepEqual(item, { recipient: "a***@example.com", use: "sign_in", outcome: "bounced", lane: "transactional", providerId: "smtp", errorCode: "mailbox_full", createdAt: AT(1), updatedAt: AT(2) });
  assert.equal(calls.list.length, 1);
});

test("masked output carries no sentinel text anywhere, including the cursor of a full page", async () => {
  const rows = [record({ cursorKey: "row-2", createdAt: AT(2) }), record({ cursorKey: "row-1" })];
  const { deps } = fixture([STATUS], rows);
  const page = await listMailActivity({ principalId: "p", query: query({ limit: 1 }), deps });
  assert.notEqual(page.nextCursor, null);
  const wire = JSON.stringify(page) + Buffer.from(page.nextCursor as string, "base64url").toString("utf8");
  for (const secret of [SECRET_MESSAGE_ID, SECRET_DIAGNOSTIC, SECRET_ORIGINAL, SECRET_KEY, "ann.private", "mailbox full"]) assert.equal(wire.includes(secret), false, `leaked ${secret}`);
});

test("status permission only: a recipient filter and a detail lookup are refused with zero ledger reads", async () => {
  const filtered = fixture([STATUS]);
  await assert.rejects(listMailActivity({ principalId: "p", query: query({ recipient: "ann.private@example.com" }), deps: filtered.deps }), refusedFor(READ));
  const detail = fixture([STATUS]);
  await assert.rejects(getMailActivity({ principalId: "p", activityId: ID, deps: detail.deps }), refusedFor(READ));
  for (const { calls } of [filtered, detail]) assert.deepEqual([calls.list, calls.get], [[], []]);
});

test("activity read permission: access is full and items carry ids, message ids and diagnostics", async () => {
  const { deps, calls } = fixture([READ]);
  const page = await listMailActivity({ principalId: "p", query: query(), deps });
  assert.equal(page.access, "full");
  const [item] = page.items;
  assert.equal(typeof item!.id, "string");
  assert.deepEqual(JSON.parse(Buffer.from(item!.id as string, "base64url").toString("utf8")), [SECRET_KEY, "ann.private@example.com"]);
  assert.deepEqual(item, {
    id: item!.id, recipient: "ann.private@example.com", deliveryMode: "redirect", originalRecipient: SECRET_ORIGINAL, providerMessageId: SECRET_MESSAGE_ID, message: SECRET_DIAGNOSTIC,
    use: "sign_in", outcome: "bounced", lane: "transactional", providerId: "smtp", errorCode: "mailbox_full", createdAt: AT(1), updatedAt: AT(2),
  });
  assert.equal(calls.asked.length, 1, "holding activity read is decided by one question");
});

test("holding both permissions is full, not masked", async () => {
  const { deps } = fixture([STATUS, READ]);
  assert.equal((await listMailActivity({ principalId: "p", query: query(), deps })).access, "full");
});

test("activity read permission: a recipient filter reaches the repo and detail returns the feedback timeline in order", async () => {
  const { deps, calls } = fixture([READ]);
  await listMailActivity({ principalId: "p", query: query({ recipient: " Ann.Private@Example.com " }), deps });
  assert.deepEqual(calls.list, [{ workspaceId: "ws-1", limit: 26, recipient: "ann.private@example.com" }]);
  const detail = await getMailActivity({ principalId: "p", activityId: ID, deps });
  assert.equal(detail?.activity.recipient, "ann.private@example.com");
  assert.equal(typeof detail?.activity.id, "string");
  assert.deepEqual(detail?.feedback, TIMELINE);
  assert.deepEqual(calls.get, [{ workspaceId: "ws-1", ...ID }]);
});

test("maskRecipient: first letter and domain only, for the awkward shapes", () => {
  const table: [string, string][] = [
    ["a@x.test", "a***@x.test"], ["ann@example.com", "a***@example.com"], ["no-at-sign", "***"], ["", "***"], ["@example.com", "***"],
    ["ünï@exämple.com", "ü***@exämple.com"], ["a.b+tag@sub.domain.example.co.uk", "a***@sub.domain.example.co.uk"],
    ["first@middle@last.test", "f***@last.test"], [`a@${"d".repeat(60)}.${"e".repeat(60)}.test`, `a***@${"d".repeat(60)}.${"e".repeat(60)}.test`],
  ];
  for (const [address, masked] of table) assert.equal(maskRecipient({ address }), masked, address);
  assert.equal(maskRecipient({ address: "ann.private@example.com" }).includes("nn.private"), false);
});

test("page limit boundaries: 0 and 101 refused, 1 and 100 kept, absent is the default, non-numbers refused", () => {
  const refusal = { name: "ToolInputError", message: "limit must be a whole number from 1 to 100." };
  for (const value of [0, 101, -1, 1.5, "0", "101", "abc", "1.5", Number.NaN, Infinity, true, null, [], {}]) assert.throws(() => readMailPageLimit({ value }), refusal, String(value));
  assert.deepEqual([1, 100, "1", "100"].map((value) => readMailPageLimit({ value })), [1, 100, 1, 100]);
  assert.deepEqual([undefined, ""].map((value) => readMailPageLimit({ value })), [25, 25]);
});

test("cursor round trip: the cursor a page returns is read back as the same keyset position", async () => {
  const rows = [record({ cursorKey: "row-3", createdAt: AT(3) }), record({ cursorKey: "row-2", createdAt: AT(2) }), record({ cursorKey: "row-1", createdAt: AT(1) })];
  const { deps } = fixture([READ], rows);
  const page = await listMailActivity({ principalId: "p", query: query({ limit: 2 }), deps });
  assert.deepEqual(readMailCursor({ value: page.nextCursor }), { createdAt: AT(2), key: "row-2" });
  assert.deepEqual(readMailCursor({ value: nextMailCursor({ page: [{ createdAt: AT(5), revision: "rev-9" }] }) }), { createdAt: AT(5), key: "rev-9" });
  assert.equal(readMailCursor({ value: undefined }), undefined);
  assert.equal(readMailCursor({ value: "" }), undefined);
});

test("a tampered or malformed cursor is refused as a tool input error", () => {
  const wire = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const bad: unknown[] = [
    "%%%", "not-base64-json", Buffer.from("{broken", "utf8").toString("base64url"), wire(null), wire([]), wire("text"), wire({}), wire({ c: AT(1) }), wire({ k: "row" }),
    wire({ c: 5, k: "row" }), wire({ c: AT(1), k: 5 }), wire({ c: AT(1), k: "" }), wire({ c: null, k: "row" }), 9, true, {},
  ];
  for (const cursor of bad) {
    assert.throws(() => readMailActivityQuery({ input: { cursor } }), { name: "ToolInputError", message: "cursor is not a nextCursor this server returned." }, String(cursor));
  }
});

test("a cursor carries only a timestamp and a row key, never an address", async () => {
  const { deps } = fixture([READ], [record({ cursorKey: "row-2", createdAt: AT(2) }), record({ cursorKey: "row-1" })]);
  const page = await listMailActivity({ principalId: "p", query: query({ limit: 1 }), deps });
  const decoded = JSON.parse(Buffer.from(page.nextCursor as string, "base64url").toString("utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(decoded).sort(), ["c", "k"]);
  assert.equal(JSON.stringify(decoded).includes("@"), false);
});

test("nextMailCursor refuses an empty page: a next cursor is only ever built from a page that has a last row", () => {
  assert.throws(() => nextMailCursor({ page: [] }), { message: "Mail activity page has no last row for its cursor" });
});
