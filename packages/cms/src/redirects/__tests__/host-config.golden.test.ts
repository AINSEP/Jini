import assert from "node:assert/strict";
import { test } from "vitest";
import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/http-kit/verified-origin";
import { toNetlifyRedirects, toVercelRedirects } from "../host-config/index.js";
import type { RedirectTargetOracle } from "../target-gate.js";
import type { RedirectRecord } from "../types.js";

const reservedSegments = new Set(["admin", "api"]);
const oracle = new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [{
  workspaceId: "site", origin: createVerifiedOrigin({ scheme: "https", host: "trusted.example", verifiedAt: "2026-10-07T00:00:00.000Z", source: "workspace-setting" }), redirectAllowlist: ["partner.example"],
}] }) });
function rule(overrides: Partial<RedirectRecord>): RedirectRecord {
  return { id: "r1", workspaceId: "site", matchType: "exact", fromPattern: "/old", toTarget: "/new", statusCode: 301,
    status: "active", override: true, priority: 0, source: "manual", createdByPrincipal: "user", createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", version: 1, ...overrides };
}

test("Netlify golden preserves status codes, force markers, absolute targets and deterministic order", async () => {
  const result = await toNetlifyRedirects({ oracle, reservedSegments, rules: [
    rule({ id: "temporary-method", fromPattern: "/z", toTarget: "/new-z", statusCode: 307 }),
    rule({ id: "fallback", fromPattern: "/fallback", toTarget: "/new-fallback", statusCode: 302, override: false }),
    rule({ id: "external", fromPattern: "/external", toTarget: "https://partner.example/landing?from=site", statusCode: 308 }),
    rule({ id: "permanent", fromPattern: "/a", toTarget: "/new-a", statusCode: 301 }),
  ] }, {});
  assert.deepEqual(result, {
    emitted: "/a /new-a 301!\n/external https://partner.example/landing?from=site 308!\n/fallback /new-fallback 302\n/z /new-z 307!\n",
    refused: [],
  });
});

test("Vercel golden preserves all four status codes and refuses a post-content match", async () => {
  const result = await toVercelRedirects({ oracle, reservedSegments, rules: [
    rule({ id: "r308", fromPattern: "/d", toTarget: "/new-d", statusCode: 308 }),
    rule({ id: "r307", fromPattern: "/c", toTarget: "/new-c", statusCode: 307 }),
    rule({ id: "r302", fromPattern: "/b", toTarget: "/new-b", statusCode: 302 }),
    rule({ id: "r301", fromPattern: "/a", toTarget: "/new-a", statusCode: 301 }),
    rule({ id: "fallback", fromPattern: "/fallback", override: false }),
  ] }, {});
  assert.deepEqual(result, {
    emitted: { redirects: [
      { source: "/a", destination: "/new-a", statusCode: 301 },
      { source: "/b", destination: "/new-b", statusCode: 302 },
      { source: "/c", destination: "/new-c", statusCode: 307 },
      { source: "/d", destination: "/new-d", statusCode: 308 },
    ] },
    refused: [{ redirectId: "fallback", reason: "host-phase-would-widen" }],
  });
});

test("export refuses interpolated absolute targets, widened host patterns and dynamic relative targets", async () => {
  const rules = [
    rule({ id: "absolute-template", matchType: "wildcard", fromPattern: "/go/*", toTarget: "https://$1" }),
    rule({ id: "glob", matchType: "wildcard", fromPattern: "/one/*", toTarget: "/new/$1" }),
    rule({ id: "prefix", matchType: "prefix", fromPattern: "/docs", toTarget: "/new-docs" }),
    rule({ id: "placeholder", fromPattern: "/old/:id" }),
    rule({ id: "dot-normalized", fromPattern: "/a/../old" }),
    rule({ id: "encoded-source", fromPattern: "/%6fld" }),
    rule({ id: "reserved", fromPattern: "/allowed-source", toTarget: "/admin" }),
    rule({ id: "disabled", status: "disabled", fromPattern: "/disabled" }),
  ];
  const expected = [
    { redirectId: "absolute-template", reason: "interpolated-absolute-target" },
    { redirectId: "glob", reason: "host-match-would-widen" },
    { redirectId: "prefix", reason: "dynamic-target-requires-runtime-oracle" },
    { redirectId: "placeholder", reason: "host-match-would-widen" },
    { redirectId: "dot-normalized", reason: "host-match-would-widen" },
    { redirectId: "encoded-source", reason: "host-match-would-widen" },
    { redirectId: "reserved", reason: "reserved-destination" },
    { redirectId: "disabled", reason: "inactive-rule" },
  ];
  assert.deepEqual(await toNetlifyRedirects({ rules, oracle, reservedSegments }, {}), { emitted: "", refused: expected });
  assert.deepEqual(await toVercelRedirects({ rules, oracle, reservedSegments }, {}), { emitted: { redirects: [] }, refused: expected });
});

test("duplicate paths preserve the runtime winner; an unsafe winner cannot expose a lower-priority fallback", async () => {
  const fallback = rule({ id: "fallback", priority: 1 });
  const winner = rule({ id: "winner", priority: 9, toTarget: "https://evil.example/new" });
  for (const rules of [[fallback, winner], [winner, fallback]]) {
    const result = await toNetlifyRedirects({ rules, oracle, reservedSegments }, {});
    assert.equal(result.emitted, "");
    assert.equal(result.refused.length, 2);
    assert.deepEqual(result.refused.find(entry => entry.redirectId === "fallback"), { redirectId: "fallback", reason: "shadowed-rule" });
    assert.deepEqual(result.refused.find(entry => entry.redirectId === "winner"), { redirectId: "winner", reason: "target-not-allowed" });
  }
  const safe = rule({ id: "winner", priority: 9, toTarget: "/winner" });
  assert.equal((await toNetlifyRedirects({ rules: [fallback, safe], oracle, reservedSegments }, {})).emitted, "/old /winner 301!\n");
});

test("mixed workspaces and unavailable oracle yield explicit refusals without partial hidden output", async () => {
  const rules = [rule({ id: "site-a" }), rule({ id: "site-b", workspaceId: "other", fromPattern: "/other" })];
  assert.deepEqual(await toNetlifyRedirects({ rules, oracle, reservedSegments }, {}), {
    emitted: "", refused: [{ redirectId: "site-a", reason: "mixed-workspaces" }, { redirectId: "site-b", reason: "mixed-workspaces" }],
  });
  const unavailable: RedirectTargetOracle = { canonicalOrigin: context => oracle.canonicalOrigin(context), isAllowedRedirectTarget: async () => { throw new Error("/private/driver/path"); } };
  const failed = await toVercelRedirects({ rules: [rule({ id: "failed" })], oracle: unavailable, reservedSegments }, {});
  assert.deepEqual(failed, { emitted: { redirects: [] }, refused: [{ redirectId: "failed", reason: "oracle-error" }] });
});

test("host export preserves pre-content precedence and refuses a literal displaced by a dynamic override", async () => {
  const fallback = rule({ id: "post", priority: 9, override: false, toTarget: "/post" });
  const earlier = rule({ id: "pre", priority: 1, override: true, toTarget: "/pre" });
  assert.deepEqual(await toNetlifyRedirects({ rules: [fallback, earlier], oracle, reservedSegments }, {}), {
    emitted: "/old /pre 301!\n", refused: [{ redirectId: "post", reason: "shadowed-rule" }],
  });
  const dynamic = rule({ id: "dynamic", matchType: "prefix", fromPattern: "/old", override: true, toTarget: "/pre" });
  assert.deepEqual(await toNetlifyRedirects({ rules: [fallback, dynamic], oracle, reservedSegments }, {}), {
    emitted: "", refused: [{ redirectId: "post", reason: "shadowed-rule" }, { redirectId: "dynamic", reason: "dynamic-target-requires-runtime-oracle" }],
  });
  const nestedFallback = rule({ id: "nested-post", fromPattern: "/old/nested", override: false });
  assert.deepEqual(await toNetlifyRedirects({ rules: [nestedFallback, dynamic], oracle, reservedSegments }, {}), {
    emitted: "", refused: [{ redirectId: "nested-post", reason: "shadowed-rule" }, { redirectId: "dynamic", reason: "dynamic-target-requires-runtime-oracle" }],
  });
});
