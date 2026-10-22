import assert from "node:assert/strict";
import { test } from "vitest";

import type { RouteResolveContext, RouteResolvePhaseHandler } from "../types.js";
import { createTestRouting } from './support.fixture.js';
const { registerResolvePhase, resetRoutingRegistrationsForTests, resolve, runPostContentPhase, runPreContentPhase } = createTestRouting();

/**
 * @file T011 (C-012, C-013, ADR-PIPE-009 Decision B) — the additive
 * `runPreContentPhase`/`runPostContentPhase` exports that let a caller
 * interleave its own content lookup between the two phases, something
 * `resolve()`'s bundled v0 shape cannot express. `resolve()` itself must
 * remain completely unchanged (its own `routing.test.ts` suite is asserted
 * green, unmodified, by T024 — this file only adds NEW tests).
 */

const ctx: RouteResolveContext = { workspaceId: "workspace-1" };

test("runPreContentPhase returns the same outcome resolve() would for a matching pre_content handler", async () => {
  resetRoutingRegistrationsForTests({});
  registerResolvePhase({ phase: "pre_content", resolver: async (path) => {
    if (path === "/retired") return { kind: "redirect", location: "/new-home", statusCode: 301 };
    return null;
  } });

  const outcome = await runPreContentPhase({ path: "/retired", ctx: ctx });

  assert.deepEqual(outcome, { kind: "redirect", location: "/new-home", statusCode: 301 });
});

test("runPreContentPhase returns null when no pre_content handler matches", async () => {
  resetRoutingRegistrationsForTests({});
  registerResolvePhase({ phase: "pre_content", resolver: async () => null });

  const outcome = await runPreContentPhase({ path: "/anything", ctx: ctx });

  assert.equal(outcome, null);
});

test("calling runPreContentPhase alone does NOT also run post_content", async () => {
  resetRoutingRegistrationsForTests({});
  let postContentCalled = false;
  registerResolvePhase({ phase: "pre_content", resolver: async () => null });
  const postHandler: RouteResolvePhaseHandler = async () => {
    postContentCalled = true;
    return { kind: "not_found" };
  };
  registerResolvePhase({ phase: "post_content", resolver: postHandler });

  const outcome = await runPreContentPhase({ path: "/anything", ctx: ctx });

  assert.equal(outcome, null);
  assert.equal(postContentCalled, false, "runPreContentPhase must never run post_content handlers");
});

test("runPostContentPhase returns the same outcome resolve() would for a matching post_content handler", async () => {
  resetRoutingRegistrationsForTests({});
  registerResolvePhase({ phase: "post_content", resolver: async (path) => {
    if (path === "/old-slug") return { kind: "redirect", location: "/moved", statusCode: 301 };
    return null;
  } });

  const outcome = await runPostContentPhase({ path: "/old-slug", ctx: ctx });

  assert.deepEqual(outcome, { kind: "redirect", location: "/moved", statusCode: 301 });
});

test("runPostContentPhase returns null when no post_content handler matches", async () => {
  resetRoutingRegistrationsForTests({});
  registerResolvePhase({ phase: "post_content", resolver: async () => null });

  const outcome = await runPostContentPhase({ path: "/anything", ctx: ctx });

  assert.equal(outcome, null);
});

test("runPostContentPhase normalizes the path the same way resolve() does", async () => {
  resetRoutingRegistrationsForTests({});
  let seenPath: string | null = null;
  registerResolvePhase({ phase: "post_content", resolver: async (path) => {
    seenPath = path;
    return null;
  } });

  await runPostContentPhase({ path: "/some/path/?x=1", ctx: ctx });

  assert.equal(seenPath, "/some/path");
});

test("the existing routing.test.ts suite's resolve() behavior is unaffected by the new exports", async () => {
  resetRoutingRegistrationsForTests({});
  registerResolvePhase({ phase: "pre_content", resolver: async () => null });
  registerResolvePhase({ phase: "post_content", resolver: async (path) => {
    if (path === "/old-slug") return { kind: "redirect", location: "/moved", statusCode: 301 };
    return null;
  } });

  const result = await resolve({ input: { path: "/old-slug", ctx } });

  assert.deepEqual(result, {
    matched: true,
    phase: "post_content",
    outcome: { kind: "redirect", location: "/moved", statusCode: 301 },
  });
});

test("runPreContentPhase normalizes a trailing slash and query before matching", async () => {
  resetRoutingRegistrationsForTests({});
  const seen: string[] = [];
  registerResolvePhase({ phase: "pre_content", resolver: async (path) => {
    seen.push(path);
    return path === "/retired" ? { kind: "redirect", location: "/new-home", statusCode: 301 } : null;
  } });
  assert.deepEqual(await runPreContentPhase({ path: "/retired/?x=1", ctx: ctx }), { kind: "redirect", location: "/new-home", statusCode: 301 });
  assert.deepEqual(seen, ["/retired"]);
});

for (const phase of ["pre_content", "post_content"] as const) {
  test(`${phase} forwards complete context through standalone and bundled resolution`, async () => {
    resetRoutingRegistrationsForTests({});
    const contexts: RouteResolveContext[] = [
      { workspaceId: "workspace-a", siteId: "site-a", locale: "fr", originKey: "origin-a", originOverride: "https://a.example/" },
      { workspaceId: "workspace-b", siteId: "site-b", locale: "de", originKey: "origin-b", originOverride: "https://b.example/" },
    ];
    const seen: RouteResolveContext[] = [];
    registerResolvePhase({ phase: phase, resolver: async (_path, forwarded) => {
      seen.push(forwarded);
      return { kind: "redirect", location: `/${forwarded.workspaceId}/${forwarded.locale}`, statusCode: 302 };
    } });
    for (const context of contexts) {
      const outcome = { kind: "redirect", location: `/${context.workspaceId}/${context.locale}`, statusCode: 302 };
      const run = phase === "pre_content" ? runPreContentPhase : runPostContentPhase;
      assert.deepEqual(await run({ path: "/retired", ctx: context }), outcome);
      assert.deepEqual(await resolve({ input: { path: "/retired", ctx: context } }), { matched: true, phase, outcome });
    }
    assert.deepEqual(seen, [contexts[0], contexts[0], contexts[1], contexts[1]]);
  });
}
