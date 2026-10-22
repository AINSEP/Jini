import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonObject } from "@jini-ai/core/primitives";
import { ingestHit, validateEventProps, type IngestHitDeps, type IngestHitRequired } from "../ingest.js";
import { AnalyticsPiiRejectedError } from "../ports.js";
import { LocalBufferSink } from "../repo.memory.js";
import type { AnalyticsHashPort, DailySaltRequired } from "../salt.js";
import type { AnalyticsPrivacyPolicy, AnalyticsSiteConfig } from "../types.js";

const policy: AnalyticsPrivacyPolicy = {
  maxEventPropCount: 6, maxEventPropStringLength: 20, sessionWindowMinutes: 30,
};

function fixture(_required: Record<string, never>, _optional: Record<string, never> = {}) {
  const sink = new LocalBufferSink({});
  const calls: string[] = [];
  const config: AnalyticsSiteConfig = {
    workspaceId: "workspace-1", enabled: true, honorDoNotTrack: true,
    honorGlobalPrivacyControl: true, excludedPaths: ["/admin/*"],
    excludedIpRanges: ["10.0.0.0/24"], rawRetentionDays: 2, sink: "local",
  };
  const deps: IngestHitDeps = {
    sink, privacyPolicy: { ...policy }, rootKeySeed: "host-root",
    saltContext: { extractionSalt: "host-context", infoPrefix: "traffic:" },
    resolveWorkspaceForHost: ({ host }) => {
      assert.equal(host, "example.test");
      calls.push("resolve");
      return "workspace-1";
    },
    config: { async get({ workspaceId }) {
      assert.equal(workspaceId, "workspace-1");
      calls.push("config");
      return config;
    } },
  };
  const required: IngestHitRequired = {
    deps,
    input: {
      beacon: { host: "example.test", path: "/article", referrer: null, kind: "pageview" },
      context: { ip: "203.0.113.71", userAgent: "Safari/605.1", acceptLanguage: "en",
        receivedAt: "2026-10-01T12:31:00.000Z" },
    },
  };
  return { required, sink, calls, config };
}

test.each([null, undefined, {}])("absent/empty properties retain the old null and identity contract: %j", (props) => {
  assert.equal(validateEventProps({ props, privacyPolicy: policy }), props ?? null);
});

test.each([
  { maxEventPropCount: 0 }, { maxEventPropStringLength: -1 }, { sessionWindowMinutes: 1.5 },
])("privacy bounds are checked even for absent properties: %j", (invalid) => {
  assert.throws(() => validateEventProps({ props: null, privacyPolicy: { ...policy, ...invalid } }), {
    name: "RangeError", message: "analytics privacy bounds must be positive integers",
  });
});

test("nested arrays and objects count their keys and accept the exact aggregate bound without cloning", () => {
  const props = { bag: { count: 2, flag: false }, tags: ["ok", null] };
  assert.equal(validateEventProps({ props, privacyPolicy: policy }), props);
  assert.deepEqual(props, { bag: { count: 2, flag: false }, tags: ["ok", null] });
});

const propertyRejections: { props: JsonObject; message: string }[] = [
  { props: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 },
    message: "event properties exceed the 6-key bound (7 given)" },
  { props: { bag: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } },
    message: "event properties exceed the 6-key bound" },
  { props: { tags: [1, 2, 3, 4, 5, 6] }, message: "event properties exceed the 6-key bound" },
  { props: { bag: { phone: 1 } }, message: "event property key 'phone' looks PII-shaped" },
  { props: { tags: ["a@b.test"] }, message: "event property '0' looks like an email address" },
  { props: { note: "x".repeat(21) }, message: "event property 'note' exceeds 20 characters" },
];

test.each(propertyRejections)("property rejection preserves its exact error: $message", ({ props, message }) => {
  assert.throws(() => validateEventProps({ props, privacyPolicy: policy }), (error: unknown) => {
    assert.ok(error instanceof AnalyticsPiiRejectedError);
    assert.equal(error.message, message);
    return true;
  });
});

test("string validation accepts the exact length bound", () => {
  const props = { note: "x".repeat(20) };
  assert.equal(validateEventProps({ props, privacyPolicy: policy }), props);
});

test("the property worklist visits sibling bags in reverse order after checking parent keys", () => {
  assert.throws(() => validateEventProps({ props: { left: { email: 1 }, right: { phone: 2 } }, privacyPolicy: policy }), {
    message: "event property key 'phone' looks PII-shaped",
  });
  assert.throws(() => validateEventProps({ props: { bag: { phone: 2 }, email: null }, privacyPolicy: policy }), {
    message: "event property key 'email' looks PII-shaped",
  });
});

test("invalid privacy policy fails before workspace resolution", async () => {
  const { required, calls, sink } = fixture({});
  required.deps.privacyPolicy.sessionWindowMinutes = 0;
  await assert.rejects(() => ingestHit(required), RangeError);
  assert.deepEqual(calls, []);
  assert.deepEqual(sink.all({}), []);
});

test("an unresolved workspace skips config and property validation", async () => {
  const { required, calls, sink } = fixture({});
  required.deps.resolveWorkspaceForHost = () => null;
  required.input.beacon.eventProps = { email: "a@b.test" };
  assert.deepEqual(await ingestHit(required), { accepted: false, reason: "workspace_unresolved" });
  assert.deepEqual(calls, []);
  assert.deepEqual(sink.all({}), []);
});

test.each([
  { name: "disabled", enabled: false, dnt: true, gpc: true, path: "/admin/x", reason: "analytics_disabled" },
  { name: "DNT", enabled: true, dnt: true, gpc: true, path: "/admin/x", reason: "dnt" },
  { name: "GPC", enabled: true, dnt: false, gpc: true, path: "/admin/x", reason: "gpc" },
  { name: "path", enabled: true, dnt: false, gpc: false, path: "/admin/x", reason: "excluded_path" },
  { name: "IP", enabled: true, dnt: false, gpc: false, path: "/article", reason: "excluded_ip" },
])("$name policy wins before PII validation and hooks", async ({ enabled, dnt, gpc, path, reason }) => {
  const { required, config, calls, sink } = fixture({});
  config.enabled = enabled;
  Object.assign(required.input.beacon, { dnt, gpc, path, eventProps: { email: "a@b.test" } });
  required.input.context = { ...required.input.context, ip: "10.0.0.42" };
  assert.deepEqual(await ingestHit(required, { hooks: { async beforeIngest() {
    assert.fail("policy drops must not invoke hooks");
  } } }), { accepted: false, reason });
  assert.deepEqual(calls, ["resolve", "config"]);
  assert.deepEqual(sink.all({}), []);
});

test("PII rejection is a drop, while an unexpected property getter failure propagates", async () => {
  const { required, sink } = fixture({});
  required.input.beacon.eventProps = { bag: { phone: 1 } };
  assert.deepEqual(await ingestHit(required), { accepted: false, reason: "pii_rejected" });
  const failure = new Error("getter failed");
  required.input.beacon.eventProps = { get note(): string { throw failure; } };
  await assert.rejects(() => ingestHit(required), (error: unknown) => error === failure);
  assert.deepEqual(sink.all({}), []);
});

test("normalized hit construction preserves salt custody, hash inputs and every stored field", async () => {
  const { required, sink } = fixture({});
  const salts: DailySaltRequired[] = [];
  const hashes: (readonly (string | Uint8Array)[])[] = [];
  const dailySalt = Buffer.from("daily-salt");
  const hash: AnalyticsHashPort = {
    deriveDailySalt(input) { salts.push(input); return dailySalt; },
    sha256({ parts }) { hashes.push(parts); return `digest-${hashes.length}`; },
  };
  required.input.beacon = { ...required.input.beacon, kind: "event", eventName: "",
    eventProps: { bag: { plan: "pro" } }, referrer: "https://search.test/path?q=discard",
    path: "/article?utm_source=first&utm_source=second&utm_medium=mail&utm_campaign=launch&utm_term=one+two&utm_content=hero&ignored=x#fragment" };
  assert.deepEqual(await ingestHit(required, { hash }), { accepted: true });
  assert.deepEqual(salts, [{ rootKeySeed: "host-root", workspaceId: "workspace-1", utcDate: "2026-10-01",
    saltContext: { extractionSalt: "host-context", infoPrefix: "traffic:" } }]);
  assert.deepEqual(hashes, [[dailySalt, "example.test", "203.0.113.0|desktop|safari"], ["digest-1:2026-10-01:25"]]);
  assert.deepEqual(sink.all({}), [{ workspaceId: "workspace-1", occurredAt: "2026-10-01T12:31:00.000Z",
    kind: "event", path: "/article", referrerHost: "search.test",
    utm: { source: "first", medium: "mail", campaign: "launch", term: "one two", content: "hero" },
    country: null, region: null, deviceClass: "desktop", browserFamily: "safari", osFamily: "other",
    visitorHash: "digest-1", sessionId: "digest-2", eventName: "", eventProps: { bag: { plan: "pro" } } }]);
});

test.each([null, "", "invalid-url", "mailto:visitor@example.test"])("absent or hostless referrer %j normalizes to null with absent event fields", async (referrer) => {
  const { required, sink } = fixture({});
  required.input.beacon.referrer = referrer;
  assert.deepEqual(await ingestHit(required), { accepted: true });
  const hit = sink.all({})[0]!;
  assert.equal(hit.referrerHost, null);
  assert.equal(hit.eventName, null);
  assert.equal(hit.eventProps, null);
  assert.deepEqual(hit.utm, { source: null, medium: null, campaign: null, term: null, content: null });
  assert.match(hit.visitorHash, /^[a-f0-9]{64}$/);
  assert.match(hit.sessionId, /^[a-f0-9]{64}$/);
});

test("hooks can transform or drop hits and hook/sink failures propagate", async () => {
  const { required, sink } = fixture({});
  assert.deepEqual(await ingestHit(required, { hooks: { async beforeIngest({ hit }) {
    assert.equal(hit.path, "/article");
    return { ...hit, path: "/transformed" };
  } } }), { accepted: true });
  assert.equal(sink.all({})[0]!.path, "/transformed");
  assert.deepEqual(await ingestHit(required, { hooks: { async beforeIngest() { return null; } } }),
    { accepted: false, reason: "dropped_by_hook" });
  assert.equal(sink.all({}).length, 1);
  const failure = new Error("adapter failed");
  await assert.rejects(() => ingestHit(required, { hooks: { async beforeIngest() { throw failure; } } }),
    (error: unknown) => error === failure);
  sink.accept = async () => { throw failure; };
  await assert.rejects(() => ingestHit(required), (error: unknown) => error === failure);
  assert.equal(sink.all({}).length, 1);
});

for (const label of ['eventName', 'source', 'medium', 'campaign', 'term', 'content']) test(`rejects an email-shaped ${label} before the sink`, async () => {
  const { required, sink } = fixture({});
  if (label === 'eventName') required.input.beacon.eventName = 'visitor@example.test';
  else required.input.beacon.path = `/article?utm_${label}=visitor%40example.test`;
  assert.deepEqual(await ingestHit(required), { accepted: false, reason: 'pii_rejected' });
  assert.deepEqual(sink.all({}), []);
});
