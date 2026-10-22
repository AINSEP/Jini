import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "vitest";

import { createTestRouting } from './support.fixture.js';
const { registerResolvePhase, resetRoutingRegistrationsForTests, runPostContentPhase, runPreContentPhase, unregisterResolvePhaseOwner } = createTestRouting();
import type { RouteResolveContext } from "../types.js";

/**
 * @file The phase registry's LIFECYCLE contract (2026-09-16) — the half `routing.test.ts` and
 * `routing.phase-runners.test.ts` never covered, because both only ever ask what a registered
 * handler resolves to, never what happens to a handler whose registrant is gone.
 *
 * `phaseRegistry` is module-level and so process-wide, but its registrants are not: a composition
 * root registers a handler that has closed over THAT composition's resources, and a process can run
 * more than one composition (an integration test composes one per site it boots; loading
 * `composition/app.ts` itself registers nothing — see t91 F4.1). Append-only, every superseded
 * composition's closure stayed on the live request path forever. The concrete production-shaped
 * failure that produced these tests: a site's `SqliteRedirectRepo` handler outliving that site's
 * database, so a later request threw `TypeError: The database connection is not open` out of the
 * phase and 500ed `/` and `/pricing` — while `/products`, which runs no phase at all, kept serving
 * and made it look like a render bug.
 *
 * Two independent guarantees are pinned here, deliberately not one:
 *   1. OWNERSHIP — an owned registration supersedes that owner's previous one, and can be revoked
 *      outright, so the stale handler is not merely harmless but absent.
 *   2. ISOLATION is opt-in (`onError: "skip"`); the default propagates. A `"skip"` handler that
 *      throws is skipped, not propagated, so ONE registrant's fault can never take down an unrelated
 *      route — but only for a registrant that opted in, because it knows its own failure can only
 *      DECLINE an outcome. A handler with no `onError` (or an explicit `"fail"`) rethrows instead, so
 *      the caller's own error handling runs — see t91 F4.3, and
 *      `site-phase-handler-fail-policy.test.ts` for the route-level 500 that default produces.
 */

const ctx: RouteResolveContext = { workspaceId: "ws-lifecycle" };

beforeEach(() => resetRoutingRegistrationsForTests({}));
afterEach(() => resetRoutingRegistrationsForTests({}));

test("an owned registration REPLACES that owner's previous handlers rather than appending", async () => {
  const owner = Symbol("owner");
  let staleRan = false;

  registerResolvePhase({ phase: "pre_content", resolver: async () => {
      staleRan = true;
      return { kind: "redirect", location: "/from-the-stale-handler", statusCode: 301 };
    } }, { owner });
  registerResolvePhase({ phase: "pre_content", resolver: async () => null }, { owner });

  const outcome = await runPreContentPhase({ path: "/anything", ctx: ctx });
  assert.equal(outcome, null, "only the most recent registration for this owner may run");
  assert.equal(staleRan, false, "the superseded handler must not be on the request path at all");
});

test("superseding is per-owner: a different owner's registration is untouched", async () => {
  const replaced = Symbol("replaced");
  const other = Symbol("other");
  let otherRan = false;

  registerResolvePhase({ phase: "pre_content", resolver: async () => null }, { owner: replaced });
  registerResolvePhase({ phase: "pre_content", resolver: async () => {
      otherRan = true;
      return null;
    } }, { owner: other });
  registerResolvePhase({ phase: "pre_content", resolver: async () => null }, { owner: replaced });

  await runPreContentPhase({ path: "/anything", ctx: ctx });
  assert.equal(otherRan, true, "replacing one owner's registration must not evict another's");
});

test("superseding is per-phase-and-owner: re-registering pre_content leaves the same owner's post_content handler alone", async () => {
  const owner = Symbol("owner");
  let postRan = false;

  registerResolvePhase({ phase: "pre_content", resolver: async () => null }, { owner });
  registerResolvePhase({ phase: "post_content", resolver: async () => {
      postRan = true;
      return null;
    } }, { owner });
  registerResolvePhase({ phase: "pre_content", resolver: async () => null }, { owner });

  await runPostContentPhase({ path: "/anything", ctx: ctx });
  assert.equal(postRan, true, "a pre_content re-registration must not evict this owner's post_content handler");
});

test("unregisterResolvePhaseOwner revokes that owner's handlers in EVERY phase", async () => {
  const owner = Symbol("owner");
  const seen: string[] = [];

  registerResolvePhase({ phase: "pre_content", resolver: async () => {
      seen.push("pre");
      return null;
    } }, { owner });
  registerResolvePhase({ phase: "post_content", resolver: async () => {
      seen.push("post");
      return null;
    } }, { owner });

  const other = Symbol("surviving-owner");
  registerResolvePhase({ phase: "pre_content", resolver: async () => ({ kind: "redirect", location: "/other-pre", statusCode: 301 }) }, { owner: other });
  registerResolvePhase({ phase: "post_content", resolver: async () => ({ kind: "redirect", location: "/other-post", statusCode: 302 }) }, { owner: other });

  unregisterResolvePhaseOwner({ owner: owner });

  assert.deepEqual(await runPreContentPhase({ path: "/anything", ctx: ctx }), { kind: "redirect", location: "/other-pre", statusCode: 301 });
  assert.deepEqual(await runPostContentPhase({ path: "/anything", ctx: ctx }), { kind: "redirect", location: "/other-post", statusCode: 302 });
  await runPreContentPhase({ path: "/anything", ctx: ctx });
  await runPostContentPhase({ path: "/anything", ctx: ctx });
  assert.deepEqual(seen, [], "a revoked owner must run in neither phase");
});

test("unregisterResolvePhaseOwner(undefined) is a no-op — `undefined` is the no-owner marker, not an owner", async () => {
  let unownedRan = false;
  registerResolvePhase({ phase: "pre_content", resolver: async () => {
    unownedRan = true;
    return null;
  } });

  unregisterResolvePhaseOwner({ owner: undefined });

  await runPreContentPhase({ path: "/anything", ctx: ctx });
  assert.equal(unownedRan, true, "revoking `undefined` must not sweep away every unowned registration");
});

test("registerResolvePhase returns a disposer that removes exactly its own registration", async () => {
  const seen: string[] = [];
  const disposeFirst = registerResolvePhase({ phase: "pre_content", resolver: async () => {
    seen.push("first");
    return null;
  } });
  registerResolvePhase({ phase: "pre_content", resolver: async () => {
    seen.push("second");
    return null;
  } });

  disposeFirst();
  disposeFirst(); // idempotent — a second call must not remove the sibling too.

  await runPreContentPhase({ path: "/anything", ctx: ctx });
  assert.deepEqual(seen, ["second"], "only the disposed registration may be removed");
});

test("a skip handler that THROWS is skipped, and the phase's remaining handlers still run", async () => {
  let laterRan = false;
  registerResolvePhase({ phase: "pre_content", resolver: async () => {
      throw new TypeError("The database connection is not open");
    } }, { onError: "skip" });
  registerResolvePhase({ phase: "pre_content", resolver: async () => {
      laterRan = true;
      return { kind: "redirect", location: "/still-resolved", statusCode: 301 };
    } }, { onError: "skip" });

  const outcome = await runPreContentPhase({ path: "/anything", ctx: ctx });
  assert.equal(laterRan, true, "a failing handler must not abort the chain");
  assert.deepEqual(outcome, { kind: "redirect", location: "/still-resolved", statusCode: 301 });
});

test("a phase whose ONLY skip handler throws resolves to null — the request falls through to content, it does not 500", async () => {
  registerResolvePhase({ phase: "post_content", resolver: async () => {
      throw new TypeError("The database connection is not open");
    } }, { onError: "skip" });

  // The exact shape `routes/site/pages.ts` depends on: no throw escapes the phase, so its own
  // outer catch never turns one registrant's fault into `<h1>Site error</h1>` for the whole route.
  const outcome = await runPostContentPhase({ path: "/anything", ctx: ctx });
  assert.equal(outcome, null);
});

test("a synchronously-throwing skip handler is isolated too, not just a rejected promise", async () => {
  let laterRan = false;
  registerResolvePhase({ phase: "pre_content", resolver: (() => {
      throw new Error("thrown before any promise exists");
    }) as never }, { onError: "skip" });
  registerResolvePhase({ phase: "pre_content", resolver: async () => {
      laterRan = true;
      return null;
    } }, { onError: "skip" });

  const outcome = await runPreContentPhase({ path: "/anything", ctx: ctx });
  assert.equal(laterRan, true, "a handler that throws before returning a promise must be isolated the same way");
  assert.equal(outcome, null);
});

test("a handler registered with no onError (default fail) that THROWS rejects the phase", async () => {
  let laterRan = false;
  registerResolvePhase({ phase: "pre_content", resolver: async () => {
    throw new Error("guard store down");
  } });
  registerResolvePhase({ phase: "pre_content", resolver: async () => {
    laterRan = true;
    return { kind: "redirect", location: "/from-the-later-handler", statusCode: 301 };
  } });

  await assert.rejects(runPreContentPhase({ path: "/x", ctx: ctx }), /guard store down/);
  assert.equal(laterRan, false, "a fail-policy throw must abort the phase before a later handler runs");
});

test("explicit onError: 'fail' on post_content rejects too (sync throw included)", async () => {
  registerResolvePhase({ phase: "post_content", resolver: (() => {
      throw new Error("guard store down, synchronously");
    }) as never }, { onError: "fail" });

  await assert.rejects(runPostContentPhase({ path: "/x", ctx: ctx }));
});
