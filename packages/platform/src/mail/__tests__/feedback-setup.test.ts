import assert from "node:assert/strict";
import { test } from "vitest";
import type { MailProviderConfiguration } from "@jini-ai/core/contracts/mail";
import type { MailSuppressionAdminRepo } from "@jini-ai/core/contracts/site/platform-mail";
import { mailWebhookSecretLabels } from "../feedback-sources.js";
import { readMailFeedbackSetup, type MailFeedbackSetupDeps } from "../feedback-setup.js";

/**
 * @file Feedback setup's per-provider state with DI fakes (moved from the host's suppressions/feedback
 * suite). The host's credential lister and its product-prefixed secret labels arrive as deps; the
 * host keeps the integration test over its real credential store.
 */

const AT = (s: number) => new Date(Date.parse("2026-10-22T12:00:00.000Z") + s * 1000).toISOString();

type FakeRepo = { listByWorkspace(): Promise<readonly { label: string; updatedAt: string }[]> };

function inbox(): Pick<MailSuppressionAdminRepo, "lastFeedbackEvent"> {
  return { lastFeedbackEvent: async ({ providerId }) => (providerId === "hosted" ? { kind: "delivered", receivedAt: AT(50) } : null) };
}

function provider(id: string, overrides: Partial<MailProviderConfiguration> = {}): MailProviderConfiguration {
  return { id, label: id === "hosted" ? "Hosted" : "Relay", origin: "plugin", hosted: true, lanes: ["transactional", "bulk"], capabilities: { feedback: true, domainVerification: false },
    credential: { required: true, saved: true }, selectable: true, setup: { fields: [] }, ...overrides };
}

type Overrides = { [K in keyof MailFeedbackSetupDeps<FakeRepo>]?: MailFeedbackSetupDeps<FakeRepo>[K] | undefined };

function feedbackDeps(overrides: Overrides = {}): MailFeedbackSetupDeps<FakeRepo> {
  return {
    workspaceId: "ws",
    mailProviderControl: { describe: async () => ({ setting: { transactional: "hosted", bulk: "relay" }, refusals: [], providers: [
      provider("hosted", { lanes: ["transactional"] }), provider("relay", { lanes: ["bulk"] }), provider("idle", { lanes: [] }), provider("smtp", { lanes: ["bulk"], capabilities: { feedback: false, domainVerification: false } }),
    ] }) },
    customCredentialSetRepo: { listByWorkspace: async () => [
      { label: "Site Mail — Hosted Webhook Secret", updatedAt: AT(10) }, { label: "Site Mail — Relay Webhook Secret (previous)", updatedAt: AT(11) },
    ] },
    originRegistry: { canonicalOrigin: async () => ({ scheme: "https", host: "site.test", port: 443, basePath: "/blog" }) as never },
    mailSuppressionAdmin: inbox(),
    listCustomCredentials: ({ repo }) => repo.listByWorkspace(),
    mailWebhookSecretLabels: ({ providerLabel }) => mailWebhookSecretLabels({ providerLabel, labelPrefix: "Site Mail" }),
    ...overrides,
  } as MailFeedbackSetupDeps<FakeRepo>;
}

test("feedback setup per active provider: receiving, no events yet on the previous slot, unsupported", async () => {
  const report = await readMailFeedbackSetup(feedbackDeps());
  assert.equal(report.available, true);
  assert.deepEqual(report.providers.map((p) => [p.providerId, p.state, p.webhookUrl]), [
    ["hosted", "receiving", "https://site.test/blog/hooks/mail/hosted"],
    ["relay", "no_events_yet", "https://site.test/blog/hooks/mail/relay"],
    ["smtp", "unsupported", null],
  ]);
  assert.deepEqual(report.providers[0]!.signingSecret, {
    current: { label: "Site Mail — Hosted Webhook Secret", configured: true, updatedAt: AT(10) },
    previous: { label: "Site Mail — Hosted Webhook Secret (previous)", configured: false, updatedAt: null },
  });
  assert.deepEqual(report.providers[0]!.lastVerifiedEvent, { kind: "delivered", receivedAt: AT(50) });
  assert.deepEqual([report.providers[2]!.signingSecret, report.providers[2]!.lastVerifiedEvent, report.providers[2]!.webhookPath], [null, null, "/hooks/mail/smtp"]);
});

test("feedback setup: missing secrets, unverified origin, non-default ports, and absent seams", async () => {
  const bare = await readMailFeedbackSetup(feedbackDeps({ customCredentialSetRepo: undefined, mailSuppressionAdmin: undefined, originRegistry: undefined }));
  assert.deepEqual(bare.providers.map((p) => [p.state, p.webhookUrl, p.lastVerifiedEvent]), [["secret_missing", null, null], ["secret_missing", null, null], ["unsupported", null, null]]);
  const unverified = await readMailFeedbackSetup(feedbackDeps({ originRegistry: { canonicalOrigin: async () => { throw new Error("unverified"); } } }));
  assert.equal(unverified.providers[0]!.webhookUrl, null);
  const port = await readMailFeedbackSetup(feedbackDeps({ originRegistry: { canonicalOrigin: async () => ({ scheme: "http", host: "localhost", port: 4000 }) as never } }));
  assert.equal(port.providers[0]!.webhookUrl, "http://localhost:4000/hooks/mail/hosted");
  for (const origin of [{ scheme: "http", host: "a.test", port: 80 }, { scheme: "https", host: "a.test" }]) {
    const plain = await readMailFeedbackSetup(feedbackDeps({ originRegistry: { canonicalOrigin: async () => origin as never } }));
    assert.match(plain.providers[0]!.webhookUrl!, /^https?:\/\/a\.test\/hooks\/mail\/hosted$/);
  }
  assert.deepEqual(await readMailFeedbackSetup(feedbackDeps({ mailProviderControl: undefined })), { available: false, providers: [] });
  assert.deepEqual(await readMailFeedbackSetup(feedbackDeps({ mailProviderControl: {} })), { available: false, providers: [] });
});

test("feedback dependency failures propagate without a partial healthy report", async () => {
  for (const overrides of [
    { mailProviderControl: { describe: async () => { throw new Error("describe offline"); } } },
    { customCredentialSetRepo: { listByWorkspace: async () => { throw new Error("credentials offline"); } } },
    { mailSuppressionAdmin: { lastFeedbackEvent: async () => { throw new Error("inbox offline"); } } },
  ]) await assert.rejects(readMailFeedbackSetup(feedbackDeps(overrides)), /offline/);
});
