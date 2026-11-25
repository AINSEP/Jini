import { describe, expect, it } from "vitest";
import { isRouteReply, ok, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { buildPostRecord } from "../../../../../seo/__tests__/support/post.fixture.js";
import { toContentPostResponse } from "../../../../http/content/posts.js";
import { contentPostGetRoute, type ContentPostGetRouteDeps } from "../get-by-slug.js";

/** @file `GET …/content/v1/workspaces/:workspaceId/posts/:slug`: a published post with its member gate. A gated
 * post is indistinguishable from a missing one, and the per-visitor answer is never shared-cacheable. */

const signal = new AbortController().signal;
const raw = (slug: string | undefined): RouteInputContext => ({ body: undefined, query: {}, params: { workspaceId: "ws-1", ...(slug === undefined ? {} : { slug }) }, headers: {} });
const post = (memberAccessJson: string | null = null) => ({ ...buildPostRecord({ id: "p-1", slug: "hello", title: "Hello" }), kind: "post", status: "published", memberAccessJson, deletedAt: null }) as never;
type Ctx = { member: string | null };

function deps(over: { row?: unknown; settings?: unknown; token?: string; allowed?: (args: { memberAccessJson: unknown; context: Ctx }) => boolean; calls?: unknown[] } = {}): ContentPostGetRouteDeps<Ctx> {
  const calls = over.calls ?? [];
  return {
    workspaceId: "ws-1",
    postRepo: { findBySlug: async (args: unknown) => { calls.push(["findBySlug", args]); return "row" in over ? over.row : post(); } } as never,
    presentationRepo: { findByWorkspaceId: async () => ("settings" in over ? over.settings : { workspaceId: "ws-1", activeThemeId: "theme-a" }) } as never,
    sessionToken: () => over.token,
    memberAccess: () => ({
      resolveContext: async (args) => { calls.push(["resolveContext", args]); return { member: args.sessionToken ?? null }; },
      decide: (args) => { calls.push(["decide", args]); return { allowed: (over.allowed ?? (() => true))(args) }; },
    }),
  };
}

async function call(d: ContentPostGetRouteDeps<Ctx>, slug: string | undefined = "hello") {
  const input = raw(slug);
  const parsed = contentPostGetRoute.parse(input) as { ok: true; value: unknown };
  return (contentPostGetRoute.handle as (r: unknown, o: unknown) => Promise<unknown>)({ input: parsed.value, deps: d, raw: input, context: undefined, authorize: async () => {} }, { signal });
}
async function refusal(promise: Promise<unknown>): Promise<RouteRefusalError> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(RouteRefusalError);
  return error as RouteRefusalError;
}

describe("contentPostGetRoute", () => {
  it("pins method and path", () => {
    expect(contentPostGetRoute.method).toBe("get");
    expect(contentPostGetRoute.path).toBe("/api/content/v1/workspaces/:workspaceId/posts/:slug");
  });

  it("answers an ungated post at 200 with private, no-store and the content payload", async () => {
    const result = await call(deps()) as { ok: true; value: unknown };
    expect(result.ok).toBe(true);
    expect(isRouteReply(result.value)).toBe(true);
    expect(result.value).toEqual({ status: 200, body: toContentPostResponse({ post: post(), activeThemeId: "theme-a" }), headers: { "Cache-Control": "private, no-store" } });
  });

  it("resolves the member context from the session token for this workspace, then decides on the post's own access JSON", async () => {
    const calls: unknown[] = [];
    await call(deps({ token: "tok", calls, row: post('{"tiers":["gold"]}') }));
    const resolve = calls.find((c) => (c as unknown[])[0] === "resolveContext") as [string, { workspaceId: string; sessionToken: string; nowIso: string }];
    expect(resolve[1]).toMatchObject({ workspaceId: "ws-1", sessionToken: "tok" });
    expect(Number.isNaN(Date.parse(resolve[1].nowIso))).toBe(false);
    expect(calls).toContainEqual(["decide", { memberAccessJson: '{"tiers":["gold"]}', context: { member: "tok" } }]);
    expect(calls).toContainEqual(["findBySlug", { workspaceId: "ws-1", slug: "hello" }]);
  });

  it("SECURITY: a gated post refused to an anonymous visitor is the same 404 as a missing slug, with no post content", async () => {
    const gated = await refusal(call(deps({ row: post('{"tiers":["gold"]}'), allowed: ({ context }) => context.member !== null })));
    const missing = await refusal(call(deps({ row: null })));
    expect(gated.response).toEqual({ status: 404, body: { error: "post 'hello' was not found" } });
    expect(gated.response).toEqual(missing.response);
    expect(JSON.stringify(gated.response)).not.toContain("Hello");
  });

  it("SECURITY: a member whose tier is insufficient gets the same 404", async () => {
    const gated = await refusal(call(deps({ token: "silver-member", row: post('{"tiers":["gold"]}'), allowed: () => false })));
    expect(gated.response).toEqual({ status: 404, body: { error: "post 'hello' was not found" } });
  });

  it("names the raw slug in the gate's 404 and an absent slug as empty", async () => {
    expect((await refusal(call(deps({ allowed: () => false }), "Hello "))).response.body).toEqual({ error: "post 'Hello ' was not found" });
    expect((await refusal(call(deps({ row: null }), undefined))).response.body).toEqual({ error: "post '' was not found" });
  });

  it("answers missing presentation settings as a 404 with its own message", async () => {
    expect((await refusal(call(deps({ settings: null })))).response).toEqual({ status: 404, body: { error: "presentation settings for workspace 'ws-1' were not found" } });
  });

  it("leaves an unexpected failure to the host's error port", async () => {
    const boom = new Error("db down");
    const d = { ...deps(), postRepo: { findBySlug: async () => { throw boom; } } as never };
    await expect(call(d)).rejects.toBe(boom);
  });
});
