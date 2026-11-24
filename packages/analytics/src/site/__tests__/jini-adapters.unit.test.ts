import assert from "node:assert/strict";
import { test } from "vitest";

import { analyticsPrivacyPolicy, createAnalyticsIngestBinding, createLocalAnalyticsSink, type AnalyticsIngestRouteDeps } from "../jini-adapters.js";
import type { AnalyticsSaltContext, NormalizedHit } from "../../index.js";

/** @file The host → @jini-ai/analytics port binding forwards each object argument. */

const hostSaltContext: AnalyticsSaltContext = { extractionSalt: "host-analytics-daily-salt-hkdf-v1", infoPrefix: "analytics-salt:" };

function hostDeps(withHooks: boolean) {
  const calls: Array<[string, unknown]> = [];
  const capabilities = { durable: false };
  const listed = [{ id: "hit-1" }] as unknown as NormalizedHit[];
  const deps = {
    config: { enabled: true },
    sink: {
      capabilities: () => { calls.push(["capabilities", undefined]); return capabilities; },
      accept: async ({ hit }: { hit: NormalizedHit }) => { calls.push(["accept", hit]); },
      acceptBatch: async ({ hits }: { hits: NormalizedHit[] }) => { calls.push(["acceptBatch", hits]); },
      list: async (_required: unknown, optional: unknown) => { calls.push(["list", optional]); return listed; },
    },
    resolveWorkspaceForHost: (host: string) => { calls.push(["resolve", host]); return host === "site.example" ? "ws-1" : null; },
    analyticsSeed: "seed-for-test",
    saltContext: hostSaltContext,
    reportForwardFailure: () => {},
    ...(withHooks ? { hooks: { beforeIngest: async ({ hit }: { hit: NormalizedHit }) => { calls.push(["beforeIngest", hit]); } } } : {}),
  } as unknown as AnalyticsIngestRouteDeps;
  return { deps, calls, capabilities, listed };
}

test("the binding forwards each sink call, workspace lookup and the host's fixed privacy policy and injected salt context", async () => {
  const host = hostDeps(false);
  const { deps, optional } = createAnalyticsIngestBinding({ deps: host.deps });
  const hit = { id: "hit-2" } as unknown as NormalizedHit;
  assert.equal(deps.sink.capabilities({}), host.capabilities);
  await deps.sink.accept({ hit });
  await deps.sink.acceptBatch({ hits: [hit] });
  assert.equal(await deps.sink.list({}, { limit: 5 }), host.listed);
  assert.equal(await deps.resolveWorkspaceForHost({ host: "site.example" }), "ws-1");
  assert.equal(await deps.resolveWorkspaceForHost({ host: "other.example" }), null);
  assert.deepEqual(host.calls, [["capabilities", undefined], ["accept", hit], ["acceptBatch", [hit]], ["list", { limit: 5 }], ["resolve", "site.example"], ["resolve", "other.example"]]);
  assert.equal(deps.rootKeySeed, "seed-for-test");
  assert.equal(deps.saltContext, hostSaltContext);
  assert.equal(deps.privacyPolicy, analyticsPrivacyPolicy);
  assert.equal(deps.config, host.deps.config);
  assert.deepEqual(optional, {}, "no host hooks means no Jini hooks");
});

test("host hooks are adapted to Jini's object-argument beforeIngest", async () => {
  const host = hostDeps(true);
  const { optional } = createAnalyticsIngestBinding({ deps: host.deps });
  const hit = { id: "hit-3" } as unknown as NormalizedHit;
  await optional.hooks?.beforeIngest?.({ hit } as never);
  assert.deepEqual(host.calls, [["beforeIngest", hit]]);
});

test("the local sink adapts Jini's buffer to the host sink port, seeded with initial hits", async () => {
  const hit = (path: string, second: number) => ({ path, workspaceId: "ws-1", occurredAt: `2026-10-20T00:00:0${second}.000Z` } as unknown as NormalizedHit);
  const sink = createLocalAnalyticsSink({}, { initialHits: [hit("/seed", 0)] });
  assert.equal(sink.capabilities().durable, false);
  await sink.accept({ hit: hit("/one", 1) });
  await sink.acceptBatch({ hits: [hit("/two", 2), hit("/three", 3)] });
  assert.deepEqual(sink.all().map((stored) => stored.path), ["/seed", "/one", "/two", "/three"]);
  const listed = await sink.list({}, { limit: 2 });
  assert.equal(listed.length, 2);
  assert.ok(listed.every((stored) => ["/seed", "/one", "/two", "/three"].includes(stored.path)));
});
