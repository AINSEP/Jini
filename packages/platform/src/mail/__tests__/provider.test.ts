import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { ProviderRegistryError } from "@jini-ai/core/provider-registry";
import { computeMailStatus, createMailProviderRegistry, initialMailProviderSetting, validateMailProvider, type MailProviderModule } from "../provider.js";
import { createConsoleMailProvider, createSmtpMailProvider, parseSmtpEndpoint } from "../builtin-providers.js";
import type { SmtpTransport } from "../smtp.js";

const CLOCK = { nowMs: () => Date.parse("2026-10-21T00:00:00Z") };

function hosted(id: string, extra: Partial<MailProviderModule> = {}): MailProviderModule {
  return {
    id, label: id, credentialKeys: ["token"],
    capabilities: { hosted: true, feedback: false, domainVerification: false },
    create: () => { throw new Error("unused"); },
    ...extra,
  };
}

describe("validateMailProvider", () => {
  const ok = hosted("resend");
  test("accepts a consistent module", () => assert.equal(validateMailProvider({ provider: ok }), undefined));
  test.each([
    [null, "not an object"],
    [{ ...ok, create: undefined }, "create() is missing"],
    [{ ...ok, credentialKeys: "token" }, "credentialKeys must be a string array"],
    [{ ...ok, credentialKeys: [1] }, "credentialKeys must be a string array"],
    [{ ...ok, capabilities: null }, "capabilities are missing"],
    [{ ...ok, capabilities: { ...ok.capabilities, feedback: true } }, "capabilities.feedback must match the presence of a feedback parser"],
    [{ ...ok, capabilities: { ...ok.capabilities, domainVerification: true }, domainRequirements: async () => ({ status: "ok" }) }, "capabilities.domainVerification must match domainRequirements + domainStatus"],
  ])("refuses %#", (provider, reason) => {
    assert.equal(validateMailProvider({ provider: provider as unknown as MailProviderModule }), reason);
  });
  test("accepts full feedback + domain verification", () => {
    const full = hosted("full", {
      capabilities: { hosted: true, feedback: true, domainVerification: true },
      feedback: { verify: () => true, parse: () => [] },
      domainRequirements: async () => ({ status: "ok", value: { purpose: "mail", domain: "x.com", providerId: "full", records: [] } }),
      domainStatus: async () => ({ status: "ok", value: { domain: "x.com", state: "verified" } }),
    });
    assert.equal(validateMailProvider({ provider: full }), undefined);
  });
});

describe("createMailProviderRegistry", () => {
  test("built-ins register, a bad built-in throws, a bad plugin is refused", () => {
    const registry = createMailProviderRegistry({}, { builtins: [hosted("smtp")] });
    assert.equal(registry.get({ id: "smtp" })?.origin, "core");
    assert.equal(registry.contribute({ definition: { id: "bad", provider: { ...hosted("bad"), create: undefined } as unknown as MailProviderModule }, pluginId: "p" }), false);
    assert.equal(registry.refusals()[0]?.code, "invalid_provider");
    assert.throws(() => createMailProviderRegistry({}, { builtins: [hosted("Bad Id")] }), ProviderRegistryError);
    assert.equal(createMailProviderRegistry().list().length, 0);
  });
});

describe("initialMailProviderSetting", () => {
  const registry = createMailProviderRegistry({}, { builtins: [hosted("smtp"), createConsoleMailProvider({ clock: CLOCK })] });
  test("keeps a hosted effective provider on both lanes", () => {
    assert.deepEqual(initialMailProviderSetting({}, { effectiveProviderId: "smtp", registry }), { transactional: "smtp", bulk: "smtp" });
  });
  test("console, unknown or nothing becomes unconfigured", () => {
    assert.deepEqual(initialMailProviderSetting({}, { effectiveProviderId: "console", registry }), { transactional: null, bulk: null });
    assert.deepEqual(initialMailProviderSetting({}, { effectiveProviderId: "ghost", registry }), { transactional: null, bulk: null });
    assert.deepEqual(initialMailProviderSetting({}, { effectiveProviderId: "smtp" }), { transactional: null, bulk: null });
    assert.deepEqual(initialMailProviderSetting({}), { transactional: null, bulk: null });
  });
});

describe("computeMailStatus", () => {
  const registry = createMailProviderRegistry({}, { builtins: [hosted("smtp"), createConsoleMailProvider({ clock: CLOCK })] });
  const yes = () => true;
  test("ready when both lanes have a credentialed hosted provider", () => {
    const status = computeMailStatus({ setting: { transactional: "smtp", bulk: "smtp" }, registry, hasCredential: yes }, { senderDomainState: "verified" });
    assert.deepEqual(status, { state: "ready", lanes: [{ lane: "transactional", providerId: "smtp", state: "ready" }, { lane: "bulk", providerId: "smtp", state: "ready" }], warnings: [] });
  });
  test("unconfigured transactional lane → unconfigured; sender unknown warned", () => {
    const status = computeMailStatus({ setting: { transactional: null, bulk: null }, registry, hasCredential: yes }, { senderDomainState: null });
    assert.equal(status.state, "unconfigured");
    assert.deepEqual(status.warnings, ["sender_unknown"]);
  });
  test("degraded for unknown/local/missing-credential lanes; sender unverified warned", () => {
    const status = computeMailStatus({ setting: { transactional: "console", bulk: "ghost" }, registry, hasCredential: yes }, { senderDomainState: "pending" });
    assert.equal(status.state, "degraded");
    assert.deepEqual(status.lanes.map((l) => l.state), ["local_only", "unknown_provider"]);
    assert.deepEqual(status.warnings, ["sender_unverified"]);
    const missing = computeMailStatus({ setting: { transactional: "smtp", bulk: "smtp" }, registry, hasCredential: () => false });
    assert.deepEqual(missing.lanes.map((l) => l.state), ["missing_credential", "missing_credential"]);
    assert.deepEqual(missing.warnings, []);
  });
});

describe("built-in providers", () => {
  test("parseSmtpEndpoint handles explicit and default ports", () => {
    assert.deepEqual(parseSmtpEndpoint({ baseUrl: "https://smtp.example.com:587" }), { host: "smtp.example.com", port: 587, secure: false });
    assert.deepEqual(parseSmtpEndpoint({ baseUrl: "https://smtp.example.com:465" }), { host: "smtp.example.com", port: 465, secure: true });
    assert.deepEqual(parseSmtpEndpoint({ baseUrl: "https://smtp.example.com" }), { host: "smtp.example.com", port: 443, secure: true });
    assert.deepEqual(parseSmtpEndpoint({ baseUrl: "http://smtp.example.com" }), { host: "smtp.example.com", port: 80, secure: false });
  });
  test("smtp provider builds a transport from the credential and validates", async () => {
    const configs: unknown[] = [];
    const transport: SmtpTransport = { sendMail: async () => ({ messageId: "s-1" }) };
    const smtp = createSmtpMailProvider({ createTransport: (config) => { configs.push(config); return transport; }, clock: CLOCK });
    assert.equal(validateMailProvider({ provider: smtp }), undefined);
    const mailer = smtp.create({ credential: { token: "pw", username: "u", baseUrl: "https://mx.example.com:587" }, kit: { httpClient: {} as never } });
    assert.deepEqual(configs, [{ host: "mx.example.com", port: 587, secure: false, auth: { user: "u", pass: "pw" } }]);
    const result = await mailer.send({ idempotencyKey: "k", workspaceId: "w", sourceContext: { module: "m" }, message: { workspaceId: "w", to: { email: "a@b.c" }, from: { email: "f@b.c" }, subject: "s", text: "t" } });
    assert.equal(result.ok && result.providerMessageId, "s-1");
  });
  test("smtp provider tolerates a credential without username/baseUrl (fails at parse, not silently)", () => {
    const smtp = createSmtpMailProvider({ createTransport: () => ({ sendMail: async () => ({ messageId: "x" }) }), clock: CLOCK });
    assert.throws(() => smtp.create({ credential: { token: "pw" }, kit: { httpClient: {} as never } }), TypeError);
    // A relay credential without a username still builds (empty user), mirroring the stored shape.
    assert.doesNotThrow(() => smtp.create({ credential: { token: "pw", baseUrl: "https://mx.example.com:25" }, kit: { httpClient: {} as never } }));
  });
  test("console provider logs, counts, batches and is not hosted", async () => {
    const lines: string[] = [];
    const consoleProvider = createConsoleMailProvider({ clock: CLOCK }, { log: (line) => lines.push(line) });
    assert.equal(consoleProvider.capabilities.hosted, false);
    const mailer = consoleProvider.create({ credential: { token: "" }, kit: { httpClient: {} as never } });
    assert.equal(mailer.capabilities({}).driver, "console");
    const delivery = { idempotencyKey: "k", workspaceId: "w", sourceContext: { module: "m" } };
    const message = { workspaceId: "w", to: { email: "a@b.c" }, from: { email: "f@b.c" }, subject: "Hello", text: "t" };
    const results = await mailer.sendBatch({ ...delivery, messages: [message, message] });
    assert.deepEqual(results.map((r) => r.ok && r.providerMessageId), ["console-1", "console-2"]);
    assert.deepEqual(lines, ['[mail:console] to=a@b.c subject="Hello"', '[mail:console] to=a@b.c subject="Hello"']);
  });
  test("console provider defaults to console.log", async () => {
    const original = console.log;
    const seen: unknown[] = [];
    console.log = (line: unknown) => { seen.push(line); };
    try {
      const mailer = createConsoleMailProvider({ clock: CLOCK }).create({ credential: { token: "" }, kit: { httpClient: {} as never } });
      await mailer.send({ idempotencyKey: "k", workspaceId: "w", sourceContext: { module: "m" }, message: { workspaceId: "w", to: { email: "a@b.c" }, from: { email: "f@b.c" }, subject: "s", text: "t" } });
    } finally {
      console.log = original;
    }
    assert.equal(seen.length, 1);
  });
});
