import assert from "node:assert/strict";
import { test } from "vitest";
import { nodeTestContext } from "./support/node-test-context.fixture.js";

import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/http-kit/verified-origin";
import { redirectMatcher } from "../matcher.js";
import { RedirectPhaseHandlerResolver } from "../resolver.js";
import { InMemoryRedirectRepo } from "../repo.memory.js";
import type { RedirectRecord } from "../types.js";

/**
 * @file T006 (INV-03, AC-12/13/14, REQ-09/10) — DEDICATED, highest-aggregate-
 * risk test: the open-redirect write+read dual-path check's READ half.
 *
 * `RedirectResolver.resolve` must call `OriginRegistryPort.isAllowedRedirectTarget`
 * against the FULLY-INTERPOLATED `location` in every code path before EVER
 * returning `matched: true`. A wildcard capture crafted to interpolate a
 * disallowed cross-origin location must resolve to `{ matched: false }` —
 * NEVER a match, regardless of match-type precedence. A same-origin relative
 * target must still pass.
 *
 * This gets the same dedicated, non-folded treatment SPEC-007 gave its write
 * chokepoint (T008 there) — certified against the real `RedirectMatcher` +
 * `InMemoryRedirectRepo` + the real `OriginRegistry` (not a stub), so the
 * actual open-redirect oracle logic (`normalizeOriginCandidate` +
 * same-origin/allowlist checks) is exercised, not a mock that could hide a
 * bypass.
 */

const WORKSPACE_ID = "workspace-1";

function makeOriginRegistry(opts: { redirectAllowlist?: string[] } = {}) {
  const repo = new InMemoryOriginSettingRepo({ seeds: [
    {
      workspaceId: WORKSPACE_ID,
      origin: createVerifiedOrigin({
        scheme: "https",
        host: "trusted.example",
        verifiedAt: "2026-07-13T00:00:00.000Z",
        source: "workspace-setting",
      }),
      redirectAllowlist: opts.redirectAllowlist ?? [],
    },
  ] });
  return new OriginRegistry({ repo });
}

function rule(overrides: Partial<RedirectRecord>): RedirectRecord {
  return {
    id: overrides.id ?? "rule-1",
    workspaceId: WORKSPACE_ID,
    matchType: "exact",
    fromPattern: "/a",
    toTarget: "/b",
    statusCode: 301,
    status: "active",
    override: false,
    priority: 0,
    source: "manual",
    createdByPrincipal: "user-1",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test("INV-03: a wildcard capture crafted to interpolate a disallowed cross-origin location NEVER resolves to matched:true", async () => {
  // Realistic scenario: an operator authors a "URL-shortener-style" wildcard
  // rule (`/go/*` -> `https://$1`, e.g. for social-share short links). An
  // attacker requests a path whose single-segment capture turns the
  // interpolated location into an absolute URL pointing at their own domain.
  const repo = new InMemoryRedirectRepo({ seed: [
    rule({
      id: "wildcard-evil",
      matchType: "wildcard",
      fromPattern: "/go/*",
      toTarget: "https://$1",
    }),
  ] }, {});
  const originRegistry = makeOriginRegistry(); // empty allowlist — evil.example is never allowed
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]), repo, matcher: redirectMatcher, originRegistry });

  const result = await resolver.resolve({
    workspaceId: WORKSPACE_ID,
    path: "/go/evil.example",
    phase: "post_content",
  });

  assert.deepEqual(result, { matched: false });
});

test("INV-03: a protocol-relative-looking interpolated location also never resolves to matched:true", async () => {
  const repo = new InMemoryRedirectRepo({ seed: [
    rule({ id: "wildcard-protocol-relative", matchType: "wildcard", fromPattern: "/go2/*", toTarget: "//$1" }),
  ] }, {});
  const originRegistry = makeOriginRegistry();
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]), repo, matcher: redirectMatcher, originRegistry });

  const result = await resolver.resolve({
    workspaceId: WORKSPACE_ID,
    path: "/go2/evil.example",
    phase: "post_content",
  });

  assert.deepEqual(result, { matched: false });
});

test("a same-origin relative target passes (matched:true, oracle allows it)", async () => {
  const repo = new InMemoryRedirectRepo({ seed: [
    rule({ id: "same-origin", matchType: "exact", fromPattern: "/old", toTarget: "/new" }),
  ] }, {});
  const originRegistry = makeOriginRegistry();
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]), repo, matcher: redirectMatcher, originRegistry });

  const result = await resolver.resolve({ workspaceId: WORKSPACE_ID, path: "/old", phase: "post_content" });

  assert.deepEqual(result, {
    matched: true,
    redirectId: "same-origin",
    location: "/new",
    statusCode: 301,
    matchType: "exact",
  });
});

test("an ALLOWLISTED cross-origin wildcard target passes", async () => {
  const repo = new InMemoryRedirectRepo({ seed: [
    rule({ id: "wildcard-allowlisted", matchType: "wildcard", fromPattern: "/go3/*", toTarget: "https://$1" }),
  ] }, {});
  const originRegistry = makeOriginRegistry({ redirectAllowlist: ["partner.example"] });
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]), repo, matcher: redirectMatcher, originRegistry });

  const result = await resolver.resolve({
    workspaceId: WORKSPACE_ID,
    path: "/go3/partner.example",
    phase: "post_content",
  });

  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.location, "https://partner.example");
});

test("a same-origin ABSOLUTE target (matching the workspace's own verified origin) passes", async () => {
  const repo = new InMemoryRedirectRepo({ seed: [
    rule({
      id: "absolute-same-origin",
      matchType: "exact",
      fromPattern: "/old-abs",
      toTarget: "https://trusted.example/new-abs",
    }),
  ] }, {});
  const originRegistry = makeOriginRegistry();
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]), repo, matcher: redirectMatcher, originRegistry });

  const result = await resolver.resolve({ workspaceId: WORKSPACE_ID, path: "/old-abs", phase: "post_content" });

  assert.equal(result.matched, true);
});

test("no matching rule resolves to matched:false without ever consulting the oracle for a nonexistent path", async () => {
  const t = nodeTestContext();
  const repo = new InMemoryRedirectRepo({ seed: [] }, {});
  const originRegistry = makeOriginRegistry();
  const oracle = t.mock.method(originRegistry, "isAllowedRedirectTarget", async () => { throw new Error("no candidate to check"); });
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]), repo, matcher: redirectMatcher, originRegistry });

  const result = await resolver.resolve({ workspaceId: WORKSPACE_ID, path: "/nowhere", phase: "post_content" });
  assert.deepEqual(result, { matched: false });
  assert.equal(oracle.mock.callCount(), 0);
});

test("pre_content phase only considers override:true rules", async () => {
  const repo = new InMemoryRedirectRepo({ seed: [
    rule({ id: "non-override", matchType: "exact", fromPattern: "/x", toTarget: "/y", override: false }),
  ] }, {});
  const originRegistry = makeOriginRegistry();
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]), repo, matcher: redirectMatcher, originRegistry });

  const result = await resolver.resolve({ workspaceId: WORKSPACE_ID, path: "/x", phase: "pre_content" });
  assert.deepEqual(result, { matched: false });
});

test("pre_content phase matches an override:true rule", async () => {
  const repo = new InMemoryRedirectRepo({ seed: [
    rule({ id: "override-rule", matchType: "exact", fromPattern: "/x", toTarget: "/y", override: true }),
  ] }, {});
  const originRegistry = makeOriginRegistry();
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]), repo, matcher: redirectMatcher, originRegistry });

  const result = await resolver.resolve({ workspaceId: WORKSPACE_ID, path: "/x", phase: "pre_content" });
  assert.equal(result.matched, true);
});

for (const pending of [false, true]) {
  test(`redirect resolution records the exact hit and completes with an ${pending ? "unsettled" : "rejecting"} outbox`, async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const events: unknown[] = [];
    const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]),
      repo: new InMemoryRedirectRepo({ seed: [rule({ id: "hit-rule", fromPattern: "/old", toTarget: "/new" })] }, {}),
      matcher: redirectMatcher, originRegistry: makeOriginRegistry(),
      hits: { clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") }, idGen: { newId: () => "hit-1" },
        outbox: { enqueue: async (event: unknown) => { events.push(event); if (pending) await held; else throw new Error("hit sink unavailable"); } } as never },
    });
    const resolution = resolver.resolve({ workspaceId: WORKSPACE_ID, path: "/old", phase: "post_content" });
    try {
      const result = await Promise.race([resolution, new Promise(resolve => setImmediate(() => resolve("still waiting on outbox")))]);
      assert.deepEqual(result, { matched: true, redirectId: "hit-rule", location: "/new", statusCode: 301, matchType: "exact" });
      assert.deepEqual(events, [{ id: "hit-1", name: "redirect.hit", occurredAt: "2026-07-13T00:00:00.000Z",
        aggregateId: "hit-rule", workspaceId: WORKSPACE_ID,
        payload: { workspaceId: WORKSPACE_ID, redirectId: "hit-rule", at: "2026-07-13T00:00:00.000Z" } }]);
    } finally { release(); await resolution; }
  });
}

test("a relative redirect without a verified origin fails closed", async () => {
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]),
    repo: new InMemoryRedirectRepo({ seed: [rule({})] }, {}), matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [] }) }),
  });
  assert.deepEqual(await resolver.resolve({ workspaceId: WORKSPACE_ID, path: "/a", phase: "post_content" }), { matched: false });
});

test("an allowed absolute redirect fails closed when the canonical origin cannot be read", async () => {
  const t = nodeTestContext();
  const originRegistry = makeOriginRegistry({ redirectAllowlist: ["partner.example"] });
  t.mock.method(originRegistry, "canonicalOrigin", async () => { throw new Error("origin unavailable"); });
  const oracle = t.mock.method(originRegistry, "isAllowedRedirectTarget");
  const resolver = new RedirectPhaseHandlerResolver({ reservedSegments: new Set(["admin", "api"]),
    repo: new InMemoryRedirectRepo({ seed: [rule({ toTarget: "https://partner.example/new" })] }, {}), matcher: redirectMatcher, originRegistry,
  });
  assert.deepEqual(await resolver.resolve({ workspaceId: WORKSPACE_ID, path: "/a", phase: "post_content" }), { matched: false });
  assert.deepEqual(oracle.mock.calls.map(c => c.arguments), [[{ context: { workspaceId: WORKSPACE_ID }, url: "https://partner.example/new" }]]);
});
