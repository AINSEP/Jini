import assert from "node:assert/strict";
import { test } from "vitest";
import { ingestHit, validateEventProps, createNodeAnalyticsHash, normalizeIngestContext } from "../ingest.js";
import { deriveDailySalt } from "../salt.js";
import { LocalBufferSink } from "../repo.memory.js";

const policy = { maxEventPropCount: 20, maxEventPropStringLength: 200, sessionWindowMinutes: 30 };
test("required privacy bounds change validation outcomes without changing package code", () => {
  const props = { first: "ok", second: "ok" };
  assert.deepEqual(validateEventProps({ props, privacyPolicy: policy }), props);
  assert.throws(() => validateEventProps({ props, privacyPolicy: { ...policy, maxEventPropCount: 1 } }));
  assert.throws(() => validateEventProps({ props, privacyPolicy: { ...policy, sessionWindowMinutes: 0 } }), RangeError);
});
test("both HKDF contexts are explicit and change the derived output", () => {
  const input = { rootKeySeed: "secret", workspaceId: "ws", utcDate: "2026-10-01" };
  const first = deriveDailySalt({ ...input, saltContext: { extractionSalt: "context-a", infoPrefix: "analytics:" } });
  assert.notEqual(first.toString("hex"), deriveDailySalt({ ...input, saltContext: { extractionSalt: "context-b", infoPrefix: "analytics:" } }).toString("hex"));
  assert.notEqual(first.toString("hex"), deriveDailySalt({ ...input, saltContext: { extractionSalt: "context-a", infoPrefix: "traffic:" } }).toString("hex"));
});
test("hash adapters receive bucketed signals, never the raw IP or UA", () => {
  const input = { ip: "203.0.113.71", userAgent: "Safari/605.1", siteHost: "example.test" };
  const parts: unknown[] = [];
  const native = createNodeAnalyticsHash({});
  const result = normalizeIngestContext({ input, dailySalt: Buffer.alloc(32, 1) }, { hash: {
    ...native, sha256(required) { parts.push(...required.parts); return "host-digest"; },
  } });
  assert.equal(result.visitorHash, "host-digest");
  assert.equal(parts.includes(input.ip), false);
  assert.equal(parts.includes(input.userAgent), false);
  assert.deepEqual(parts.slice(1), ["example.test", "203.0.113.0|desktop|safari"]);
});
test("arg-2 hooks transform the hit and sink failures propagate", async () => {
  const sink = new LocalBufferSink({});
  const deps = { sink, privacyPolicy: policy, rootKeySeed: "seed", saltContext: { extractionSalt: "host-hkdf", infoPrefix: "traffic:" },
    resolveWorkspaceForHost: () => "ws", config: { get: async () => ({ workspaceId: "ws", enabled: true, honorDoNotTrack: true, honorGlobalPrivacyControl: true, rawRetentionDays: 2, excludedPaths: [], excludedIpRanges: [], sink: "local" as const }) } };
  const required = { deps, input: { beacon: { host: "example.test", path: "/original", referrer: null, kind: "pageview" as const }, context: { ip: "203.0.113.1", userAgent: "", acceptLanguage: null, receivedAt: "2026-10-01T00:00:00.000Z" } } };
  assert.deepEqual(await ingestHit(required, { hooks: { beforeIngest: async ({ hit }) => ({ ...hit, path: "/host-policy" }) } }), { accepted: true });
  assert.equal(sink.all({})[0]!.path, "/host-policy");
  sink.accept = async () => { throw new Error("sink unavailable"); };
  await assert.rejects(() => ingestHit(required), /sink unavailable/);
});
