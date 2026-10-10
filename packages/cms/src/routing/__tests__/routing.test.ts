import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPostRepo, buildPostRecord } from "./support.fixture.js";
import type { RouteResolveContext, RouteResolvePhaseHandler, RouteTarget, SlugChangeCapture } from "../types.js";
import { createTestRouting } from './support.fixture.js';
import { RouteResolutionError } from '../index.js';
const { entryPublicPath, getNamedRoute, getSlugChangeCapture, isActive, registerNamedRoute, registerResolvePhase, registerSlugChangeCapture, resetRoutingRegistrationsForTests, resolve, urlFor } = createTestRouting();


const seedPost = buildPostRecord({
  id: "post-1",
  workspaceId: "workspace-1",
  title: "Hello World",
  slug: "hello-world",
  bodyJson: { type: "doc", content: [] },
  status: "published" as const,
  updatedAt: "2026-04-06T00:00:00.000Z",
  version: 1,
});

const ctx: RouteResolveContext = { workspaceId: "workspace-1" };

// ---------------------------------------------------------------------------
// urlFor — entryRef
// ---------------------------------------------------------------------------

test("urlFor resolves an entryRef target to a published post's slug path", async () => {
  const repo = new InMemoryPostRepo([seedPost]);
  const target: RouteTarget = { kind: "entryRef", entryId: "post-1" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.deepEqual(result, { path: "/hello-world", canonicalUrl: "/hello-world" });
});

test("urlFor composes canonicalUrl from originOverride when present", async () => {
  const repo = new InMemoryPostRepo([seedPost]);
  const target: RouteTarget = { kind: "entryRef", entryId: "post-1" };
  const ctxWithOrigin: RouteResolveContext = {
    workspaceId: "workspace-1",
    originOverride: "https://example.com/",
  };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx: ctxWithOrigin });

  assert.deepEqual(result, {
    path: "/hello-world",
    canonicalUrl: "https://example.com/hello-world",
  });
});

test("urlFor returns null for an entryRef target that does not exist", async () => {
  const repo = new InMemoryPostRepo([seedPost]);
  const target: RouteTarget = { kind: "entryRef", entryId: "missing-post" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.equal(result, null);
});

test("urlFor returns null for an entryRef target that is a draft", async () => {
  const repo = new InMemoryPostRepo([{ ...seedPost, status: "draft" }]);
  const target: RouteTarget = { kind: "entryRef", entryId: "post-1" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.equal(result, null);
});

// 2026-09-05 fix: `softDelete` (post.ts) stamps only `deletedAt`/`updatedAt`/`version` — it never
// clears `status`, so a post that was `published` when trashed stays `status: "published"` forever.
// `postRepo.findById` is documented trash-BLIND (post.ts's `PostRecord.deletedAt` doc), so
// `resolveEntryRefTarget` gets the trashed row back and must not treat its stale `status` as live.
// Same defect pattern as caa116115c103630ba5253f9bbe3bceb234347d8 (sitemap.xml/llms.txt) and
// a5c9bac8 (media rendition gating).
test("urlFor returns null for an entryRef target that is trashed, even though status still reads 'published'", async () => {
  const repo = new InMemoryPostRepo([{ ...seedPost, deletedAt: "2026-09-05T00:00:00.000Z" }]);
  const target: RouteTarget = { kind: "entryRef", entryId: "post-1" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// entryPublicPath — pure per-record half of entryRef resolution (H3: exported so a caller already
// holding a PostRecord, e.g. content_post_list, can resolve publicUrl with no postRepo.findById)
// ---------------------------------------------------------------------------

test("entryPublicPath resolves a published record to its slug path with no repo call", () => {
  const result = entryPublicPath({ post: seedPost, ctx: ctx });

  assert.deepEqual(result, { path: "/hello-world", canonicalUrl: "/hello-world" });
});

// Content-owned homepage (SPEC-0XX) — a `kind: "page"` row may claim the literal "/" slug
// (`post.ts`'s `ROOT_SLUG`). A naive `/${slug}` template would double this up into "//"; this
// asserts the shared `postPublicPath` helper `entryPublicPath` now routes through avoids that.
test("entryPublicPath resolves a published record with slug '/' to path '/', never '//'", () => {
  const rootPage = { ...seedPost, slug: "/", kind: "page" as const };

  const result = entryPublicPath({ post: rootPage, ctx: ctx });

  assert.deepEqual(result, { path: "/", canonicalUrl: "/" });
});

test("entryPublicPath returns null for a draft record", () => {
  const result = entryPublicPath({ post: { ...seedPost, status: "draft" }, ctx: ctx });

  assert.equal(result, null);
});

// 2026-09-05 fix: same trash-blindness gap as `urlFor`'s equivalent test above, but exercised
// directly against the pure per-record half — a caller that already holds a trashed record (e.g.
// `content_post_list` iterating a prior `postRepo.list()` fetch) must not get a live path back either.
test("entryPublicPath returns null for a trashed record, even though status still reads 'published'", () => {
  const result = entryPublicPath({ post: { ...seedPost, deletedAt: "2026-09-05T00:00:00.000Z" }, ctx: ctx });

  assert.equal(result, null);
});

test("entryPublicPath composes canonicalUrl from originOverride, same as urlFor", () => {
  const ctxWithOrigin: RouteResolveContext = { workspaceId: "workspace-1", originOverride: "https://example.com/" };

  const result = entryPublicPath({ post: seedPost, ctx: ctxWithOrigin });

  assert.deepEqual(result, { path: "/hello-world", canonicalUrl: "https://example.com/hello-world" });
});

test("entryPublicPath agrees with urlFor's entryRef resolution for the same record (no drift)", async () => {
  const repo = new InMemoryPostRepo([seedPost]);
  const target: RouteTarget = { kind: "entryRef", entryId: "post-1" };

  const viaUrlFor = await urlFor({ deps: { postRepo: repo }, target, ctx });
  const viaEntryPublicPath = entryPublicPath({ post: seedPost, ctx: ctx });

  assert.deepEqual(viaEntryPublicPath, viaUrlFor);
});

// ---------------------------------------------------------------------------
// urlFor — termRef (documented stub)
// ---------------------------------------------------------------------------

test("urlFor always returns null for termRef targets (taxonomy not implemented)", async () => {
  const repo = new InMemoryPostRepo([seedPost]);
  const target: RouteTarget = { kind: "termRef", termId: "term-1", taxonomy: "category" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// urlFor — url
// ---------------------------------------------------------------------------

test("urlFor passes an absolute url target through as-is", async () => {
  const repo = new InMemoryPostRepo([]);
  const target: RouteTarget = { kind: "url", href: "https://external.example/path" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.deepEqual(result, {
    path: "https://external.example/path",
    canonicalUrl: "https://external.example/path",
  });
});

for (const href of ["https://external.example/path", "//cdn.example/x"]) {
  test(`urlFor preserves ${href} even with an originOverride`, async () => {
    const result = await urlFor({
      deps: { postRepo: new InMemoryPostRepo([]) },
      target: { kind: "url", href },
      ctx: { ...ctx, originOverride: "https://example.com/" },
    });
    assert.deepEqual(result, { path: href, canonicalUrl: href });
  });
}

test("urlFor rejects a javascript: scheme url target", async () => {
  const repo = new InMemoryPostRepo([]);
  const target: RouteTarget = { kind: "url", href: "javascript:alert(1)" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.equal(result, null);
});

test("urlFor rejects a data: scheme url target", async () => {
  const repo = new InMemoryPostRepo([]);
  const target: RouteTarget = { kind: "url", href: "data:text/html,<script>1</script>" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.equal(result, null);
});

for (const href of [
  "JavaScript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "\tJavaScript:alert(1)",
  "DaTa:text/html,<script>1</script>", "DATA:text/html,<script>1</script>",
  " data:text/html,<script>1</script>", "\tDaTa:text/html,<script>1</script>",
]) {
  test(`urlFor rejects unsafe schemes after case and whitespace normalization: ${JSON.stringify(href)}`, async () => {
    const result = await urlFor({ deps: { postRepo: new InMemoryPostRepo([]) }, target: { kind: "url", href }, ctx });
    assert.equal(result, null);
  });
}

// ---------------------------------------------------------------------------
// urlFor — route (named-route registry)
// ---------------------------------------------------------------------------

test("urlFor resolves the default home route", async () => {
  resetRoutingRegistrationsForTests({});
  const repo = new InMemoryPostRepo([]);
  const target: RouteTarget = { kind: "route", route: "home" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.deepEqual(result, { path: "/", canonicalUrl: "/" });
});

test("urlFor returns null for an unregistered route name", async () => {
  resetRoutingRegistrationsForTests({});
  const repo = new InMemoryPostRepo([]);
  const target: RouteTarget = { kind: "route", route: "does-not-exist" };

  const result = await urlFor({ deps: { postRepo: repo }, target, ctx });

  assert.equal(result, null);
});

test("registerNamedRoute adds a new resolvable named route", async () => {
  resetRoutingRegistrationsForTests({});
  const repo = new InMemoryPostRepo([]);

  registerNamedRoute({ name: "archive", path: "/archive" });

  assert.equal(getNamedRoute({ name: "archive" }), "/archive");
  const result = await urlFor({
    deps: { postRepo: repo },
    target: { kind: "route", route: "archive" },
    ctx,
  });
  assert.deepEqual(result, { path: "/archive", canonicalUrl: "/archive" });
});

/** The `switch (target.kind)` exhaustiveness guard: unreachable through the typed `RouteTarget`
 *  union (that's what `const unreachable: never = target` proves at compile time), but a caller
 *  who bypasses the type system -- a malformed request body, a stale client, a future target kind
 *  this library doesn't know about yet -- can still reach it at runtime. The cast is deliberate:
 *  this is the one target this test exists to construct. */
test("urlFor throws RouteResolutionError for a target kind outside the known union", async () => {
  const repo = new InMemoryPostRepo([]);
  const bogusTarget = { kind: "bogus" } as unknown as RouteTarget;

  await assert.rejects(
    () => urlFor({ deps: { postRepo: repo }, target: bogusTarget, ctx }),
    (err: unknown) => {
      assert.ok(err instanceof RouteResolutionError);
      assert.equal(err.message, `unrecognized route target kind: ${JSON.stringify(bogusTarget)}`);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// isActive
// ---------------------------------------------------------------------------

test("isActive is true when the resolved target matches the current path", async () => {
  const repo = new InMemoryPostRepo([seedPost]);
  const target: RouteTarget = { kind: "entryRef", entryId: "post-1" };

  const active = await isActive({ deps: { postRepo: repo }, target, currentPath: "/hello-world", ctx });

  assert.equal(active, true);
});

test("isActive normalizes trailing slash and query string before comparing", async () => {
  const repo = new InMemoryPostRepo([seedPost]);
  const target: RouteTarget = { kind: "entryRef", entryId: "post-1" };

  const active = await isActive({
    deps: { postRepo: repo },
    target,
    currentPath: "/hello-world/?ref=nav",
    ctx,
  });

  assert.equal(active, true);
});

test("isActive is false when the resolved target does not match the current path", async () => {
  const repo = new InMemoryPostRepo([seedPost]);
  const target: RouteTarget = { kind: "entryRef", entryId: "post-1" };

  const active = await isActive({ deps: { postRepo: repo }, target, currentPath: "/other", ctx });

  assert.equal(active, false);
});

test("isActive is false when the target is unavailable", async () => {
  const repo = new InMemoryPostRepo([]);
  const target: RouteTarget = { kind: "entryRef", entryId: "missing-post" };

  const active = await isActive({
    deps: { postRepo: repo },
    target,
    currentPath: "/anything",
    ctx,
  });

  assert.equal(active, false);
});

// ---------------------------------------------------------------------------
// resolve() — forward resolution pipeline registration seam
// ---------------------------------------------------------------------------

test("resolve falls through to matched:false (404) when no phase handler matches", async () => {
  resetRoutingRegistrationsForTests({});

  const result = await resolve({ input: { path: "/nothing-registered", ctx } });

  assert.deepEqual(result, { matched: false });
});

test("resolve short-circuits on the first matching pre_content handler and skips post_content", async () => {
  resetRoutingRegistrationsForTests({});
  let postContentCalled = false;

  const preHandler: RouteResolvePhaseHandler = async (path) => {
    if (path === "/retired") {
      return { kind: "redirect", location: "/new-home", statusCode: 301 };
    }
    return null;
  };
  const postHandler: RouteResolvePhaseHandler = async () => {
    postContentCalled = true;
    return null;
  };

  registerResolvePhase({ phase: "pre_content", resolver: preHandler });
  registerResolvePhase({ phase: "post_content", resolver: postHandler });

  const result = await resolve({ input: { path: "/retired", ctx } });

  assert.deepEqual(result, {
    matched: true,
    phase: "pre_content",
    outcome: { kind: "redirect", location: "/new-home", statusCode: 301 },
  });
  assert.equal(postContentCalled, false);
});

test("resolve falls through pre_content to post_content when pre_content has no match", async () => {
  resetRoutingRegistrationsForTests({});

  registerResolvePhase({ phase: "pre_content", resolver: async () => null });
  registerResolvePhase({ phase: "post_content", resolver: async (path) => {
    if (path === "/old-slug") {
      return { kind: "redirect", location: "/moved", statusCode: 301 };
    }
    return null;
  } });

  const result = await resolve({ input: { path: "/old-slug", ctx } });

  assert.deepEqual(result, {
    matched: true,
    phase: "post_content",
    outcome: { kind: "redirect", location: "/moved", statusCode: 301 },
  });
});

test("resolve runs handlers within a phase in registration order (first non-null wins)", async () => {
  resetRoutingRegistrationsForTests({});
  const callOrder: string[] = [];

  registerResolvePhase({ phase: "post_content", resolver: async () => {
    callOrder.push("first");
    return null;
  } });
  registerResolvePhase({ phase: "post_content", resolver: async () => {
    callOrder.push("second");
    return { kind: "not_found" };
  } });
  registerResolvePhase({ phase: "post_content", resolver: async () => {
    callOrder.push("third");
    return null;
  } });

  const result = await resolve({ input: { path: "/anything", ctx } });

  assert.deepEqual(callOrder, ["first", "second"]);
  assert.deepEqual(result, { matched: true, phase: "post_content", outcome: { kind: "not_found" } });
});

test("resolve normalizes the request path before running phase handlers", async () => {
  resetRoutingRegistrationsForTests({});
  let seenPath: string | null = null;

  registerResolvePhase({ phase: "post_content", resolver: async (path) => {
    seenPath = path;
    return null;
  } });

  await resolve({ input: { path: "/some/path/?x=1", ctx } });

  assert.equal(seenPath, "/some/path");
});

test("resolve prepends a leading slash to a request path that arrives without one", async () => {
  resetRoutingRegistrationsForTests({});
  let seenPath: string | null = null;

  registerResolvePhase({ phase: "post_content", resolver: async (path) => {
    seenPath = path;
    return null;
  } });

  // Real HTTP frameworks always hand `path` a leading slash, but this library's own contract
  // (`normalizePath`) doesn't assume its caller does -- a directly-constructed `ResolveInput`,
  // like a redirect rule replaying a stored path, is not guaranteed to.
  await resolve({ input: { path: "some/path", ctx } });

  assert.equal(seenPath, "/some/path");
});

// ---------------------------------------------------------------------------
// SlugChangeCapture slot
// ---------------------------------------------------------------------------

test("getSlugChangeCapture is undefined when nothing is bound", () => {
  resetRoutingRegistrationsForTests({});

  assert.equal(getSlugChangeCapture({}), undefined);
});

test("registerSlugChangeCapture binds the implementation getSlugChangeCapture returns", async () => {
  resetRoutingRegistrationsForTests({});
  const calls: unknown[] = [];

  const impl: SlugChangeCapture = {
    onSlugChange: async (input) => {
      calls.push(input);
    },
  };
  registerSlugChangeCapture({ impl: impl });

  const capture = getSlugChangeCapture({});
  assert.ok(capture);
  assert.equal(capture, impl);
  const input = {
    workspaceId: "workspace-1",
    entryId: "post-1",
    oldPath: "/old",
    newPath: "/new",
    actor: "user-1",
    changeSetId: "cs-1",
  };
  await capture.onSlugChange(input);

  assert.equal(calls.length, 1);
  assert.deepEqual<unknown[]>(calls, [input]);
  const replacement: SlugChangeCapture = { onSlugChange: async (next) => { calls.push(next); } };
  registerSlugChangeCapture({ impl: replacement });
  assert.equal(getSlugChangeCapture({}), replacement);
});

test("registerSlugChangeCapture's disposer unbinds only its own registration", () => {
  resetRoutingRegistrationsForTests({});
  const stale: SlugChangeCapture = { onSlugChange: async () => {} };
  const current: SlugChangeCapture = { onSlugChange: async () => {} };

  const disposeStale = registerSlugChangeCapture({ impl: stale });
  const disposeCurrent = registerSlugChangeCapture({ impl: current });
  // A superseded site torn down after the newer one bound must leave the newer capture in place.
  disposeStale();
  assert.equal(getSlugChangeCapture({}), current);

  disposeCurrent();
  assert.equal(getSlugChangeCapture({}), undefined);
});
