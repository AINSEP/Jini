import { DatabaseSync } from "node:sqlite";
import { DummyDriver, Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type RawBuilder } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";
import { OriginNotVerifiedError, type OriginRegistryPort } from "@jini-ai/core/contracts/server/verified-origin";
import type { MailerFeedbackEvent, OutboundEmail } from "../../ports.js";
import {
  createMailActivityRepo, createMailAttemptObserver, createMailCaptureRepo, createMailFeedbackInboxRepo,
  createMailSendLedgerRepo, createMailSuppressionAdminRepo, createMailSuppressionRepo, mailActivityUse,
  purgeExpiredMail, type MailSqlKernel,
} from "../index.js";

// Compile the actual adapter queries with Kysely and execute them in SQLite.
// The schema includes the production keys and defaults on which these adapters rely.
function storage() {
  const sqlite = new DatabaseSync(":memory:");
  const compiler = new Kysely<unknown>({ dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: db => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  } });
  sqlite.exec(`
    CREATE TABLE mail_send_ledger (
      workspace_id TEXT, idempotency_key TEXT, recipient TEXT, payload_hash TEXT, lane TEXT,
      provider_id TEXT, outcome TEXT, created_at TEXT, updated_at TEXT, activity_id TEXT,
      activity_retained INTEGER NOT NULL DEFAULT 1, provider_message_id TEXT, error_code TEXT,
      PRIMARY KEY (workspace_id, idempotency_key, recipient)
    );
    CREATE TABLE mail_activity_attempts (
      id TEXT PRIMARY KEY, workspace_id TEXT, idempotency_key TEXT, recipient TEXT,
      effective_recipient TEXT, delivery_mode TEXT, use_id TEXT, lane TEXT, provider_id TEXT,
      outcome TEXT, provider_message_id TEXT, error_code TEXT, message TEXT, created_at TEXT, updated_at TEXT,
      UNIQUE (workspace_id, idempotency_key, recipient)
    );
    CREATE TABLE mail_capture (
      id TEXT PRIMARY KEY, workspace_id TEXT, lane TEXT, idempotency_key TEXT,
      to_address TEXT, subject TEXT, payload_json TEXT, created_at TEXT
    );
    CREATE TABLE mail_feedback_inbox (
      provider_id TEXT, event_id TEXT, workspace_id TEXT, recipient TEXT, kind TEXT,
      hard_bounce INTEGER, provider_message_id TEXT, occurred_at TEXT, received_at TEXT, processed_at TEXT,
      PRIMARY KEY (provider_id, event_id)
    );
    CREATE TABLE mail_suppression (
      workspace_id TEXT, normalized_address TEXT, scope TEXT, reason TEXT, created_at TEXT, revision TEXT,
      PRIMARY KEY (workspace_id, normalized_address, scope)
    );
    CREATE TABLE mail_suppression_removals (
      id TEXT PRIMARY KEY, workspace_id TEXT, normalized_address TEXT, scope TEXT, suppression_reason TEXT,
      suppressed_at TEXT, removal_reason TEXT, removed_by TEXT, removed_at TEXT
    );
  `);
  let active = false;
  const locks: string[] = [];
  const compiled = <Row>(statement: RawBuilder<Row>) => {
    const { sql, parameters } = statement.compile(compiler);
    const bindings = parameters.map(value => {
      if (value === null || typeof value === "number" || typeof value === "string") return value;
      throw new TypeError("Unexpected mail SQL parameter");
    });
    return { statement: sqlite.prepare(sql), bindings };
  };
  const db: MailSqlKernel = {
    dialect: "sqlite",
    transport: "node:sqlite",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    run: async fn => fn(compiler),
    async transaction(fn) {
      if (active) throw new Error("This fixture expects sequential repository transactions");
      sqlite.exec("BEGIN IMMEDIATE");
      active = true;
      try {
        const result = await fn();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        active = false;
      }
    },
    async lockKey(key) {
      if (!active) throw new Error("A transaction must hold the lock");
      locks.push(key);
    },
    inTransaction: () => active,
    require: capability => { if (capability === "backup") throw new Error("Backup is out of scope"); },
    backupTo: async () => { throw new Error("Backup is out of scope"); },
    close: async () => { sqlite.close(); await compiler.destroy(); },
    async query<Row>(query: RawBuilder<Row>) {
      const { statement, bindings } = compiled(query);
      return statement.all(...bindings) as Row[];
    },
    async execute(query) {
      const { statement, bindings } = compiled(query);
      statement.run(...bindings);
    },
  };
  return { db, sqlite, locks };
}

const at = "2026-11-03T12:00:00.000Z";
const later = "2026-11-04T12:00:00.000Z";
const workspaceId = "workspace-one";
const recipient = "member@example.test";
const key = { workspaceId, idempotencyKey: "forms:notify:42", recipient };
const reservation = { ...key, payloadHash: "body-1", lane: "transactional" as const, providerId: "test-provider" };
const message: OutboundEmail = { workspaceId, to: { email: recipient, name: "Member" }, from: { email: "from@example.test", name: "Team" },
  subject: "Subject", text: "private sign-in body", headers: { "X-Test": "private-header" } };
const event = { workspaceId, recipient, eventId: "event-42", providerMessageId: "mail-42", kind: "bounced",
  hardBounce: true, occurredAt: at, sourceContext: { module: "forms" } } satisfies MailerFeedbackEvent;

let store: ReturnType<typeof storage>;
beforeEach(() => { store = storage(); });
afterEach(async () => { await store.db.close(); });

it("retries failed reservations with corrected content without changing adjacent identities", async () => {
  const { db, locks, sqlite } = store;
  let now = at;
  const ledger = createMailSendLedgerRepo({ db }, { nowIso: () => now });
  const adjacent = { ...reservation, recipient: "other@example.test" };
  const otherWorkspace = { ...reservation, workspaceId: "workspace-two" };
  expect(await ledger.reserve(reservation)).toEqual({ status: "reserved" });
  expect(await ledger.reserve(adjacent)).toEqual({ status: "reserved" });
  expect(await ledger.reserve(otherWorkspace)).toEqual({ status: "reserved" });
  expect(await ledger.reserve(reservation)).toEqual({ status: "existing", outcome: "reserved", payloadHash: "body-1" });
  await ledger.mark({ ...key, outcome: "failed", errorCode: "NO_CONNECTION" });
  now = later;
  const corrected = { ...reservation, payloadHash: "body-2", lane: "bulk" as const, providerId: "replacement" };
  expect(await ledger.reserve(corrected)).toEqual({ status: "reserved" });
  expect(sqlite.prepare("SELECT lane, provider_id, error_code, created_at, updated_at FROM mail_send_ledger WHERE workspace_id = ? AND recipient = ?")
    .get(workspaceId, recipient)).toEqual({ lane: "bulk", provider_id: "replacement", error_code: null, created_at: at, updated_at: later });
  await ledger.mark({ ...key, outcome: "sent", providerMessageId: "mail-42" });
  expect(await ledger.reserve(corrected)).toEqual({ status: "existing", outcome: "sent", payloadHash: "body-2", providerMessageId: "mail-42" });
  expect(await ledger.reserve(adjacent)).toEqual({ status: "existing", outcome: "reserved", payloadHash: "body-1" });
  expect(await ledger.reserve(otherWorkspace)).toEqual({ status: "existing", outcome: "reserved", payloadHash: "body-1" });
  expect(locks).toEqual([
    "mail-ledger:workspace-one:forms:notify:42:member@example.test",
    "mail-ledger:workspace-one:forms:notify:42:other@example.test",
    "mail-ledger:workspace-two:forms:notify:42:member@example.test",
    ...Array<string>(5).fill("mail-ledger:workspace-one:forms:notify:42:member@example.test"),
    "mail-ledger:workspace-one:forms:notify:42:other@example.test",
    "mail-ledger:workspace-two:forms:notify:42:member@example.test",
  ]);
});

it("reclaims unknown outcomes only on explicit same-content retry", async () => {
  const ledger = createMailSendLedgerRepo({ db: store.db }, { nowIso: () => at });
  expect(await ledger.reserve(reservation)).toEqual({ status: "reserved" });
  await ledger.mark({ ...key, outcome: "unknown", providerMessageId: "unconfirmed" });
  const unknown = { status: "existing", outcome: "unknown", payloadHash: "body-1", providerMessageId: "unconfirmed" };
  expect(await ledger.reserve(reservation)).toEqual(unknown);
  expect(await ledger.reserve({ ...reservation, payloadHash: "changed" }, { reclaimUnknown: true })).toEqual(unknown);
  expect(await ledger.reserve(reservation, { reclaimUnknown: true })).toEqual({ status: "reserved" });
  expect(await ledger.reserve(reservation, { reclaimUnknown: true })).toEqual({ status: "existing", outcome: "reserved", payloadHash: "body-1" });
});

it("replays incomplete feedback but keeps the original event and isolates provider identities", async () => {
  const { db, sqlite } = store;
  let now = at;
  const inbox = createMailFeedbackInboxRepo({ db }, { nowIso: () => now });
  const first = { providerId: "first", event };
  const second = { providerId: "second", event: { ...event, kind: "delivered" as const, hardBounce: false } };
  expect(await inbox.record(first)).toBe("inserted");
  expect(await inbox.record(second)).toBe("inserted");
  now = later;
  expect(await inbox.record({ ...first, event: { ...event, recipient: "changed@example.test" } })).toBe("inserted");
  await inbox.complete({ providerId: "first", eventId: event.eventId });
  expect(await inbox.record(first)).toBe("duplicate");
  expect(await inbox.record(second)).toBe("inserted");
  const rows = sqlite.prepare("SELECT provider_id, recipient, kind, hard_bounce, received_at, processed_at FROM mail_feedback_inbox ORDER BY provider_id").all();
  expect(rows).toEqual([
    { provider_id: "first", recipient, kind: "bounced", hard_bounce: 1, received_at: at, processed_at: later },
    { provider_id: "second", recipient, kind: "delivered", hard_bounce: 0, received_at: at, processed_at: null },
  ]);
});

it("keeps first suppression evidence and removes only the reviewed workspace and revision with an audit", async () => {
  const { db, sqlite } = store;
  let now = at;
  const sendTime = createMailSuppressionRepo({ db }, { nowIso: () => now });
  const admin = createMailSuppressionAdminRepo({ db }, { nowIso: () => now, newId: () => "removal-42" });
  const address = "percent%under_score@example.test";
  const target = { workspaceId, normalizedAddress: address, scope: "bulk" as const };
  const lookup = { workspaceId, address, scope: "bulk" as const };
  const removal = { ...lookup, removalReason: "Customer confirmed", removedBy: "operator-42" };
  const isSuppressed = (lane: "bulk" | "transactional") => sendTime.isSuppressed({ workspaceId, normalizedAddress: " PERCENT%UNDER_SCORE@EXAMPLE.TEST ", lane });
  expect(await isSuppressed("bulk")).toBe(false);
  expect(await admin.find(lookup)).toBeNull();
  await sendTime.suppress({ ...target, reason: "complained", normalizedAddress: " PERCENT%UNDER_SCORE@EXAMPLE.TEST " });
  now = later;
  await sendTime.suppress({ ...target, reason: "bounced" });
  await sendTime.suppress({ ...target, normalizedAddress: "percentXunderYscore@example.test", reason: "complained" });
  await sendTime.suppress({ ...target, scope: "all", normalizedAddress: "alt+percent%under_score@example.test", reason: "bounced" });
  await sendTime.suppress({ ...target, workspaceId: "workspace-two", reason: "complained" });
  expect(await isSuppressed("bulk")).toBe(true);
  expect(await isSuppressed("transactional")).toBe(false);
  expect(await sendTime.isSuppressed({ workspaceId, normalizedAddress: "alt+" + address, lane: "transactional" })).toBe(true);
  const [entry] = await admin.list({ workspaceId, limit: 10 }, { search: " PERCENT%UNDER_SCORE ", scope: "bulk", reason: "complained" });
  expect(entry).toEqual({ address, scope: "bulk", reason: "complained", createdAt: at,
    revision: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(await admin.list({ workspaceId, limit: 10 }, { search: " PERCENT%UNDER_SCORE ", scope: "bulk", reason: "complained" })).toEqual([entry]);
  expect(await admin.list({ workspaceId, limit: 10 }, { search: " PERCENT%UNDER_SCORE ", scope: "bulk", reason: "bounced" })).toEqual([]);
  expect(await admin.list({ workspaceId, limit: 1 }, { before: { createdAt: at, key: "z" } })).toEqual([entry]);
  expect(await admin.find({ ...lookup, address: " " + address.toUpperCase() })).toEqual(entry);
  expect(await admin.remove({ ...removal, revision: "stale" })).toBeNull();
  expect(await isSuppressed("bulk")).toBe(true);
  expect(sqlite.prepare("SELECT id FROM mail_suppression_removals").all()).toEqual([]);
  if (!entry) throw new Error("Expected the reviewed suppression");
  expect(await admin.remove({ ...removal, revision: entry.revision })).toEqual({
    id: "removal-42", address, scope: "bulk", suppressionReason: "complained",
    suppressedAt: at, removalReason: "Customer confirmed", removedBy: "operator-42", removedAt: later,
  });
  expect(await isSuppressed("bulk")).toBe(false);
  expect(await sendTime.isSuppressed({ workspaceId: "workspace-two", normalizedAddress: address, lane: "bulk" })).toBe(true);
  expect(sqlite.prepare("SELECT * FROM mail_suppression_removals").all()).toEqual([{
    id: "removal-42", workspace_id: workspaceId, normalized_address: address, scope: "bulk", suppression_reason: "complained",
    suppressed_at: at, removal_reason: "Customer confirmed", removed_by: "operator-42", removed_at: later,
  }]);
});

it("reports only the newest processed feedback for the selected provider and workspace", async () => {
  const { db } = store;
  let now = at;
  const inbox = createMailFeedbackInboxRepo({ db }, { nowIso: () => now });
  const admin = createMailSuppressionAdminRepo({ db });
  const scope = { workspaceId, providerId: "first" };
  const add = async (providerId: string, item: typeof event | (Omit<typeof event, "kind" | "hardBounce"> & Pick<MailerFeedbackEvent, "kind" | "hardBounce">), complete: boolean) => {
    expect(await inbox.record({ providerId, event: item })).toBe("inserted");
    if (complete) await inbox.complete({ providerId, eventId: item.eventId });
  };
  expect(await admin.lastFeedbackEvent(scope)).toBeNull();
  await add("first", event, true);
  now = later;
  await add("first", { ...event, eventId: "z-unprocessed", kind: "complained" }, false);
  await add("first", { ...event, workspaceId: "workspace-two", eventId: "z-other-space", kind: "complained" }, true);
  await add("second", { ...event, eventId: "z-other-provider", kind: "delivered" }, true);
  expect(await admin.lastFeedbackEvent(scope)).toEqual({ kind: "bounced", receivedAt: at });
  await inbox.complete({ providerId: "first", eventId: "z-unprocessed" });
  expect(await admin.lastFeedbackEvent(scope)).toEqual({ kind: "complained", receivedAt: later });
});

it.each([
  ["members:signin:1", "sign_in"], ["newsletter:confirm-email:1", "newsletter_confirmation"],
  ["newsletter:1", "newsletter"], ["forms:notify:1", "form_notification"], ["mail:test:1", "test"],
  ["before:members:signin:1", "unknown"],
])("classifies activity key %s as %s", (idempotencyKey, expected) => {
  expect(mailActivityUse({ idempotencyKey })).toBe(expected);
});

it("projects redirected attempts with processed, recipient-matched feedback and preserves original ordering across updates", async () => {
  const { db, sqlite } = store;
  let now = at, id = 0;
  const observer = createMailAttemptObserver({ db }, { nowIso: () => now, newId: () => "attempt-" + ++id });
  const ledger = createMailSendLedgerRepo({ db }, { nowIso: () => now });
  const inbox = createMailFeedbackInboxRepo({ db }, { nowIso: () => now });
  const activity = createMailActivityRepo({ db }, { now: () => Date.parse(later) });
  const redirected = "sandbox@example.test";
  const options = { workspaceId, idempotencyKey: key.idempotencyKey, sourceContext: { module: "forms" }, purpose: "bulk" as const };
  const redirect = { mode: "redirect" as const, to: " SANDBOX@EXAMPLE.TEST " };
  await ledger.reserve(reservation);
  await observer({ message: { ...message, to: { email: " MEMBER@EXAMPLE.TEST " } }, options, mode: redirect, providerId: "test-provider",
    result: { ok: false, unknown: true, retryable: false, errorCode: "TIMEOUT", message: "See https://site.test/auth?token=hidden#private" } });
  const detail = { workspaceId, idempotencyKey: key.idempotencyKey, recipient: redirected };
  expect(await activity.get(detail)).toEqual({ record: { cursorKey: "attempt-1", idempotencyKey: key.idempotencyKey,
    recipient: redirected, originalRecipient: recipient, deliveryMode: "redirect", lane: "bulk", providerId: "test-provider",
    use: "form_notification", outcome: "unknown", providerMessageId: null, errorCode: "TIMEOUT",
    message: "See https://site.test/auth[REDACTED:url_secret_param]", createdAt: at, updatedAt: at }, feedback: [] });
  now = later;
  await observer({ message, options, mode: redirect, providerId: "test-provider",
    result: { ok: true, providerMessageId: "mail-42", acceptedAt: later } });
  const recordFeedback = async (next: MailerFeedbackEvent & { eventId: string; recipient: string }, providerId = "test-provider", processed = true) => {
    await inbox.record({ providerId, event: next });
    if (processed) await inbox.complete({ providerId, eventId: next.eventId });
  };
  await recordFeedback(event); // Original recipient is not the address the provider actually delivered to.
  await recordFeedback({ ...event, eventId: "wrong-provider", recipient: redirected }, "other-provider");
  await recordFeedback({ ...event, eventId: "unprocessed", recipient: redirected, kind: "complained" }, "test-provider", false);
  expect((await activity.get(detail))?.record.outcome).toBe("accepted");
  await recordFeedback({ ...event, eventId: "delivered", recipient: redirected, kind: "delivered", hardBounce: false });
  expect((await activity.get(detail))?.record.outcome).toBe("delivered");
  await recordFeedback({ ...event, eventId: "bounced", recipient: redirected, occurredAt: later });
  expect((await activity.get(detail))?.record.outcome).toBe("bounced");
  await inbox.complete({ providerId: "test-provider", eventId: "unprocessed" });
  expect(await activity.get(detail)).toEqual({
    record: { cursorKey: "attempt-1", idempotencyKey: key.idempotencyKey, recipient: redirected, originalRecipient: recipient,
      deliveryMode: "redirect", lane: "bulk", providerId: "test-provider", use: "form_notification", outcome: "complained",
      providerMessageId: "mail-42", errorCode: null, message: null, createdAt: at, updatedAt: later },
    feedback: [
      { kind: "delivered", hardBounce: false, providerId: "test-provider", occurredAt: at, receivedAt: later },
      { kind: "complained", hardBounce: true, providerId: "test-provider", occurredAt: at, receivedAt: later },
      { kind: "bounced", hardBounce: true, providerId: "test-provider", occurredAt: later, receivedAt: later },
    ],
  });
  expect(await activity.get({ ...detail, recipient })).toBeNull();
  expect((await activity.list({ workspaceId, limit: 10 }, { recipient: " MEMBER@EXAMPLE.TEST ", use: "form_notification" })).map(row => row.cursorKey)).toEqual(["attempt-1"]);
  expect(sqlite.prepare("SELECT message FROM mail_activity_attempts").all()).toEqual([{ message: null }]);
});

it("merges legacy ledger and attempts with a stable keyset and filters outcome before applying the page size", async () => {
  const { db, sqlite } = store;
  let id = 0;
  const observer = createMailAttemptObserver({ db }, { nowIso: () => later, newId: () => "a-" + ++id });
  const ledger = createMailSendLedgerRepo({ db }, { nowIso: () => later });
  const activity = createMailActivityRepo({ db }, { now: () => Date.parse(later) });
  const seed = async (idempotencyKey: string, errorCode: string, cursorKey: string) => {
    await ledger.reserve({ ...reservation, idempotencyKey });
    await ledger.mark({ workspaceId, recipient, idempotencyKey, errorCode, outcome: "failed" });
    sqlite.prepare("UPDATE mail_send_ledger SET activity_id = ? WHERE idempotency_key = ?").run(cursorKey, idempotencyKey);
  };
  await seed("forms:notify:older", "MAIL_RATE_LIMITED", "a-0");
  await seed("newsletter:confirm-email:1", "MAIL_RECIPIENT_SUPPRESSED", "a-4");
  await seed("newsletter:1", "UNKNOWN_PROVIDER_ERROR", "a-5");
  await seed("newsletter:retired", "UNKNOWN_PROVIDER_ERROR", "a-6");
  sqlite.prepare("UPDATE mail_send_ledger SET activity_retained = 0 WHERE activity_id = 'a-6'").run();
  await observer({ message, options: { ...key, sourceContext: { module: "test" } }, mode: { mode: "off" }, providerId: "console",
    result: { ok: true, providerMessageId: "console-42", acceptedAt: later } });
  const firstPage = await activity.list({ workspaceId, limit: 2 });
  expect(firstPage.map(row => [row.cursorKey, row.outcome, row.use])).toEqual([
    ["a-5", "failed", "newsletter"], ["a-4", "suppressed", "newsletter_confirmation"],
  ]);
  expect((await activity.list({ workspaceId, limit: 3 }, { before: { createdAt: later, key: "a-4" } }))
    .map(row => [row.cursorKey, row.outcome, row.use])).toEqual([["a-1", "captured", "form_notification"], ["a-0", "deferred", "form_notification"]]);
  expect((await activity.list({ workspaceId, limit: 1 }, { outcome: "deferred" })).map(row => row.cursorKey)).toEqual(["a-0"]);
  expect((await activity.list({ workspaceId, limit: 2 }, { use: "newsletter_confirmation" })).map(row => row.cursorKey)).toEqual(["a-4"]);
});

it.each(["loopback", "public", "no registry", "unverified"] as const)("applies the sign-in capture privacy policy for %s", async mode => {
  const { db, sqlite } = store;
  const read: OriginRegistryPort["canonicalOrigin"] = async context => {
    if (context.workspaceId !== workspaceId) throw new Error("Origin read for wrong workspace");
    if (mode === "unverified") throw new OriginNotVerifiedError({ message: "No verified origin" });
    return mode === "loopback" ? { scheme: "http", host: "127.0.0.1", source: "dev-capability", verifiedAt: at }
      : { scheme: "https", host: "public.example.test", source: "workspace-setting", verifiedAt: at };
  };
  const origin: OriginRegistryPort = { canonicalOrigin: read, isAllowedRedirectTarget: async () => false, isAllowedEgressTarget: async () => false };
  const repo = createMailCaptureRepo({ db, ...(mode === "no registry" ? {} : { origin }) }, { nowIso: () => at, newId: () => "capture-42" });
  const idempotencyKey = "members:signin:42";
  expect(await repo.capture({ message, lane: "transactional", idempotencyKey })).toEqual({ id: "capture-42" });
  const expected = mode === "loopback" ? message : {
    workspaceId, to: { email: recipient }, from: { email: "from@example.test" },
    subject: "Sign-in email (content redacted)", text: "Authentication content is not stored on public sites.",
  };
  expect(await repo.listCaptured({ workspaceId })).toEqual([
    { id: "capture-42", lane: "transactional", idempotencyKey, to: recipient, subject: expected.subject, message: expected, createdAt: at },
  ]);
  expect(sqlite.prepare("SELECT payload_json FROM mail_capture WHERE id = 'capture-42'").get()?.payload_json).toBe(JSON.stringify(expected));
});

it("propagates an unexpected origin read error without storing sign-in content", async () => {
  const { db } = store;
  const failure = new Error("storage unavailable");
  const origin: OriginRegistryPort = {
    canonicalOrigin: async () => { throw failure; },
    isAllowedRedirectTarget: async () => false,
    isAllowedEgressTarget: async () => false,
  };
  const repo = createMailCaptureRepo({ db, origin });
  await expect(repo.capture({ message, lane: "transactional", idempotencyKey: "members:signin:42" })).rejects.toBe(failure);
  expect(await repo.listCaptured({ workspaceId })).toEqual([]);
});

it("clears only reviewed test mail, counts capture and attempt once, and prevents ledger activity resurrection", async () => {
  const { db, sqlite } = store;
  const ledger = createMailSendLedgerRepo({ db }, { nowIso: () => at });
  const activity = createMailActivityRepo({ db }, { now: () => Date.parse(later) });
  let now = at, captureId = 0, attemptId = 0;
  const repo = createMailCaptureRepo({ db }, { nowIso: () => now, newId: () => "capture-" + ++captureId });
  const observe = createMailAttemptObserver({ db }, { nowIso: () => now, newId: () => "attempt-" + ++attemptId });
  const result = { ok: true as const, providerMessageId: "captured:42", acceptedAt: at };
  const options = { ...key, sourceContext: { module: "forms" } };
  await ledger.reserve(reservation);
  await ledger.mark({ ...key, outcome: "sent", providerMessageId: "captured:42" });
  await repo.capture({ message, lane: "transactional", idempotencyKey: key.idempotencyKey });
  await observe({ message, options, providerId: "test-provider", mode: { mode: "capture" }, result });
  await repo.capture({ message: { ...message, workspaceId: "workspace-two" }, lane: "bulk", idempotencyKey: "foreign" });
  await observe({ message, options: { ...options, idempotencyKey: "became-real" }, mode: { mode: "off" }, providerId: "console", result });
  const plan = await repo.reviewCaptured({ workspaceId });
  expect(plan).toMatchObject({ plan: { count: 2, newestAt: at }, captureIds: ["capture-1"], attemptIds: ["attempt-1", "attempt-2"] });
  expect((await activity.list({ workspaceId, limit: 10 })).map(row => row.cursorKey)).toEqual(["attempt-2", "attempt-1"]);
  now = later;
  await repo.capture({ message, lane: "bulk", idempotencyKey: "arrived-later" });
  await observe({ message, options: { ...options, idempotencyKey: "became-real" }, mode: { mode: "off" }, providerId: "test-provider",
    result: { ok: true, providerMessageId: "real-42", acceptedAt: later } });
  expect((await repo.reviewCaptured({ workspaceId })).revision).not.toBe(plan.revision);
  expect(await repo.clearReviewedCaptures({ workspaceId, captureIds: [...plan.captureIds, "capture-2"], attemptIds: plan.attemptIds })).toEqual({ deleted: 1 });
  expect((await repo.listCaptured({ workspaceId, }, { limit: 0 })).map(row => row.id)).toEqual(["capture-3"]);
  expect((await repo.listCaptured({ workspaceId: "workspace-two" })).map(row => row.id)).toEqual(["capture-2"]);
  expect((await activity.list({ workspaceId, limit: 10 })).map(row => [row.cursorKey, row.outcome])).toEqual([["attempt-2", "accepted"]]);
  expect(await ledger.reserve(reservation)).toEqual({ status: "existing", outcome: "sent", payloadHash: "body-1", providerMessageId: "captured:42" });
  expect(sqlite.prepare("SELECT activity_retained FROM mail_send_ledger").get()).toEqual({ activity_retained: 0 });
  expect(await repo.clearReviewedCaptures({ workspaceId, captureIds: plan.captureIds, attemptIds: plan.attemptIds })).toEqual({ deleted: 0 });
});

it("purges strictly older captures using the capture window, while keeping recent and pending ledger reservations", async () => {
  const { db } = store;
  const now = Date.parse(later);
  let clock = new Date(now - 101).toISOString(), id = 0;
  const repo = createMailCaptureRepo({ db }, { nowIso: () => clock, newId: () => "capture-" + ++id });
  const ledger = createMailSendLedgerRepo({ db }, { nowIso: () => clock });
  const expired = { ...reservation, idempotencyKey: "expired" };
  await ledger.reserve(reservation);
  await ledger.reserve(expired);
  await ledger.mark({ ...expired, outcome: "sent", providerMessageId: "expired-mail" });
  await repo.capture({ message, lane: "transactional", idempotencyKey: "expired" });
  clock = new Date(now - 100).toISOString();
  const boundary = { ...reservation, idempotencyKey: "boundary" };
  await ledger.reserve(boundary);
  await ledger.mark({ ...boundary, outcome: "sent", providerMessageId: "boundary-mail" });
  await repo.capture({ message, lane: "transactional", idempotencyKey: "boundary" });
  await purgeExpiredMail({ db }, { now: () => now, activityRetentionMs: 100, captureRetentionMs: 100 });
  expect((await repo.listCaptured({ workspaceId })).map(row => row.idempotencyKey)).toEqual(["boundary"]);
  expect(await ledger.reserve(reservation)).toEqual({ status: "existing", outcome: "reserved", payloadHash: "body-1" });
  expect(await ledger.reserve(boundary)).toEqual({ status: "existing", outcome: "sent", payloadHash: "body-1", providerMessageId: "boundary-mail" });
  expect(await ledger.reserve(expired)).toEqual({ status: "reserved" });
});

it("lists the newest captures within the requested workspace and normalizes zero to one", async () => {
  const { db } = store;
  let stamp = at, index = 0;
  const repo = createMailCaptureRepo({ db }, { nowIso: () => stamp, newId: () => `capture-${++index}` });
  await repo.capture({ message, lane: "transactional", idempotencyKey: "old" });
  stamp = later;
  await repo.capture({ message, lane: "bulk", idempotencyKey: "new" });
  await repo.capture({ message, lane: "bulk", idempotencyKey: "newest-same-time" });
  await repo.capture({ message: { ...message, workspaceId: "workspace-two" }, lane: "bulk", idempotencyKey: "not-ours" });
  expect((await repo.listCaptured({ workspaceId }, { limit: 0 })).map(row => [row.id, row.idempotencyKey, row.lane]))
    .toEqual([["capture-3", "newest-same-time", "bulk"]]);
  expect((await repo.listCaptured({ workspaceId }, { limit: 2 })).map(row => row.id)).toEqual(["capture-3", "capture-2"]);
});
