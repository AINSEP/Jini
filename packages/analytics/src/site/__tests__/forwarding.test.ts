import { expect, test, vi } from "vitest";

import { createAnalyticsForwarderRegistry, type AnalyticsForwarderModule, type AnalyticsHooks as EngineHooks } from "../../index.js";

import { cacheAnalyticsProviders, createAnalyticsForwarding, createPluginAnalyticsHooks, type AnalyticsProviderSet } from "../forwarding.js";
import type { AnalyticsSiteConfig, NormalizedHit } from "../../index.js";

/**
 * @file Characterization of site analytics forwarding moved from the host: vendor selection per
 * request, consent and credential gating, failure isolation, and the REQUIRED host `warn` reporter
 * (plain messages; the host owns the line prefix and the console).
 */

const assertDeepEqual = (actual: unknown, expected: unknown) => expect(actual).toEqual(expected);
const assertEqual = (actual: unknown, expected: unknown, _message?: string) => expect(actual).toBe(expected);
const assertMatch = (actual: string, re: RegExp) => expect(actual).toMatch(re);
const assertNoMatch = (actual: string, re: RegExp) => expect(actual).not.toMatch(re);
const assertRejects = (promise: Promise<unknown>, re: RegExp) => expect(promise).rejects.toThrow(re);

const hit = (path = "/a"): NormalizedHit => ({
  workspaceId: "ws-1", occurredAt: "2026-10-21T10:00:00.000Z", kind: "pageview", path, referrerHost: null,
  utm: { source: null, medium: null, campaign: null, term: null, content: null }, country: null, region: null,
  deviceClass: "desktop", browserFamily: null, osFamily: null, visitorHash: "vh", sessionId: "sid", eventName: null, eventProps: null,
});

const siteConfig = (sink: string): AnalyticsSiteConfig => ({
  workspaceId: "ws-1", enabled: true, honorDoNotTrack: true, honorGlobalPrivacyControl: true, rawRetentionDays: 30,
  excludedPaths: [], excludedIpRanges: [], sink,
});

function vendor(credentialLabel?: string) {
  const created: unknown[] = [];
  const module: AnalyticsForwarderModule = {
    ...(credentialLabel ? { credentialLabel } : {}),
    create: (input) => { created.push(input); return { forward: async () => ({ status: "ok", value: undefined }) }; },
  };
  return { module, created };
}

function providerSet(modules: Record<string, AnalyticsForwarderModule>, hooks: EngineHooks[] = [], refusals: string[] = []): AnalyticsProviderSet {
  return { forwarders: createAnalyticsForwarderRegistry({}, { seed: Object.entries(modules).map(([id, provider]) => ({ id, provider })) }), hooks, refusals };
}

const httpClient = { send: async () => { throw new Error("no network in tests"); } };

function forwarding(overrides: Partial<Parameters<typeof createAnalyticsForwarding<string>>[0]> & { sink?: string } = {}) {
  const warnings: string[] = [];
  const calls = { consent: 0, load: 0, credential: [] as string[] };
  const { sink = "plausible", ...rest } = overrides;
  const resolve = createAnalyticsForwarding<string>({
    workspaceId: "ws-1",
    config: { get: async () => siteConfig(sink) },
    loadProviders: async () => { calls.load++; return providerSet({}); },
    consentAllowsAnalytics: async () => { calls.consent++; return true; },
    resolveCredential: async ({ label }) => { calls.credential.push(label); return null; },
    httpClient,
    warn: (m) => { warnings.push(m); },
    ...rest,
  });
  return { resolve, warnings, calls };
}

test("\"local\" forwards nowhere without loading plugins or reading consent", async () => {
  const { resolve, calls, warnings } = forwarding({ sink: "local", loadProviders: async () => { calls.load++; return providerSet({}); } });
  assertDeepEqual(await resolve({ request: "req" }), []);
  assertDeepEqual(warnings, []);
  assertEqual(calls.consent, 0);
  assertEqual(calls.load, 0);
  const empty = forwarding({ sink: "" });
  assertDeepEqual(await empty.resolve({ request: "req" }), []);
  assertEqual(empty.calls.load, 0);
});

test("a selected, consented, credential-free vendor is bound with a live context", async () => {
  const v = vendor();
  const { resolve, calls } = forwarding({ loadProviders: async () => providerSet({ plausible: v.module }) });
  const bound = await resolve({ request: "req" });
  assertEqual(bound.length, 1);
  assertEqual(bound[0]!.id, "plausible");
  assertDeepEqual(bound[0]!.context, { workspaceId: "ws-1", mode: "live" });
  assertDeepEqual(v.created, [{ credential: null, kit: { httpClient } }]);
  assertDeepEqual(calls.credential, []);
});

test("consent denial forwards nothing and never creates the vendor", async () => {
  const v = vendor();
  const seen: string[] = [];
  const { resolve } = forwarding({
    loadProviders: async () => providerSet({ plausible: v.module }),
    consentAllowsAnalytics: async ({ request }) => { seen.push(request); return false; },
  });
  assertDeepEqual(await resolve({ request: "visitor-request" }), []);
  assertDeepEqual(seen, ["visitor-request"]);
  assertDeepEqual(v.created, []);
});

test("an uninstalled sink id warns and keeps the built-in sink only", async () => {
  const { resolve, warnings, calls } = forwarding({ sink: "posthog" });
  assertDeepEqual(await resolve({ request: "req" }), []);
  assertDeepEqual(warnings, ["analytics sink 'posthog' is not installed; hits stay in the built-in sink only"]);
  assertEqual(calls.consent, 0);
});

test("a labelled vendor gets its resolved credential, or forwards nothing when none is saved", async () => {
  const v = vendor("GA4 key");
  const credential = { token: "secret", baseUrl: "https://www.google-analytics.com" };
  const withKey = forwarding({ sink: "ga4", loadProviders: async () => providerSet({ ga4: v.module }), resolveCredential: async () => credential });
  assertEqual((await withKey.resolve({ request: "r" })).length, 1);
  assertDeepEqual(v.created, [{ credential, kit: { httpClient } }]);

  const without = forwarding({ sink: "ga4", loadProviders: async () => providerSet({ ga4: v.module }) });
  assertDeepEqual(await without.resolve({ request: "r" }), []);
  assertDeepEqual(without.calls.credential, ["GA4 key"]);
  assertDeepEqual(without.warnings, ["analytics sink 'ga4' has no saved \"GA4 key\" credential; hits stay in the built-in sink only"]);
});

test("any failure (config, load, consent, credential, create) forwards nothing and warns", async () => {
  const failing = [
    { config: { get: async () => { throw new Error("ledger down"); } } },
    { loadProviders: async () => { throw "plugins unreadable"; } },
  ];
  for (const overrides of failing) {
    const { resolve, warnings } = forwarding(overrides as never);
    assertDeepEqual(await resolve({ request: "r" }), []);
    assertEqual(warnings.length, 1);
    assertMatch(warnings[0] ?? "", /^vendor forwarding skipped: resolution failed Cause: /);
  }
  const v = { credentialLabel: "GA4 key", create: () => { throw Object.assign(new Error("boom host_ak_0123456789ab.SECRETSECRETSECRETSECRET"), { code: "EIO" }); } };
  const leaky = forwarding({ sink: "ga4", loadProviders: async () => providerSet({ ga4: v as never }), resolveCredential: async () => ({ token: "SECRET-TOKEN-1", baseUrl: "https://x" }) });
  assertDeepEqual(await leaky.resolve({ request: "r" }), []);
  assertMatch(leaky.warnings.join("\n"), /Error/);
  assertMatch(leaky.warnings.join("\n"), /EIO/);
  assertNoMatch(leaky.warnings.join("\n"), /boom/);
  assertNoMatch(leaky.warnings.join("\n"), /SECRET/);
});

test("warnings reach only the injected reporter, as plain messages; nothing is written to the console", async () => {
  const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const logged: string[] = [];
  const warn = (m: string) => { logged.push(m); };
  try {
    const resolve = createAnalyticsForwarding<string>({
      workspaceId: "ws-1", config: { get: async () => siteConfig("x") }, loadProviders: async () => providerSet({}),
      consentAllowsAnalytics: async () => true, resolveCredential: async () => null, httpClient, warn,
    });
    expect(await resolve({ request: "r" })).toEqual([]);
    const hooks = createPluginAnalyticsHooks({ loadProviders: async () => providerSet({}, [{ beforeIngest: async () => { throw new Error("h"); } }]), warn });
    await hooks.beforeIngest({ hit: hit() });
    const load = cacheAnalyticsProviders({ load: async () => providerSet({}, [], ["refused one"]), clock: { nowMs: () => 0 }, warn });
    await load();
    expect(consoleWarn).not.toHaveBeenCalled();
  } finally {
    consoleWarn.mockRestore();
  }
  expect(logged).toEqual([
    "analytics sink 'x' is not installed; hits stay in the built-in sink only",
    "beforeIngest hook #0 failed and was skipped: beforeIngest handler threw",
    "refused one",
  ]);
});

test("cacheAnalyticsProviders memoises per TTL, reports refusals once, and never caches a failure", async () => {
  let now = 0;
  let loads = 0;
  let fail = true;
  const warnings: string[] = [];
  const load = cacheAnalyticsProviders({
    load: async () => { loads++; if (fail) throw new Error("not yet"); return providerSet({}, [], ["r1"]); },
    clock: { nowMs: () => now },
    warn: (m) => { warnings.push(m); },
  }, { ttlMs: 100 });

  await assertRejects(load(), /not yet/);
  await Promise.resolve();
  fail = false;
  const first = await load();
  assertEqual(loads, 2, "a rejected load is retried, not cached");
  now = 99;
  assertEqual(await load(), first);
  assertEqual(loads, 2);
  now = 100;
  await load();
  assertEqual(loads, 3);
  assertDeepEqual(warnings, ["r1", "r1"]);
});

test("cacheAnalyticsProviders keeps a newer cache entry when an older load rejects", async () => {
  let now = 0;
  let rejectFirst!: (e: Error) => void;
  let calls = 0;
  const load = cacheAnalyticsProviders({
    load: () => { calls++; return calls === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve(providerSet({})); },
    clock: { nowMs: () => now },
    warn: () => undefined,
  }, { ttlMs: 10 });
  const stale = load();
  now = 20;
  const fresh = await load();
  rejectFirst(new Error("late"));
  await assertRejects(stale, /late/);
  now = 25;
  assertEqual(await load(), fresh);
  assertEqual(calls, 2);
});

test("createPluginAnalyticsHooks: no handlers or a failed load pass the hit unchanged; handlers chain", async () => {
  const h = hit();
  assertEqual(await createPluginAnalyticsHooks({ loadProviders: async () => providerSet({}), warn: () => undefined }).beforeIngest({ hit: h }), h);
  assertEqual(await createPluginAnalyticsHooks({ loadProviders: async () => { throw new Error("x"); }, warn: () => undefined }).beforeIngest({ hit: h }), h);

  const warnings: string[] = [];
  const hooks = createPluginAnalyticsHooks({ loadProviders: async () => providerSet({}, [
    { beforeIngest: async () => { throw new Error("broken"); } },
    { beforeIngest: async ({ hit: x }) => (x.path === "/internal" ? null : { ...x, path: `${x.path}/tagged` }) },
  ]), warn: (m) => { warnings.push(m); } });
  assertEqual((await hooks.beforeIngest({ hit: hit("/a") }))?.path, "/a/tagged");
  assertEqual(await hooks.beforeIngest({ hit: hit("/internal") }), null);
  assertDeepEqual(warnings, [
    "beforeIngest hook #0 failed and was skipped: beforeIngest handler threw",
    "beforeIngest hook #0 failed and was skipped: beforeIngest handler threw",
  ]);
});
