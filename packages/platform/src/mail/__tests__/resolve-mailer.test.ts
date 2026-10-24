/** Explicit-selection/refusal/status/requirements cases ported from the host resolver suite.
 * Host SMTP construction, plugin loading and vault integration remain covered by their host owners. */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import type { DomainRequirement, ProviderResult } from "@jini-ai/core/provider-registry";
import { createMailProviderRegistry } from "../provider.js";
import { createResolvedMailer } from "../resolve-mailer.js";
import { ACCEPTED, BATCH, deferred, domainProvider, fixture, LABEL, SEND, WS } from "./resolver-fixtures.js";

test("first boot with saved keys stays unconfigured, persists null lanes and never constructs a delivery provider", async () => {
  const host = fixture({ setting: null });
  const resolved = host.create();
  await resolved.ready;
  assert.deepEqual(host.setting.writes, [{ transactional: null, bulk: null }]);
  assert.equal(resolved.mailer.capabilities({}).driver, "console");
  assert.deepEqual(await resolved.mailer.send(SEND), { ok: false, retryable: false, errorCode: "MAIL_UNCONFIGURED", message: "[mail] no transactional mail provider is configured; choose a provider and save its key." });
  assert.deepEqual(host.keys, []);
  assert.deepEqual(host.effects, [], "saved metadata and keys cannot select delivery");
});

test("first boot without credentials refuses and warns once for each lane's exact host message", async () => {
  const host = fixture({ setting: null, saved: false });
  const resolved = host.create();
  await resolved.ready;
  const result = await resolved.mailer.send(SEND);
  assert.deepEqual(await resolved.mailer.sendBatch(BATCH), [result, result]);
  assert.equal(host.warnings.length, 1);
  await resolved.mailer.send(SEND, { purpose: "bulk" });
  assert.deepEqual(host.warnings, [host.deps.unconfiguredMessage({ lane: "transactional" }), host.deps.unconfiguredMessage({ lane: "bulk" })]);
});

test("unconfigured local mode logs through the real console provider and succeeds", async () => {
  const host = fixture({ setting: null, mode: "local" });
  const resolved = host.create();
  await resolved.ready;
  assert.equal((await resolved.mailer.send(SEND)).ok, true);
  assert.equal(resolved.mailer.capabilities({}).driver, "console");
  assert.deepEqual(host.logs, ['[mail:console] to=a@example.com subject="hi"\nhi']);
  assert.deepEqual(host.warnings, []);
});

test("a provider installed after first boot is never selected by its saved key", async () => {
  const host = fixture({ setting: null });
  const load = host.deps.loadCatalog;
  const empty = createMailProviderRegistry({}, { builtins: [host.catalog.registry.get({ id: "console" })!.provider] });
  host.deps.loadCatalog = async () => ({ ...host.catalog, registry: empty });
  const resolved = host.create();
  await resolved.ready;
  host.deps.loadCatalog = load;
  assert.equal((await resolved.mailer.send(SEND)).ok, false);
  assert.deepEqual(host.setting.value, { transactional: null, bulk: null });
  assert.deepEqual(host.keys, []);
});

test("selection routes transactional, feature and bulk purposes to their configured lanes", async () => {
  const host = fixture({ setting: { transactional: "api", bulk: "console" } });
  const resolved = host.create();
  await resolved.ready;
  assert.equal(resolved.mailer.capabilities({}).driver, "api");
  assert.deepEqual(await resolved.mailer.send(SEND), ACCEPTED);
  assert.deepEqual(await resolved.mailer.send(SEND, { purpose: "feature:receipt" }), ACCEPTED);
  await resolved.mailer.send(SEND, { purpose: "bulk" });
  assert.deepEqual(host.sends, ["key-one", "key-one"]);
  assert.equal(host.logs.length, 1);
  assert.deepEqual(host.setting.writes, []);
  assert.equal(await resolved.laneReady({ lane: "transactional" }), true);
  assert.equal(await resolved.laneReady({ lane: "bulk" }), false);
});

test("missing credentials refuse in production, then a newly saved key works without invalidation", async () => {
  const host = fixture({ saved: false });
  const resolved = host.create();
  const refused = await resolved.mailer.send(SEND);
  assert.deepEqual(refused, { ok: false, retryable: false, errorCode: "MAIL_PROVIDER_UNAVAILABLE", message: `[mail] the selected mail provider 'api' has no saved credential "${LABEL}" under Access Tokens (category "ops"), so outbound mail is NOT being sent` });
  host.save("saved-later");
  assert.deepEqual(await resolved.mailer.send(SEND), ACCEPTED);
  assert.deepEqual(host.sends, ["saved-later"]);
});

test("an unavailable provider falls back locally and never warns", async () => {
  const host = fixture({ mode: "local", setting: { transactional: "gone", bulk: null } });
  const resolved = host.create();
  assert.equal((await resolved.mailer.send(SEND)).ok, true);
  assert.equal(resolved.mailer.capabilities({}).driver, "console");
  assert.equal(host.logs.length, 1);
  assert.deepEqual(host.warnings, []);
});

test("unknown provider refusals include the host catalog diagnostics byte for byte", async () => {
  const host = fixture({ setting: { transactional: "postal", bulk: null } });
  host.deps.loadCatalog = async () => ({ ...host.catalog, refusals: ["plugin 'postal' is disabled"] });
  const result = await host.create().mailer.send(SEND);
  assert.deepEqual(result, { ok: false, retryable: false, errorCode: "MAIL_PROVIDER_UNAVAILABLE", message: "[mail] the selected mail provider 'postal' is not installed (plugin 'postal' is disabled), so outbound mail is NOT being sent" });
});

test.each([new Error("db down"), "db down"])("a settings fault becomes a safe refusal (%s)", async error => {
  const host = fixture();
  host.deps.providerSetting.read = async () => { throw error; };
  const resolved = host.create();
  await resolved.ready;
  assert.deepEqual(await resolved.mailer.send(SEND), { ok: false, retryable: false, errorCode: "MAIL_PROVIDER_UNAVAILABLE", message: "Mail provider selection failed; check configuration." });
});

test("catalog faults become selection refusals and are retried on the next send", async () => {
  const host = fixture();
  const load = host.deps.loadCatalog;
  host.deps.loadCatalog = async () => { throw new Error("private loader detail"); };
  const resolved = host.create();
  await resolved.ready;
  assert.deepEqual(await resolved.mailer.send(SEND), { ok: false, retryable: false, errorCode: "MAIL_PROVIDER_UNAVAILABLE", message: "Mail provider selection failed; check configuration." });
  host.deps.loadCatalog = load;
  assert.deepEqual(await resolved.mailer.send(SEND), ACCEPTED);
});

test("a failed initialization write warns safely and leaves mail unconfigured", async () => {
  const host = fixture({ setting: null });
  host.deps.providerSetting.write = async () => { throw new Error("locked (password=migration-secret)"); };
  const resolved = host.create();
  assert.equal((await resolved.mailer.send(SEND)).ok, false);
  assert.equal(host.warnings[0], "[mail] the mail provider setting could not be saved; retrying on the next send");
  assert.doesNotMatch(host.warnings.join("\n"), /locked|migration-secret/);
});

test("concurrent absent-setting readers share initialization while persistence is pending", async () => {
  const host = fixture({ setting: null });
  const entered = deferred<void>(), release = deferred<void>();
  let writes = 0;
  const write = host.deps.providerSetting.write;
  host.deps.providerSetting.write = async input => { writes++; entered.resolve(); await release.promise; await write(input); };
  const resolved = host.create();
  await entered.promise;
  const readEntered = deferred<void>();
  host.deps.providerSetting.read = async () => { readEntered.resolve(); return null; };
  const send = resolved.mailer.send(SEND);
  await readEntered.promise;
  release.resolve();
  await send;
  await resolved.ready;
  assert.equal(writes, 1);
  assert.deepEqual(host.setting.writes, [{ transactional: null, bulk: null }]);
});

test("the host's unconfigured copy and credential error translations are preserved exactly", async () => {
  const host = fixture({ setting: null });
  host.deps.unconfiguredMessage = () => "Exact host recovery wording: choose a provider.";
  const first = host.create();
  assert.deepEqual(await first.mailer.send(SEND), { ok: false, retryable: false, errorCode: "MAIL_UNCONFIGURED", message: "Exact host recovery wording: choose a provider." });
  host.setting.value = { transactional: "api", bulk: "api" };
  host.deps.credentials.resolve = async () => { throw "private-store-error"; };
  host.deps.credentialFailureReason = ({ label }) => `the "${label}" credential is saved but could not be decrypted`;
  const refused = await first.mailer.send(SEND);
  assert.deepEqual(refused, { ok: false, retryable: false, errorCode: "MAIL_PROVIDER_UNAVAILABLE", message: `[mail] the selected mail provider 'api' the "${LABEL}" credential is saved but could not be decrypted, so outbound mail is NOT being sent` });
  assert.doesNotMatch(JSON.stringify(refused), /private-store-error/);
});

test("a throwing warn is swallowed and the default warn uses console.warn", async () => {
  const host = fixture({ setting: null });
  assert.equal((await host.create({ warn: () => { throw new Error("sink offline"); } }).mailer.send(SEND)).ok, false);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await createResolvedMailer(host.deps).mailer.send(SEND);
    assert.equal(warn.mock.calls.length, 1);
  } finally { warn.mockRestore(); }
});

test("wrapProviderMailer decorates each shared resolved provider once", async () => {
  const host = fixture();
  const wrapped: string[] = [];
  const resolved = host.create({ wrapProviderMailer: ({ providerId, mailer }) => { wrapped.push(providerId); return mailer; } });
  await resolved.mailer.send(SEND);
  await resolved.mailer.send(SEND, { purpose: "bulk" });
  assert.deepEqual(wrapped, ["api"]);
});

test("keyless providers are built with an empty token and never read credential metadata", async () => {
  const host = fixture({ keyless: true, saved: false });
  host.deps.credentials.readFact = async () => assert.fail("keyless metadata lookup");
  host.deps.credentials.resolve = async () => assert.fail("keyless decryption");
  assert.deepEqual(await host.create().mailer.send(SEND), ACCEPTED);
  assert.deepEqual(host.keys, [""]);
});

test("explicit console works in production but readiness and status report local only", async () => {
  const host = fixture({ setting: { transactional: "console", bulk: "console" } });
  const resolved = host.create();
  assert.equal((await resolved.mailer.send(SEND)).ok, true);
  assert.equal(await resolved.laneReady({ lane: "transactional" }), false);
  const report = await resolved.status();
  assert.deepEqual(report.lanes.map(lane => lane.state), ["local_only", "local_only"]);
  assert.equal(report.state, "degraded");
});

test("capabilities before resolution reports console; settle and ready expose the resolved driver", async () => {
  const host = fixture();
  const release = deferred<void>();
  const read = host.deps.providerSetting.read;
  host.deps.providerSetting.read = async input => { await release.promise; return read(input); };
  const resolved = host.create();
  assert.equal(resolved.mailer.capabilities({}).driver, "console");
  release.resolve();
  await resolved.ready;
  await resolved.settle();
  assert.equal(resolved.mailer.capabilities({}).driver, "api");
  assert.deepEqual(host.sends, []);
});

test("clearing both lane settings and invalidating immediately stops delivery", async () => {
  const host = fixture();
  const resolved = host.create();
  await resolved.ready;
  await resolved.mailer.send(SEND);
  await resolved.status();
  host.setting.value = { transactional: null, bulk: null };
  resolved.invalidate();
  assert.equal(resolved.mailer.capabilities({}).driver, "console");
  const refused = await resolved.mailer.send(SEND);
  assert.equal(refused.ok ? null : refused.errorCode, "MAIL_UNCONFIGURED");
  assert.equal(await resolved.laneReady({ lane: "transactional" }), false);
  assert.equal((await resolved.status()).state, "unconfigured");
  assert.deepEqual(host.sends, ["key-one"]);
});

test("status keeps ready lanes and safe provider descriptions separate from missing sender warnings", async () => {
  const host = fixture();
  const resolved = host.create();
  const missing = await resolved.status();
  assert.equal(missing.state, "ready");
  assert.deepEqual(missing.warnings, ["sender_unknown"]);
  assert.deepEqual(missing.providers.map(p => [p.id, p.hosted]), [["api", true], ["console", false]]);
  const known = await host.create({ readSenderEmail: async () => "news@example.com" }).status();
  assert.deepEqual(known.warnings, [], "an unsupported domain check raises no warning");
});

test("status unknown providers do not claim the configured sender is missing", async () => {
  const host = fixture({ setting: { transactional: "gone", bulk: null } });
  const report = await host.create({ readSenderEmail: async () => "news@example.com" }).status();
  assert.deepEqual(report.lanes.map(lane => lane.state), ["unknown_provider", "unconfigured"]);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual((await host.create({ readSenderEmail: async () => { throw new Error("db"); } }).status()).warnings, ["sender_unknown"]);
});

test.each(["verified", "pending", "failed", "not_found"] as const)("status reflects provider domain state %s without requesting requirements", async state => {
  const host = fixture();
  domainProvider({ provider: host.provider, status: async (_ctx, { domain }) => ({ status: "ok", value: { domain, state } }), requirements: async () => assert.fail("status cannot request requirements") });
  const report = await host.create({ readSenderEmail: async () => "news@Example.com" }).status();
  assert.deepEqual(report.warnings, state === "verified" ? [] : ["sender_unverified"]);
  assert.deepEqual(report.senderDomainVerification, { state, domain: "example.com", providerId: "api" });
});

test("a missing key prevents a provider domain check without claiming the sender is missing", async () => {
  const host = fixture({ saved: false });
  domainProvider({ provider: host.provider, status: async () => assert.fail("provider without key cannot be asked") });
  const report = await host.create({ readSenderEmail: async () => "news@example.com" }).status();
  assert.equal(report.state, "degraded");
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.senderDomainVerification, { state: "unknown", domain: "example.com", providerId: "api", reason: "the provider's key is not saved" });
});

test("without an injected clock, status timestamps use the system clock", async () => {
  const host = fixture();
  const { checkedAt } = await createResolvedMailer(host.deps, { warn: () => {} }).status();
  assert.ok(Math.abs(Date.parse(checkedAt) - Date.now()) < 60_000);
});

test("checkProvider distinguishes installed hosted, missing, local and keyless providers without sending", async () => {
  const host = fixture();
  const resolved = host.create();
  assert.deepEqual(await resolved.checkProvider({ id: "api" }), { ok: true, label: "Mail API" });
  assert.deepEqual(await resolved.checkProvider({ id: "postal" }), { ok: false, reason: "'postal' is not an installed mail provider (installed: api, console)" });
  assert.deepEqual(await resolved.checkProvider({ id: "console" }), { ok: false, reason: "'console' only prints mail locally and never delivers it" });
  host.rows.delete(LABEL);
  assert.deepEqual(await resolved.checkProvider({ id: "api" }), { ok: false, reason: `'api' has no saved credential "${LABEL}" under Access Tokens (category "ops")` });
  assert.deepEqual(await fixture({ keyless: true }).create().checkProvider({ id: "api" }), { ok: true, label: "Mail API" });
  assert.deepEqual(host.sends, []);
});

test("domainRequirements reads the active transactional key and lowercased sender domain", async () => {
  const host = fixture();
  const asked: { domain: string; token: string; workspaceId: string }[] = [];
  domainProvider({ provider: host.provider, requirements: async (ctx, { domain }) => {
    assert.equal(ctx.httpClient, host.deps.httpClient, "the guarded HTTP object passes through unchanged");
    asked.push({ domain, token: ctx.credential.token, workspaceId: ctx.workspaceId });
    return { status: "ok", value: { purpose: "mail", domain, providerId: "api", records: [{ type: "TXT", name: "send.example.com", value: "v=spf1 ~all" }] } };
  } });
  const resolved = host.create({ readSenderEmail: async () => "News@Example.com" });
  assert.deepEqual(await resolved.domainRequirements({ workspaceId: WS }), { purpose: "mail", domain: "example.com", providerId: "api", records: [{ type: "TXT", name: "send.example.com", value: "v=spf1 ~all" }] });
  assert.deepEqual(asked, [{ domain: "example.com", token: "key-one", workspaceId: WS }]);
});

test.each(["workspace", "empty-domain", "sender", "selection", "provider", "unsupported", "credential"] as const)("domainRequirements returns null for missing %s", async missing => {
  const host = fixture();
  if (missing !== "unsupported") domainProvider({ provider: host.provider, requirements: async () => assert.fail("missing configuration cannot ask provider") });
  let email: string | undefined = "news@example.com";
  if (missing === "empty-domain") email = "news@";
  if (missing === "sender") email = undefined;
  if (missing === "selection") host.setting.value = { transactional: null, bulk: "api" };
  if (missing === "provider") host.setting.value = { transactional: "gone", bulk: null };
  if (missing === "credential") host.rows.delete(LABEL);
  const resolved = host.create({ readSenderEmail: async () => email });
  assert.equal(await resolved.domainRequirements({ workspaceId: missing === "workspace" ? "another-site" : WS }), null);
});

test("requirements use sending key first, fall back once on forbidden and leave sending context unchanged", async () => {
  const host = fixture();
  const effects: string[] = [];
  domainProvider({ provider: host.provider, requirements: async (ctx, { domain }) => {
    effects.push(`requirements:${ctx.credential.token}`);
    return ctx.credential.token === "account-key"
      ? { status: "ok", value: { purpose: "mail", domain, providerId: "api", records: [] } }
      : { status: "rejected", error: { code: "forbidden", message: "send only" } };
  } });
  const resolved = host.create({ readSenderEmail: async () => "news@example.com", resolveDomainReadCredential: async ({ id }) => { effects.push(`account:${id}`); return { token: "account-key", baseUrl: "https://declared.example" }; } });
  assert.equal((await resolved.domainRequirements({ workspaceId: WS }))!.domain, "example.com");
  assert.deepEqual(effects, ["requirements:key-one", "account:api", "requirements:account-key"]);
  await resolved.mailer.send(SEND);
  assert.deepEqual(host.sends, ["key-one"]);
  assert.equal(host.rows.get(LABEL)!.credential.token, "key-one");
});

test.each(["unauthorized", "not_found", "rate_limited"] as const)("requirements failure %s never looks up an account key", async code => {
  const host = fixture();
  domainProvider({ provider: host.provider, requirements: async () => ({ status: "rejected", error: { code, message: "bad key" } }) });
  const resolved = host.create({ readSenderEmail: async () => "news@example.com", resolveDomainReadCredential: async () => assert.fail("unrelated refusal cannot open the account") });
  await assert.rejects(resolved.domainRequirements({ workspaceId: WS }), { message: `${code}: bad key` });
});

test("requirements failures retain ToolInputError and frozen secret-redacted text", async () => {
  const host = fixture();
  host.save("saved-value");
  domainProvider({ provider: host.provider, requirements: async () => ({ status: "rejected", error: { code: "unauthorized", message: "Use saved-value at https://mail.example/?session_code=abc#fragment&view=1" } }) });
  await assert.rejects(host.create({ readSenderEmail: async () => "news@example.com" }).domainRequirements({ workspaceId: WS }), error => {
    assert.ok(error instanceof ToolInputError);
    assert.equal(error.message, "unauthorized: Use [REDACTED:exact_secret] at https://mail.example/[REDACTED:url_secret_param]&view=1");
    return true;
  });
});

test("requirements deadlines reject safely and do not cancel late provider work", async () => {
  vi.useFakeTimers();
  try {
    const host = fixture();
    const answer = deferred<ProviderResult<DomainRequirement>>();
    const entered = deferred<void>();
    domainProvider({ provider: host.provider, requirements: () => { entered.resolve(); return answer.promise; } });
    const resolved = host.create({ readSenderEmail: async () => "news@example.com", domainRequirementsTimeoutMs: 25 });
    const failed = assert.rejects(resolved.domainRequirements({ workspaceId: WS }), { message: "The mail provider could not list its required DNS records." });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(24);
    assert.equal(vi.getTimerCount(), 1);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
    assert.equal(vi.getTimerCount(), 0);
    answer.resolve({ status: "ok", value: { purpose: "mail", domain: "example.com", providerId: "api", records: [] } });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(vi.getTimerCount(), 0);
  } finally { vi.useRealTimers(); }
});

test("successful requirements clear the timeout and preserve the exact provider return object", async () => {
  vi.useFakeTimers();
  try {
    const host = fixture();
    const value: DomainRequirement = { purpose: "mail", domain: "example.com", providerId: "api", records: [] };
    domainProvider({ provider: host.provider, requirements: async () => ({ status: "ok", value }) });
    const resolved = host.create({ readSenderEmail: async () => "news@example.com" });
    assert.equal(await resolved.domainRequirements({ workspaceId: WS }), value);
    assert.equal(vi.getTimerCount(), 0);
  } finally { vi.useRealTimers(); }
});
