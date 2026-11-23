import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";

import { RedirectPhaseHandlerResolver } from "../../resolver.js";
import { registerRedirectsPhaseHandlers } from "../phase-handler.js";
import { redirectMatcher } from "../../matcher.js";
import { InMemoryRedirectRepo } from "../../repo.memory.js";
import {
  createVerifiedOrigin,
  InMemoryOriginSettingRepo,
  OriginRegistry,
} from "@jini-ai/core/contracts/server/verified-origin";
import { type RouteResolveContext, type Routing } from "../../../routing/index.js";
import { createTestRouting } from "./routing.fixture.js";

/**
 * @file t91 F4.2 Part A (2026-09-16): `registerRedirectsPhaseHandlers`'s disposer used to call
 * `unregisterResolvePhaseOwner(REDIRECTS_PHASE_OWNER)`, which is OWNER-WIDE, not scoped to the
 * registration that returned it. A stale composition's disposer, called after a newer composition
 * had already superseded it (boot B, then tear down A), revoked B's live redirects — a silent
 * outage the identity-scoped fix below closes. The disposer now returns the two underlying
 * `registerResolvePhase` disposers, each of which removes exactly the registration it closed over
 * and is a no-op once superseded (`routing.ts`'s own guarantee).
 *
 * Moved from the host: the host's bound routing singleton is replaced by one real `createRouting`
 * instance per test, injected as `registerResolvePhase` exactly as a host composition root does.
 */

const ctx: RouteResolveContext = { workspaceId: "ws" };
/** First path segments the composing host reserves; any non-empty set exercises the same path. */
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(["admin", "api"]);

function resolverFor(location: string): { resolve(): Promise<unknown> } {
  return {
    async resolve() {
      return { matched: true, redirectId: "00000000-0000-4000-8000-0000000000aa", location, statusCode: 301 };
    },
  };
}

/** The one workspace origin the oracle trusts, so a same-origin relative target may resolve. */
function trustedOriginRegistry(at: string): OriginRegistry {
  return new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [{
    workspaceId: "ws", origin: createVerifiedOrigin({ scheme: "https", host: "trusted.example", verifiedAt: at, source: "workspace-setting" }),
    redirectAllowlist: [],
  }] }) });
}

let routing: Routing;
beforeEach(() => { routing = createTestRouting().routing; });

test("a superseded composition's disposer does not revoke the newer composition's redirects", async () => {
  const { registerResolvePhase } = routing;
  const disposeA = registerRedirectsPhaseHandlers({ resolver: resolverFor("/from-a") as never, registerResolvePhase });
  registerRedirectsPhaseHandlers({ resolver: resolverFor("/from-b") as never, registerResolvePhase });

  disposeA();

  const expected = { kind: "redirect", location: "/from-b", statusCode: 301 };
  assert.deepEqual(
    await routing.runPreContentPhase({ path: "/x", ctx: ctx }),
    expected,
    "the superseded (A) disposer must not revoke B's live registration"
  );
  assert.deepEqual(
    await routing.runPostContentPhase({ path: "/x", ctx: ctx }),
    expected,
    "the superseded (A) disposer must not revoke B's live registration"
  );
});

test("the live composition's disposer still revokes it, idempotently", async () => {
  const disposeB = registerRedirectsPhaseHandlers({ resolver: resolverFor("/from-b") as never, registerResolvePhase: routing.registerResolvePhase });

  disposeB();
  disposeB();

  assert.equal(await routing.runPreContentPhase({ path: "/x", ctx: ctx }), null, "disposing the live registration must revoke it");
  assert.equal(await routing.runPostContentPhase({ path: "/x", ctx: ctx }), null, "disposing the live registration must revoke it");
});

test("registered phases forward the request context and reserve pre-content for override rules", async () => {
  const at = "2026-09-01T00:00:00.000Z";
  const repo = new InMemoryRedirectRepo({ seed: [false, true].map((override) => ({
    id: `rule-${override}`, workspaceId: "ws", matchType: "exact" as const,
    fromPattern: override ? "/override" : "/ordinary", toTarget: "/destination",
    statusCode: 302 as const, status: "active" as const, override, priority: 0,
    source: "manual" as const, createdByPrincipal: "owner", createdAt: at, updatedAt: at, version: 1,
  })) }, {});
  const real = new RedirectPhaseHandlerResolver({ reservedSegments: RESERVED_SEGMENTS, repo, matcher: redirectMatcher,
    originRegistry: trustedOriginRegistry(at),
  });
  const requests: Parameters<typeof real.resolve>[0][] = [];
  registerRedirectsPhaseHandlers({ registerResolvePhase: routing.registerResolvePhase, resolver: { resolve: async (request) => {
    requests.push(request);
    return real.resolve(request);
  } } });
  const redirect = { kind: "redirect", location: "/destination", statusCode: 302 };
  assert.equal(await routing.runPreContentPhase({ path: "/ordinary", ctx: ctx }), null);
  assert.deepEqual(await routing.runPostContentPhase({ path: "/ordinary", ctx: ctx }), redirect);
  assert.deepEqual(await routing.runPreContentPhase({ path: "/override", ctx: ctx }), redirect);
  assert.deepEqual(await routing.runPostContentPhase({ path: "/override", ctx: ctx }), redirect);
  assert.equal(await routing.runPostContentPhase({ path: "/ordinary", ctx: { workspaceId: "other-ws" } }), null);
  assert.deepEqual(requests, [
    { workspaceId: "ws", path: "/ordinary", phase: "pre_content" },
    { workspaceId: "ws", path: "/ordinary", phase: "post_content" },
    { workspaceId: "ws", path: "/override", phase: "pre_content" },
    { workspaceId: "ws", path: "/override", phase: "post_content" },
    { workspaceId: "other-ws", path: "/ordinary", phase: "post_content" },
  ]);
});

test("the product-ports form builds its own resolver and registers it into the injected routing instance", async () => {
  const at = "2026-09-01T00:00:00.000Z";
  const repo = new InMemoryRedirectRepo({ seed: [{
    id: "rule-ports", workspaceId: "ws", matchType: "exact" as const, fromPattern: "/old", toTarget: "/new",
    statusCode: 301 as const, status: "active" as const, override: false, priority: 0,
    source: "manual" as const, createdByPrincipal: "owner", createdAt: at, updatedAt: at, version: 1,
  }] }, {});
  const originRegistry = trustedOriginRegistry(at);
  const other = createTestRouting().routing;
  registerRedirectsPhaseHandlers({ repo, matcher: redirectMatcher, originRegistry, reservedSegments: RESERVED_SEGMENTS, registerResolvePhase: routing.registerResolvePhase });

  assert.deepEqual(await routing.runPostContentPhase({ path: "/old", ctx: ctx }), { kind: "redirect", location: "/new", statusCode: 301 });
  assert.equal(await other.runPostContentPhase({ path: "/old", ctx: ctx }), null, "only the injected instance may receive the registration");
});

test("a newer composition's registration supersedes the older one in both phases without any disposer", async () => {
  const { registerResolvePhase } = routing;
  registerRedirectsPhaseHandlers({ resolver: resolverFor("/from-a") as never, registerResolvePhase });
  registerRedirectsPhaseHandlers({ resolver: resolverFor("/from-b") as never, registerResolvePhase });

  const expected = { kind: "redirect", location: "/from-b", statusCode: 301 };
  assert.deepEqual(await routing.runPreContentPhase({ path: "/x", ctx: ctx }), expected, "the owner slot must hold only the newest registration");
  assert.deepEqual(await routing.runPostContentPhase({ path: "/x", ctx: ctx }), expected, "the owner slot must hold only the newest registration");
});
