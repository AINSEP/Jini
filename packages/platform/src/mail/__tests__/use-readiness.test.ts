import assert from "node:assert/strict";
import { test } from "vitest";
import type { PositionalMailer } from "@jini-ai/core/contracts/mail";
import { mailUseReadinessDepsFrom, readMailUseReadiness, type MailUseLaunchGateDeps, type MailUseReadinessDeps } from "../use-readiness.js";

/**
 * @file Per-use readiness with DI fakes. The host's Newsletter launch gate arrives as
 * `evaluateNewsletterLaunchGate`; the host keeps the suite that runs readiness over its real gate.
 */

const mailer = (driver: string) => ({ capabilities: () => ({ driver }) }) as unknown as PositionalMailer;
const gateDeps: MailUseLaunchGateDeps = { isSendingEnabled: async () => true, consentCapability: {}, originRegistry: { canonicalOrigin: async () => ({}) } as never, mailer: mailer("smtp") };

function deps(overrides: Partial<MailUseReadinessDeps> = {}): MailUseReadinessDeps {
  return {
    workspaceId: "ws", mailer: mailer("smtp"), nowIso: () => "2026-10-22T12:00:00.000Z",
    mailSenderIdentity: { resolve: async () => ({ email: "hello@site.test" }) },
    mailPurposeGate: async () => true,
    formDefinitionRepo: { list: async () => [{ notify: { enabled: true, recipients: ["ops@site.test"] } }] as never },
    ...overrides,
  };
}

const byUse = async (d: MailUseReadinessDeps) => Object.fromEntries((await readMailUseReadiness(d)).uses.map((row) => [row.use, row]));

test("without Newsletter only sign-in and forms are listed, both ready", async () => {
  const report = await readMailUseReadiness(deps());
  assert.equal(report.checkedAt, "2026-10-22T12:00:00.000Z");
  assert.deepEqual(report.uses.map((row) => [row.use, row.state, row.sender]), [["sign_in", "ready", "hello@site.test"], ["form_notifications", "ready", "hello@site.test"]]);
});

test("a Newsletter gate without the host evaluator makes only Newsletter's rows unknown", async () => {
  const rows = await byUse(deps({ newsletterLaunchGate: gateDeps }));
  assert.deepEqual([rows.newsletter_confirmation!.state, rows.newsletter_confirmation!.reasons], ["unknown", ["newsletter_gate_unavailable"]]);
  assert.deepEqual([rows.newsletter!.state, rows.newsletter!.reasons], ["unknown", ["newsletter_gate_unavailable"]]);
  assert.deepEqual([rows.sign_in!.state, rows.form_notifications!.state], ["ready", "ready"]);
});

test("the injected evaluator gets the gate deps and test-send flag; its codes map to states", async () => {
  const calls: [MailUseLaunchGateDeps, string, boolean][] = [];
  const rows = await byUse(deps({
    newsletterLaunchGate: gateDeps,
    evaluateNewsletterLaunchGate: async ({ deps: gate, workspaceId, isTestSend }) => {
      calls.push([gate, workspaceId, isTestSend]);
      return { unmetPreconditions: isTestSend ? [] : ["sending_enabled_false", "mailer_adapter_not_production"] };
    },
  }));
  assert.deepEqual(calls.map(([gate, ws, testSend]) => [gate === gateDeps, ws, testSend]).sort(), [[true, "ws", false], [true, "ws", true]]);
  assert.deepEqual([rows.newsletter_confirmation!.state, rows.newsletter!.state, rows.newsletter!.reasons], ["ready", "disabled", ["sending_enabled_false"]]);
});

test("without a composed sender, a delivering mailer blocks and console keeps the placeholder", async () => {
  const { mailSenderIdentity: _composed, ...noSender } = deps();
  const smtp = await byUse(noSender);
  assert.deepEqual([smtp.sign_in!.state, smtp.sign_in!.reasons, smtp.sign_in!.sender], ["blocked", ["sender_not_configured"], null]);
  const local = await byUse({ ...noSender, mailer: mailer("console") });
  assert.deepEqual([local.sign_in!.state, local.sign_in!.reasons, local.sign_in!.sender], ["not_configured", ["mail_delivery_unavailable"], "no-reply@site.local"]);
});

test("mailUseReadinessDepsFrom builds the gate deps only with an origin registry and campaign repo", async () => {
  const base = { workspaceId: "ws", mailer: mailer("smtp") };
  assert.equal("newsletterLaunchGate" in mailUseReadinessDepsFrom({ ...base, originRegistry: gateDeps.originRegistry }), false);
  const gate = mailUseReadinessDepsFrom({ ...base, originRegistry: gateDeps.originRegistry, newsletterCampaignRepo: {} }).newsletterLaunchGate!;
  assert.deepEqual([await gate.isSendingEnabled("ws"), gate.consentCapability, gate.originRegistry, gate.mailer], [false, null, gateDeps.originRegistry, base.mailer]);
});
