import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { MailAdapterModule } from "../adapter-module.js";
import { createConsoleMailProvider } from "../builtin-providers.js";
import type { MailCredentialPort, MailProviderCatalog, MailProviderSettingPort, MailStatusReport, SenderDomainVerificationPort } from "../engine-contracts.js";
import { computeMailStatus, createMailProviderRegistry, validateMailProvider } from "../provider.js";
import type { MailerSendOptions, MailerSendRequired, MailTestApproval, MailTestModeSetting } from "../types.js";

const clock = { nowMs: () => 0 };
const httpClient: HttpClientPort = { send: async () => { throw new Error("Unexpected HTTP request"); } };
const delivery: MailerSendRequired = {
  workspaceId: "w", idempotencyKey: "k", sourceContext: { module: "mail" },
  message: { workspaceId: "w", to: { email: "to@example.com" }, from: { email: "from@example.com" }, subject: "Contract" },
};

describe("mail adapter compatibility", () => {
  test("legacy create-only adapters keep single and batch signatures", async () => {
    const adapter: MailAdapterModule = createConsoleMailProvider({ clock }, { log: () => {} });
    assert.equal(adapter.domainReadConnection, undefined);
    const mailer = adapter.create({ credential: { token: "sending" }, kit: { httpClient } });
    assert.equal(mailer.capabilities({}).driver, "console");
    assert.deepEqual(await mailer.send(delivery), { ok: true, providerMessageId: "console-1", acceptedAt: "1970-01-01T00:00:00.000Z" });
    const { message, ...identity } = delivery;
    assert.deepEqual(await mailer.sendBatch({ ...identity, messages: [message] }, {}),
      [{ ok: true, providerMessageId: "console-2", acceptedAt: "1970-01-01T00:00:00.000Z" }]);
  });

  test("optional domain-read metadata survives registration without entering sending context", async () => {
    const provider = {
      ...createConsoleMailProvider({ clock }, { log: () => {} }),
      domainReadConnection: { serverId: "domain-reader", baseUrl: "https://api.example.com" },
    };
    assert.equal(validateMailProvider({ provider }), undefined);
    const registry = createMailProviderRegistry({}, { builtins: [provider] });
    assert.deepEqual(registry.get({ id: "console" })?.provider.domainReadConnection, provider.domainReadConnection);
    const credential = Object.freeze({ token: "sending", baseUrl: "https://sending.example.com" });
    await provider.create({ credential, kit: { httpClient } }).send(delivery);
    assert.deepEqual(credential, { token: "sending", baseUrl: "https://sending.example.com" });
  });
});

describe("engine contract fixtures", () => {
  test("status reports extend the existing projection with safe host facts", () => {
    const report: MailStatusReport = {
      ...computeMailStatus({ setting: { transactional: null, bulk: null }, registry: createMailProviderRegistry(), hasCredential: () => false }),
      providers: [], refusals: [], checkedAt: "2026-10-24T00:00:00.000Z",
      senderDomainVerification: { state: "no_sender", providerId: null },
      lastError: { at: "2026-10-24T00:00:00.000Z", providerId: null, source: "check", message: "Credential unavailable" },
    };
    assert.deepEqual(report, {
      state: "unconfigured",
      lanes: [{ lane: "transactional", providerId: null, state: "unconfigured" }, { lane: "bulk", providerId: null, state: "unconfigured" }],
      warnings: [], providers: [], refusals: [], checkedAt: "2026-10-24T00:00:00.000Z",
      senderDomainVerification: { state: "no_sender", providerId: null },
      lastError: { at: "2026-10-24T00:00:00.000Z", providerId: null, source: "check", message: "Credential unavailable" },
    });
  });

  test("host ports and test-mode shapes are structural contracts", () => {
    // Type fixtures: tsc checks these shapes; the runtime assertion pins the approval's field order.
    const registry = createMailProviderRegistry();
    const catalog = { registry, pluginIds: [], refusals: [], credentialLabelFor: () => "Mail key", setupFor: () => ({ fields: [] }) } satisfies MailProviderCatalog;
    void ({ readFact: async ({ label }) => ({ id: "row", label, vaultRevision: 7, updatedAt: "2026-10-24T00:00:00.000Z" }), resolve: async () => ({ token: "k" }) } satisfies MailCredentialPort);
    void ({ read: async () => null, write: async () => {} } satisfies MailProviderSettingPort);
    void ((async () => ({ state: "unknown", providerId: null, reason: "Credential unavailable" })) satisfies SenderDomainVerificationPort);
    void ([{ mode: "off" }, { mode: "redirect", to: "test@example.com" }, { mode: "capture" }] satisfies MailTestModeSetting[]);
    const approval: MailTestApproval = { providerId: null, driver: "console", from: delivery.message.from, mode: "redirect", effectiveRecipient: "test@example.com" };
    const options: MailerSendOptions = { ...delivery, mailTestApproval: approval };
    assert.equal(catalog.registry, registry);
    assert.equal(JSON.stringify(options.mailTestApproval), '{"providerId":null,"driver":"console","from":{"email":"from@example.com"},"mode":"redirect","effectiveRecipient":"test@example.com"}');
  });
});
