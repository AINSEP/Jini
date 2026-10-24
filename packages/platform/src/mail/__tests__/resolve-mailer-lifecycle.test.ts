/** Ported cached-provider lifecycle cases. Host persistence is replaced only at its public ports. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { MailCredentialFact } from "../engine-contracts.js";
import { createResolvedMailer, type ResolveMailerDeps } from "../resolve-mailer.js";
import { ACCEPTED, BATCH, deferred, DELIVERY, domainProvider, FAILED, fixture, LABEL, MESSAGE, SEND } from "./resolver-fixtures.js";

test("a key replaced in the store is used by the very next send, with no invalidate and no restart", async () => {
  const host = fixture();
  const { mailer } = host.create();
  assert.equal((await mailer.send(SEND)).ok, true);
  assert.equal((await mailer.send(SEND)).ok, true);
  assert.deepEqual(host.keys, ["key-one"], "an unchanged row reuses the cached provider");
  host.save("key-two");
  assert.equal((await mailer.send(SEND)).ok, true);
  assert.deepEqual(host.keys, ["key-one", "key-two"]);
  assert.deepEqual(host.sends, ["key-one", "key-one", "key-two"]);
});

test("a deleted key makes the next send refuse instead of using the stale provider", async () => {
  const host = fixture();
  const { mailer } = host.create();
  assert.equal((await mailer.send(SEND)).ok, true);
  host.rows.delete(LABEL);
  const refused = await mailer.send(SEND);
  assert.equal(refused.ok ? null : refused.errorCode, "MAIL_PROVIDER_UNAVAILABLE");
  assert.deepEqual(host.sends, ["key-one"]);
});

test.each(["id", "updatedAt"] as const)("a changed credential %s invalidates the cached provider even with the same vault revision", async field => {
  const host = fixture();
  const resolved = host.create();
  await resolved.mailer.send(SEND);
  const row = host.rows.get(LABEL)!;
  host.rows.set(LABEL, { fact: { ...row.fact, [field]: "changed" }, credential: { token: "key-new" } });
  await resolved.mailer.send(SEND);
  assert.deepEqual(host.keys, ["key-one", "key-new"]);
  assert.deepEqual(host.sends, ["key-one", "key-new"]);
});

test("invalidate drops cached providers even when the row is unchanged", async () => {
  const host = fixture();
  const resolved = host.create();
  await resolved.mailer.send(SEND);
  resolved.invalidate();
  await resolved.mailer.send(SEND);
  assert.deepEqual(host.keys, ["key-one", "key-one"]);
});

test("a metadata-store fault keeps the cached provider; recovery during resolution verifies the fingerprint before construction", async () => {
  const host = fixture();
  const resolved = host.create();
  await resolved.mailer.send(SEND);
  host.deps.credentials.readFact = async () => { throw new Error("store offline"); };
  assert.equal((await resolved.mailer.send(SEND)).ok, true);
  assert.deepEqual(host.keys, ["key-one"]);

  const fresh = fixture();
  const readFact = fresh.deps.credentials.readFact;
  let remaining = 1;
  fresh.deps.credentials.readFact = async input => {
    if (remaining-- > 0) throw new Error("store offline");
    return readFact(input);
  };
  const other = fresh.create();
  assert.equal((await other.mailer.send(SEND)).ok, true);
  assert.equal((await other.mailer.send(SEND)).ok, true);
  assert.deepEqual(fresh.keys, ["key-one"], "only a verified fingerprint is constructed and cached");
});

test("status TTL, refresh interval, invalidation and checkedAt use the injected clock", async () => {
  const host = fixture();
  let loads = 0;
  let now = Date.parse("2026-10-22T10:00:00.000Z");
  host.deps.loadCatalog = async () => { loads++; return host.catalog; };
  const resolved = host.create({ clock: { nowMs: () => now }, statusTtlMs: 1000 });
  await resolved.ready;
  const before = loads;
  const first = await resolved.status();
  assert.equal(first.checkedAt, "2026-10-22T10:00:00.000Z");
  assert.equal(first.state, "ready");
  const [a, b] = await Promise.all([resolved.status(), resolved.status()]);
  assert.equal(a, first);
  assert.equal(b, first);
  assert.equal(loads, before + 1);
  now += 999;
  await resolved.status();
  assert.equal(loads, before + 1);
  now += 1;
  assert.equal((await resolved.status()).checkedAt, "2026-10-22T10:00:01.000Z");
  assert.equal(loads, before + 2);
  await resolved.status({ refresh: true });
  assert.equal(loads, before + 2, "refresh inside five seconds reuses the cached report");
  now += 5_000;
  await resolved.status({ refresh: true });
  assert.equal(loads, before + 3);
  resolved.invalidate();
  await resolved.status();
  assert.equal(loads, before + 4);
});

test("send failures overlay an already cached report using caller-safe text and the send timestamp", async () => {
  const host = fixture();
  host.answers.single = FAILED;
  host.answers.batch = [FAILED];
  const resolved = host.create({ clock: { nowMs: () => Date.parse("2026-10-22T11:00:00Z") } });
  assert.equal((await resolved.status()).lastError, undefined);
  assert.deepEqual(await resolved.mailer.send(SEND), FAILED);
  assert.deepEqual((await resolved.status()).lastError, { providerId: "api", source: "send", message: "The provider did not confirm acceptance. Check provider configuration.", at: "2026-10-22T11:00:00.000Z" });
  assert.deepEqual(await resolved.mailer.sendBatch({ ...DELIVERY, messages: [MESSAGE] }), [FAILED]);
});

test("failed sends and both partial batch orderings need attention until a whole operation is accepted", async () => {
  const host = fixture();
  const resolved = host.create();
  await resolved.ready;
  assert.equal((await resolved.status()).state, "ready");
  host.answers.single = FAILED;
  await resolved.mailer.send(SEND);
  assert.equal((await resolved.status()).state, "degraded");
  host.answers.single = ACCEPTED;
  await resolved.mailer.send(SEND);
  assert.equal((await resolved.status()).state, "ready");
  assert.equal((await resolved.status()).lastError, undefined);
  for (const results of [[FAILED, ACCEPTED], [ACCEPTED, FAILED]]) {
    host.answers.batch = results;
    assert.deepEqual(await resolved.mailer.sendBatch(BATCH), results);
    assert.equal((await resolved.status()).state, "degraded", "a later accepted recipient cannot hide a batch failure");
  }
  host.answers.batch = [ACCEPTED, ACCEPTED];
  await resolved.mailer.sendBatch(BATCH);
  assert.equal((await resolved.status()).state, "ready");
});

test("an empty batch does not clear a previous send failure", async () => {
  const host = fixture();
  const resolved = host.create();
  host.answers.single = FAILED;
  await resolved.mailer.send(SEND);
  host.answers.batch = [];
  assert.deepEqual(await resolved.mailer.sendBatch({ ...DELIVERY, messages: [] }), []);
  assert.equal((await resolved.status()).lastError?.source, "send");
});

test("an unanswered domain check on every refresh never hides a failed send", async () => {
  const host = fixture();
  domainProvider({ provider: host.provider, status: async () => ({ status: "rejected", error: { code: "forbidden", message: "send only" } }) });
  const resolved = host.create({ statusTtlMs: 0, readSenderEmail: async () => "news@example.com" });
  await resolved.ready;
  const before = await resolved.status();
  assert.equal(before.state, "ready");
  assert.equal(before.lastError?.source, "check");
  host.answers.single = FAILED;
  await resolved.mailer.send(SEND);
  const after = await resolved.status();
  assert.equal(after.state, "degraded");
  assert.equal(after.lastError?.source, "send");
  assert.equal(after.lastError.message, "The provider did not confirm acceptance. Check provider configuration.");
});

test("a successful send on another provider cannot clear the failing provider's error", async () => {
  const host = fixture();
  host.answers.single = FAILED;
  const resolved = host.create();
  await resolved.mailer.send(SEND);
  host.setting.value = { transactional: "api", bulk: "console" };
  await resolved.mailer.send(SEND, { purpose: "bulk" });
  assert.equal((await resolved.status()).lastError?.source, "send");
});

test("status runs domain status separately and preserves caller-safe check notes", async () => {
  const host = fixture();
  let fail = true;
  domainProvider({ provider: host.provider, status: async (_ctx, { domain }) => {
    if (fail) throw new Error("socket hang up");
    return { status: "ok", value: { domain, state: "pending" } };
  } });
  let now = Date.parse("2026-10-22T12:00:00Z");
  const resolved = host.create({ readSenderEmail: async () => "news@example.com", clock: { nowMs: () => now } });
  const rejected = await resolved.status();
  assert.deepEqual(rejected.warnings, []);
  assert.deepEqual(rejected.lastError, { providerId: "api", source: "check", message: "The provider configuration check could not complete.", at: "2026-10-22T12:00:00.000Z" });
  now += 5_000;
  fail = false;
  assert.deepEqual((await resolved.status({ refresh: true })).warnings, ["sender_unverified"]);
});

test("an undecryptable lane key and an unlistable store record safe checks independently", async () => {
  const broken = fixture();
  broken.deps.credentials.resolve = async () => { throw new Error("decrypt private-value"); };
  const missing = await broken.create().status();
  assert.equal(missing.lanes[0]!.state, "missing_credential");
  assert.equal(missing.lastError!.source, "check");
  assert.equal(missing.lastError!.message, "The provider configuration check could not complete.");
  for (const error of [new Error("eio"), "eio"]) {
    const host = fixture();
    const resolved = host.create();
    await resolved.ready;
    host.deps.listCredentialFacts = async () => { throw error; };
    const report = await resolved.status();
    assert.equal(report.lastError!.providerId, null);
    assert.equal(report.lastError!.message, "The provider configuration check could not complete.");
    assert.equal(report.providers[0]!.credential.saved, false);
    assert.equal(report.state, "ready", "a metadata-list fault does not disable a usable key");
  }
});

test("describeProviders and status call the host's safe DTO projection", async () => {
  const host = fixture();
  host.save("key-secret-value");
  const resolved = host.create();
  const report = await resolved.describeProviders();
  assert.deepEqual(report.setting, { transactional: "api", bulk: "api" });
  assert.deepEqual(report.providers.map(p => [p.id, p.lanes, p.credential.saved, p.selectable]), [["api", ["transactional", "bulk"], true, true], ["console", [], false, false]]);
  assert.deepEqual(report.providers[0]!.setup.fields.map(f => [f.key, f.type]), [["token", "secret"]]);
  assert.equal(JSON.stringify(report).includes("key-secret-value"), false);
  assert.deepEqual((await resolved.status()).providers, report.providers);
});

test("host projection receives complete metadata rows, including SMTP-style username presence", async () => {
  const host = fixture();
  const row = { ...host.rows.get(LABEL)!.fact, username: "mailer@example.com" };
  const deps: ResolveMailerDeps<MailCredentialFact & { username: string }> = {
    ...host.deps,
    listCredentialFacts: async () => [row],
    describeProviders: input => {
      assert.equal(input.records[0], row, "the engine must not reduce the host's projection facts");
      const report = host.deps.describeProviders(input);
      return { ...report, providers: report.providers.map(provider => provider.id === "api"
        ? { ...provider, credential: { ...provider.credential, saved: Boolean(input.records[0]!.username) } }
        : provider) };
    },
  };
  const resolved = createResolvedMailer(deps, host.options);
  assert.equal((await resolved.describeProviders()).providers[0]!.credential.saved, true);
  assert.equal((await resolved.status()).providers[0]!.credential.saved, true);
  row.username = "";
  resolved.invalidate();
  assert.equal((await resolved.describeProviders()).providers[0]!.credential.saved, false);
  assert.equal((await resolved.status()).providers[0]!.credential.saved, false);
  assert.doesNotMatch(JSON.stringify(await resolved.status()), /mailer@example.com/);
});

test("status preserves independent reads, lane-key reads, verdict reads and projection await order", async () => {
  const host = fixture();
  const effects: string[] = [];
  domainProvider({ provider: host.provider, status: async (_ctx, { domain }) => {
    effects.push("domain");
    return { status: "ok", value: { domain, state: "verified" } };
  } });
  const resolved = host.create({ readSenderEmail: async () => { effects.push("sender"); return "news@example.com"; } });
  await resolved.ready;
  host.deps.listCredentialFacts = async () => { effects.push("records"); return [...host.rows.values()].map(row => row.fact); };
  host.deps.providerSetting.read = async () => { effects.push("setting"); return host.setting.value; };
  host.deps.loadCatalog = async () => { effects.push("catalog"); return host.catalog; };
  const resolve = host.deps.credentials.resolve;
  host.deps.credentials.resolve = async input => { effects.push("decrypt"); return resolve(input); };
  const describe = host.deps.describeProviders;
  host.deps.describeProviders = input => { effects.push("describe"); return describe(input); };
  assert.equal((await resolved.status()).state, "ready");
  assert.deepEqual(effects, ["records", "setting", "catalog", "sender", "decrypt", "setting", "sender", "catalog", "catalog", "decrypt", "domain", "describe"]);
});

test("invalidation during paused decryption detaches obsolete work and never sends with the old key", async () => {
  const host = fixture();
  const entered = deferred<void>(), paused = deferred<void>();
  const resolve = host.deps.credentials.resolve;
  let pause = true;
  host.deps.credentials.resolve = async input => {
    const old = await resolve(input);
    if (pause) { pause = false; entered.resolve(); await paused.promise; }
    return old;
  };
  const resolved = host.create();
  await entered.promise;
  host.save("key-new");
  resolved.invalidate();
  const next = resolved.mailer.send(SEND);
  paused.resolve();
  assert.equal((await next).ok, true);
  await resolved.ready;
  await resolved.mailer.send({ ...SEND, idempotencyKey: "k2" });
  assert.deepEqual(host.sends, ["key-new", "key-new"]);
});

test("rotation between the first fingerprint and decrypt retries before constructing a mailer", async () => {
  const host = fixture();
  const entered = deferred<void>(), paused = deferred<void>();
  const resolve = host.deps.credentials.resolve;
  let pause = true;
  host.deps.credentials.resolve = async input => {
    const old = await resolve(input);
    if (pause) { pause = false; entered.resolve(); await paused.promise; }
    return old;
  };
  const resolved = host.create();
  await entered.promise;
  host.save("key-new");
  paused.resolve();
  await resolved.ready;
  await resolved.mailer.send(SEND);
  assert.deepEqual(host.keys, ["key-new"]);
  assert.deepEqual(host.effects, ["metadata", "decrypt", "metadata", "metadata", "decrypt", "metadata", "metadata"]);
});

test("boot, concurrent sends and both lanes share a single pending provider resolution", async () => {
  const host = fixture();
  const entered = deferred<void>(), paused = deferred<void>();
  const resolve = host.deps.credentials.resolve;
  let decrypts = 0;
  host.deps.credentials.resolve = async input => {
    decrypts++;
    entered.resolve();
    await paused.promise;
    return resolve(input);
  };
  const resolved = host.create();
  await entered.promise;
  const first = resolved.mailer.send(SEND), second = resolved.mailer.send(SEND, { purpose: "bulk" });
  paused.resolve();
  assert.deepEqual(await Promise.all([first, second]), [ACCEPTED, ACCEPTED]);
  await resolved.ready;
  assert.equal(decrypts, 1);
  assert.deepEqual(host.keys, ["key-one"]);
  assert.deepEqual(host.sends, ["key-one", "key-one"]);
});

test("simultaneous status readers share pending provider work, not only completed reports", async () => {
  const host = fixture();
  const entered = deferred<void>(), released = deferred<void>();
  let checks = 0;
  domainProvider({ provider: host.provider, status: async (_ctx, { domain }) => {
    checks++;
    entered.resolve();
    await released.promise;
    return { status: "ok", value: { domain, state: "verified" } };
  } });
  const resolved = host.create({ readSenderEmail: async () => "sender@example.com" });
  await resolved.ready;
  const first = resolved.status();
  await entered.promise;
  const second = resolved.status();
  released.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(checks, 1);
});

test("secret-bearing failures never enter lastError or resolver diagnostics", async () => {
  const host = fixture();
  const secret = "Authorization: Bearer secret-token; private body";
  host.answers.single = { ok: false, retryable: false, errorCode: secret, message: secret };
  domainProvider({ provider: host.provider, status: async () => { throw new Error(secret); } });
  const resolved = host.create({ readSenderEmail: async () => "sender@example.com" });
  await resolved.mailer.send(SEND);
  const report = await resolved.status();
  assert.doesNotMatch(JSON.stringify({ report, warnings: host.warnings }), /secret-token|private body|Authorization/);
  // A later check must retain the send failure (the older host suite expected a check here).
  assert.equal(report.lastError!.message, "The provider did not confirm acceptance. Check provider configuration.");
});
