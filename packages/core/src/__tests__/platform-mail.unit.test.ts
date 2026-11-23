import assert from "node:assert/strict";
import { test } from "vitest";

import type {
  ConfiguredMailSender, MailActivityDeps, MailActivityRecord, MailActivityRepo, MailFeedbackInboxPort,
  MailSenderIdentityPort, MailSuppressionAdminRepo, MailSuppressionDeps, MailSuppressionEntry,
} from "../contracts/site/platform-mail.js";

/**
 * @file Type fixture for the mail activity, suppression, feedback-inbox and sender-identity contracts.
 * `pnpm typecheck` compiles this file, so renaming or retyping a field these object literals spell
 * in the core contract fails here. The runtime asserts only check the fixtures round-trip unchanged.
 */

const record: MailActivityRecord = {
  cursorKey: "c1", idempotencyKey: "k1", recipient: "a@example.com", lane: "transactional", providerId: "console",
  use: "sign_in", outcome: "delivered", providerMessageId: null, errorCode: null, message: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};
const entry: MailSuppressionEntry = { address: "a@example.com", scope: "bulk", reason: "manual", createdAt: "2026-01-01T00:00:00Z", revision: "1" };
const mailActivity: MailActivityRepo = {
  list: async () => [record],
  get: async () => ({ record, feedback: [{ kind: "bounced", hardBounce: true, providerId: "console", occurredAt: "t", receivedAt: "t" }] }),
};
const mailSuppressionAdmin: MailSuppressionAdminRepo = {
  list: async () => [entry],
  find: async () => entry,
  remove: async () => null,
  lastFeedbackEvent: async () => ({ kind: "complained", receivedAt: "t" }),
};
const permissions = { activityRead: "mail.activity.read", status: "mail.status", suppressionsManage: "mail.suppressions.manage" };
const authorize: MailActivityDeps["authorize"] = async () => ({ allowed: true, reason: "fixture" });
const activityDeps: MailActivityDeps = { workspaceId: "w1", authorize, permissions, mailActivity };
const suppressionDeps: MailSuppressionDeps = { workspaceId: "w1", authorize, permissions, mailSuppressionAdmin };
const inbox: MailFeedbackInboxPort = { record: async () => "inserted", complete: async () => undefined };
const sender: ConfiguredMailSender = { email: "from@example.com", name: "Site" };
const identity: MailSenderIdentityPort = { resolve: async ({ fallback }) => ({ ...fallback, email: sender.email ?? fallback.email }) };

test("mail activity and suppression deps carry the host's repos and permission ids", async () => {
  assert.deepEqual(await activityDeps.mailActivity?.list({ workspaceId: "w1", limit: 1 }), [record]);
  assert.equal(await suppressionDeps.mailSuppressionAdmin?.find({ workspaceId: "w1", address: entry.address, scope: "bulk" }), entry);
  assert.equal(suppressionDeps.permissions.suppressionsManage, "mail.suppressions.manage");
});

test("feedback inbox and sender identity ports resolve through the fixture", async () => {
  assert.equal(await inbox.record({ providerId: "console", event: { workspaceId: "w1", providerMessageId: "m1", sourceContext: { module: "fixture" }, kind: "bounced", eventId: "e1", recipient: "a@example.com", hardBounce: true, occurredAt: "t" } }), "inserted");
  const from = await identity.resolve({ workspaceId: "w1", fallback: { email: "no-reply@site.local", name: "Site" } });
  assert.equal(from.email, "from@example.com");
});
