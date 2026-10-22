import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { createMailFeedbackIngest, suppressionScopeFor, type MailFeedbackInboxPort } from "../feedback.js";
import type { MailFeedbackParser } from "../provider.js";
import type { MailSuppressionRepoPort } from "../ports.js";
import type { MailerFeedbackEvent } from "../types.js";

const BASE: MailerFeedbackEvent = { workspaceId: "ws-1", providerMessageId: "pm-1", sourceContext: { module: "newsletter" }, kind: "bounced", hardBounce: true, occurredAt: "2026-10-21T00:00:00Z", eventId: "e1", recipient: " A@Example.com " };
const BODY = new TextEncoder().encode("{}");

function harness(optional: { events?: readonly MailerFeedbackEvent[] | { error: string }; secrets?: string[]; verified?: boolean; failSuppressOnce?: boolean } = {}) {
  const suppressed: unknown[] = [];
  // key -> processed? An unprocessed row is handed back as "inserted" so the event is re-applied.
  const seen = new Map<string, boolean>();
  const inbox: MailFeedbackInboxPort = {
    async record({ providerId, event }) {
      const key = `${providerId}|${event.eventId}`;
      if (seen.get(key) === true) return "duplicate";
      seen.set(key, false);
      return "inserted";
    },
    async complete({ providerId, eventId }) { seen.set(`${providerId}|${eventId}`, true); },
  };
  let failSuppress = optional.failSuppressOnce ?? false;
  const suppression: MailSuppressionRepoPort = {
    isSuppressed: async () => false,
    async suppress(input) {
      if (failSuppress) { failSuppress = false; throw new Error("db down"); }
      suppressed.push(input);
    },
  };
  const parser: MailFeedbackParser = { verify: ({ headers }) => optional.verified ?? headers["x-sig"] !== "forged", parse: () => optional.events ?? [BASE] };
  const deps = {
    parserFor: ({ providerId }: { providerId: string }) => (providerId === "resend" ? parser : undefined),
    secretsFor: async () => optional.secrets ?? ["whsec_1"],
    inbox,
    suppression,
  };
  return { deps, suppressed };
}

const REQUEST = { providerId: "resend", workspaceId: "ws-1", rawBody: BODY, headers: {} };

describe("suppressionScopeFor", () => {
  test("hard bounce → all, soft bounce → none, complaint → bulk, delivered → none", () => {
    assert.equal(suppressionScopeFor({ event: BASE }), "all");
    assert.equal(suppressionScopeFor({ event: { ...BASE, hardBounce: false } }), null);
    assert.equal(suppressionScopeFor({ event: { ...BASE, kind: "complained" } }), "bulk");
    assert.equal(suppressionScopeFor({ event: { ...BASE, kind: "delivered" } }), null);
  });
});

describe("createMailFeedbackIngest", () => {
  test("applies once, suppresses with normalized address, replays are duplicates, subscriber notified", async () => {
    const { deps, suppressed } = harness({ events: [BASE, { ...BASE, eventId: "e2", kind: "complained" }, { ...BASE, eventId: "e3", kind: "delivered" }] });
    const notified: string[] = [];
    const ingest = createMailFeedbackIngest(deps, { onEvent: async ({ event }) => { notified.push(event.eventId!); } });
    assert.deepEqual(await ingest.handle(REQUEST), { status: 200, body: { ok: true, applied: 3, duplicates: 0 } });
    assert.deepEqual(suppressed, [
      { workspaceId: "ws-1", normalizedAddress: "a@example.com", scope: "all", reason: "bounced" },
      { workspaceId: "ws-1", normalizedAddress: "a@example.com", scope: "bulk", reason: "complained" },
    ]);
    assert.deepEqual(notified, ["e1", "e2", "e3"]);
    assert.deepEqual(await ingest.handle(REQUEST), { status: 200, body: { ok: true, applied: 0, duplicates: 3 } });
    assert.equal(suppressed.length, 2);
  });
  test("a suppression failure leaves the event incomplete, so the provider's replay re-applies it", async () => {
    const { deps, suppressed } = harness({ failSuppressOnce: true });
    const ingest = createMailFeedbackIngest(deps);
    await assert.rejects(ingest.handle(REQUEST), /db down/);
    assert.equal(suppressed.length, 0);
    assert.deepEqual(await ingest.handle(REQUEST), { status: 200, body: { ok: true, applied: 1, duplicates: 0 } });
    assert.deepEqual(suppressed, [{ workspaceId: "ws-1", normalizedAddress: "a@example.com", scope: "all", reason: "bounced" }]);
    assert.deepEqual(await ingest.handle(REQUEST), { status: 200, body: { ok: true, applied: 0, duplicates: 1 } });
  });
  test("events without id or recipient are dropped", async () => {
    const { eventId: _id, ...noId } = BASE;
    const { recipient: _to, ...noRecipient } = BASE;
    const { deps } = harness({ events: [noId, { ...BASE, eventId: "" }, { ...BASE, recipient: "" }, noRecipient] });
    assert.deepEqual(await createMailFeedbackIngest(deps).handle(REQUEST), { status: 200, body: { ok: true, applied: 0, duplicates: 0 } });
  });
  test("unknown provider 404, oversize 413, no secret 503, parse error 400", async () => {
    const { deps } = harness();
    const ingest = createMailFeedbackIngest(deps, { maxBodyBytes: 1 });
    assert.equal((await ingest.handle({ ...REQUEST, providerId: "smtp" })).status, 404);
    assert.equal((await ingest.handle(REQUEST)).status, 413);
    assert.equal((await createMailFeedbackIngest(harness({ secrets: [] }).deps).handle(REQUEST)).status, 503);
    assert.deepEqual(await createMailFeedbackIngest(harness({ events: { error: "bad json" } }).deps).handle(REQUEST), { status: 400, body: { ok: false, error: "bad json" } });
  });
  test("unverified requests 401 and then 429 within the window; the window resets", async () => {
    let now = 0;
    const ingest = createMailFeedbackIngest(harness({ verified: false }).deps, { maxUnverifiedPerWindow: 2, windowMs: 1000, now: () => now });
    assert.equal((await ingest.handle(REQUEST)).status, 401);
    assert.equal((await ingest.handle(REQUEST)).status, 401);
    assert.equal((await ingest.handle(REQUEST)).status, 429);
    now = 1000;
    assert.equal((await ingest.handle(REQUEST)).status, 401);
  });
  test("exhausting the unverified allowance never blocks a correctly signed delivery", async () => {
    const { deps, suppressed } = harness();
    const ingest = createMailFeedbackIngest(deps, { maxUnverifiedPerWindow: 2, windowMs: 1000, now: () => 0 });
    const forged = { ...REQUEST, headers: { "x-sig": "forged" } };
    for (const expected of [401, 401, 429, 429]) assert.equal((await ingest.handle(forged)).status, expected);
    assert.deepEqual(await ingest.handle(REQUEST), { status: 200, body: { ok: true, applied: 1, duplicates: 0 } });
    assert.equal(suppressed.length, 1);
  });
});
