import assert from "node:assert/strict";
import { test } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/http-kit/verified-origin";
import { createRedirectResolver } from "../resolver.js";
import { redirectMatcher } from "../matcher.js";
import { InMemoryRedirectRepo } from "../repo.memory.js";
import { createSpaRedirectGuard } from "../spa/index.js";
import { toNetlifyRedirects, toVercelRedirects } from "../host-config/index.js";
import { createRedirectMiddleware, RedirectMiddlewareContextError } from "../express/index.js";
import type { RedirectTargetOracle } from "../target-gate.js";
import type { RedirectRecord } from "../types.js";

const workspaceId = "workspace-1";
const reservedSegments = new Set(["admin", "api"]);
const idnHost = new URL("https://évil.example").hostname;

// One adversarial case table drives EVERY effect boundary. Percent-encoded slashes stay in a
// same-origin pathname; refusing their authority-looking spelling must not invent an off-site URL.
const cases = [
  { name: "//evil", template: "//$1", capture: "evil.example", location: "//evil.example", allowed: false },
  { name: "/\\evil", template: "/$1", capture: "\\evil.example", location: "/\\evil.example", allowed: false },
  { name: "https:evil", template: "https:$1", capture: "evil.example", location: "https:evil.example", allowed: false },
  { name: "%2F%2F", template: "/$1", capture: "%2F%2Fevil.example", location: "/%2F%2Fevil.example", allowed: true },
  { name: "userinfo", template: "https://$1/new", capture: "user@trusted.example", location: "https://user@trusted.example/new", allowed: false },
  { name: "IDN outside allowlist", template: "https://$1/new", capture: "évil.example", location: "https://évil.example/new", allowed: false },
  { name: "IDN explicitly allowed", template: "https://$1/new", capture: "évil.example", location: "https://évil.example/new", allowed: true, allowlist: [idnHost] },
  { name: "same-origin path", template: "/$1", capture: "new", location: "/new", allowed: true },
  { name: "same-origin absolute", template: "https://trusted.example/$1", capture: "new", location: "https://trusted.example/new", allowed: true },
  { name: "reserved after capture", template: "/$1", capture: "admin", location: "/admin", allowed: false },
  { name: "encoded reserved after capture", template: "/$1", capture: "%61dmin", location: "/%61dmin", allowed: false },
  { name: "dot-segment reserved after decode", template: "/$1", capture: "safe%2F..%2Fadmin", location: "/safe%2F..%2Fadmin", allowed: false },
  { name: "Express referrer alias", template: "$1", capture: "back", location: "back", allowed: false },
] as const;

function rule(overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    id: "rule-1", workspaceId, matchType: "wildcard", fromPattern: "/go/*", toTarget: "/$1",
    statusCode: 308, status: "active", override: true, priority: 0, source: "manual",
    createdByPrincipal: "user-1", createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", version: 1,
    ...overrides,
  };
}
function origin(allowlist: readonly string[] = []): { oracle: RedirectTargetOracle; candidates: string[] } {
  const registry = new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [{
    workspaceId, origin: createVerifiedOrigin({ scheme: "https", host: "trusted.example", verifiedAt: "2026-10-07T00:00:00.000Z", source: "workspace-setting" }),
    redirectAllowlist: [...allowlist],
  }] }) });
  const candidates: string[] = [];
  return {
    candidates,
    oracle: {
      canonicalOrigin: context => registry.canonicalOrigin(context),
      isAllowedRedirectTarget: required => { candidates.push(required.url); return registry.isAllowedRedirectTarget(required); },
    },
  };
}

for (const entry of cases) {
  test(`shared open-redirect matrix: ${entry.name}`, async () => {
    const dynamicRule = rule({ toTarget: entry.template });
    const request = { workspaceId, path: `/go/${entry.capture}`, phase: "post_content" as const };
    const { oracle, candidates } = origin("allowlist" in entry ? entry.allowlist : []);
    const resolver = createRedirectResolver({ repo: new InMemoryRedirectRepo({ seed: [dynamicRule] }, {}), matcher: redirectMatcher, originRegistry: oracle, reservedSegments }, {});
    const resolution = await resolver.resolve(request, {});
    assert.equal(resolution.matched, entry.allowed, "resolver verdict");
    if (resolution.matched) assert.equal(resolution.location, entry.location);

    const navigations: string[] = [];
    const guard = createSpaRedirectGuard({ rules: [dynamicRule], oracle, reservedSegments, navigate: ({ location }) => { navigations.push(location); } }, {});
    const guarded = await guard({ request }, {});
    assert.equal(guarded.navigated, entry.allowed, "SPA verdict");
    assert.deepEqual(navigations, entry.allowed ? [entry.location] : [], "SPA effect only after approval");
    assert.equal(guarded.refused.length, entry.allowed ? 0 : 1, "SPA reports its refusal");

    const sent: Array<{ status: number; location: string }> = [];
    let nextCalls = 0;
    const errors: unknown[] = [];
    const response = { locals: { redirectContext: { workspaceId } }, redirect: (status: number, location: string) => { sent.push({ status, location }); } };
    const middleware = createRedirectMiddleware({ resolver }, { phase: "post_content" });
    const http = await middleware({ path: request.path } as Request, response as unknown as Response,
      ((error?: unknown) => { nextCalls++; if (error !== undefined) errors.push(error); }) as NextFunction);
    assert.deepEqual(errors, []);
    assert.deepEqual(sent, entry.allowed ? [{ status: 308, location: entry.location }] : [], "HTTP effect only after approval");
    assert.equal(nextCalls, entry.allowed ? 0 : 1);
    assert.ok("refused" in http);
    if ("refused" in http) assert.equal(http.refused.length, entry.allowed ? 0 : 1, "HTTP reports its refusal");

    // Static exporters check the SAME finished Location as a literal rule. They cannot ship the
    // dynamic template itself: its other inputs cannot be rechecked by a static host file.
    const literal = rule({ matchType: "exact", fromPattern: "/old", toTarget: entry.location });
    const netlify = await toNetlifyRedirects({ rules: [literal], oracle, reservedSegments }, {});
    const vercel = await toVercelRedirects({ rules: [literal], oracle, reservedSegments }, {});
    assert.equal(netlify.emitted.length > 0, entry.allowed, "Netlify literal verdict");
    assert.equal(vercel.emitted.redirects.length, entry.allowed ? 1 : 0, "Vercel literal verdict");
    assert.equal(netlify.refused.length, entry.allowed ? 0 : 1);
    assert.equal(vercel.refused.length, entry.allowed ? 0 : 1);
    if (entry.allowed) {
      assert.equal(netlify.emitted, `/old ${entry.location} 308!\n`);
      assert.deepEqual(vercel.emitted.redirects, [{ source: "/old", destination: entry.location, statusCode: 308 }]);
    }
    for (const exporter of [toNetlifyRedirects, toVercelRedirects]) {
      const dynamic = await exporter({ rules: [dynamicRule], oracle, reservedSegments }, {});
      assert.equal(dynamic.refused.length, 1, "unbounded template is explicitly refused");
    }
    if (entry.name !== "Express referrer alias") {
      const expectedCandidate = /^(?:\/\/|[a-z][a-z0-9+.-]*:)/i.test(entry.location)
        ? entry.location : `https://trusted.example${entry.location}`;
      assert.ok(candidates.length >= 3, "every runtime boundary reached the real oracle");
      assert.ok(candidates.every(candidate => candidate === expectedCandidate), "oracle sees interpolated Location, never the template");
    } else assert.deepEqual(candidates, [], "no candidate can describe Express's Referer substitution");
  });
}

test("an omitted verified origin refuses every effect boundary", async () => {
  const registry = new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [] }) });
  const literal = rule({ matchType: "exact", fromPattern: "/old", toTarget: "/new" });
  const resolver = createRedirectResolver({ repo: new InMemoryRedirectRepo({ seed: [literal] }, {}), matcher: redirectMatcher, originRegistry: registry, reservedSegments }, {});
  assert.deepEqual(await resolver.resolve({ workspaceId, path: "/old", phase: "post_content" }, {}), { matched: false });
  let navigated = false;
  const guard = createSpaRedirectGuard({ rules: [literal], oracle: registry, reservedSegments, navigate: () => { navigated = true; } }, {});
  assert.equal((await guard({ request: { workspaceId, path: "/old", phase: "post_content" } }, {})).refused.length, 1);
  assert.equal(navigated, false);
  assert.equal((await toNetlifyRedirects({ rules: [literal], oracle: registry, reservedSegments }, {})).emitted, "");
  assert.deepEqual((await toVercelRedirects({ rules: [literal], oracle: registry, reservedSegments }, {})).emitted, { redirects: [] });
});

test("required reserved segments are host policy on resolver, SPA and exporter, with no admin-only default", async () => {
  const { oracle } = origin();
  const literal = rule({ matchType: "exact", fromPattern: "/old", toTarget: "/private" });
  for (const reservePrivate of [false, true]) {
    const hostReserved = new Set(reservePrivate ? ["private"] : []);
    const resolver = createRedirectResolver({ repo: new InMemoryRedirectRepo({ seed: [literal] }, {}), matcher: redirectMatcher, originRegistry: oracle, reservedSegments: hostReserved }, {});
    assert.equal((await resolver.resolve({ workspaceId, path: "/old", phase: "post_content" }, {})).matched, !reservePrivate);
    let navigated = false;
    const guard = createSpaRedirectGuard({ rules: [literal], oracle, reservedSegments: hostReserved, navigate: () => { navigated = true; } }, {});
    await guard({ request: { workspaceId, path: "/old", phase: "post_content" } }, {});
    assert.equal(navigated, !reservePrivate);
    assert.equal((await toNetlifyRedirects({ rules: [literal], oracle, reservedSegments: hostReserved }, {})).emitted.length > 0, !reservePrivate);
    assert.equal((await toVercelRedirects({ rules: [literal], oracle, reservedSegments: hostReserved }, {})).emitted.redirects.length > 0, !reservePrivate);
  }
});

test("Express forwards resolver failure and missing host context without emitting a Location", async () => {
  const failure = new Error("repo unavailable");
  const resolver = { resolve: async () => { throw failure; }, resolveWithRefusals: async () => { throw failure; } };
  const middleware = createRedirectMiddleware({ resolver }, {});
  const forwarded: unknown[] = [];
  const sent: unknown[] = [];
  const response = { locals: { redirectContext: { workspaceId } }, redirect: (...args: unknown[]) => { sent.push(args); } };
  const next = ((error?: unknown) => forwarded.push(error)) as NextFunction;
  assert.deepEqual(await middleware({ path: "/old" } as Request, response as unknown as Response, next), { error: failure });
  assert.equal(forwarded[0], failure);
  const missing = await middleware({ path: "/old" } as Request, { ...response, locals: {} } as unknown as Response, next);
  assert.ok("error" in missing && missing.error instanceof RedirectMiddlewareContextError);
  assert.deepEqual(sent, []);
});
