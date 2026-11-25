import { defineJsonRoute, ok, routeReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { PostNotFoundError, type PublicPostRecord } from "../../../../posts/post.js";
import { getPublishedPostBySlug } from "../../../../posts/post-read.js";
import { getPresentationSettings, PresentationSettingsNotFoundError } from "../../../../presentation/presentation.js";
import { toContentPostResponse } from "../../../http/content/posts.js";

/**
 * @file `GET /api/content/v1/workspaces/:workspaceId/posts/:slug` — one published post or page with
 * its presentation, behind the post's member gate. The host's public mount owns the foreign-workspace
 * 404 and the unexpected-failure copy; the member session and the access decision are the host's.
 */

/** The host's member access gate for one request: the caller's context, then the decision on one post. */
export interface ContentPostMemberAccess<MemberContext> {
  resolveContext(required: { workspaceId: string; sessionToken: string | undefined; nowIso: string }): Promise<MemberContext>;
  /** `memberAccessJson` is the post's raw column; the host parses it with its own access rules. */
  decide(required: { memberAccessJson: PublicPostRecord["memberAccessJson"]; context: MemberContext }): { allowed: boolean };
}

/** What the host injects. Method syntax on purpose: the host binds its own member types. */
export interface ContentPostGetRouteDeps<MemberContext = unknown> {
  readonly workspaceId: string;
  readonly postRepo: Parameters<typeof getPublishedPostBySlug>[0]["deps"]["repo"];
  readonly presentationRepo: Parameters<typeof getPresentationSettings>[0]["deps"]["repo"];
  /** The caller's member session token, read per request from the host's member cookie. */
  sessionToken(): string | undefined;
  /** Built per request, never a module-level singleton (the host's member repos are per composition). */
  memberAccess(): ContentPostMemberAccess<MemberContext>;
}

/** The post, its presentation and the caller's member context, read together. @complexity O(1) reads. */
async function readPostView({ deps, slug }: { deps: ContentPostGetRouteDeps; slug: string }, _optional: Record<string, never> = {}) {
  const memberAccess = deps.memberAccess();
  const [{ post }, { settings }, memberContext] = await Promise.all([
    getPublishedPostBySlug({ deps: { repo: deps.postRepo }, input: { workspaceId: deps.workspaceId, slug } }),
    getPresentationSettings({ deps: { repo: deps.presentationRepo }, input: { workspaceId: deps.workspaceId } }),
    memberAccess.resolveContext({ workspaceId: deps.workspaceId, sessionToken: deps.sessionToken(), nowIso: new Date().toISOString() }),
  ]);
  return { post, settings, allowed: memberAccess.decide({ memberAccessJson: post.memberAccessJson, context: memberContext }).allowed };
}

/** Public post read. Not-found answers are `{ error }` 404s; anything else is the host's failure. @complexity O(1) reads. */
export const contentPostGetRoute = defineJsonRoute<{ slug: string }, unknown, ContentPostGetRouteDeps>({
  method: "get",
  path: "/api/content/v1/workspaces/:workspaceId/posts/:slug",
  parse: (raw) => ok({ value: { slug: String(raw.params.slug ?? "") } }),
  handle: async ({ input: { slug }, deps }) => {
    try {
      const { post, settings, allowed } = await readPostView({ deps, slug });
      // ADR-030 §4 gate, matching `routes/site/pages.ts`'s `GET /:slug` single-post gate: a denied
      // caller gets the SAME `PostNotFoundError`-shaped 404 a nonexistent slug already gets below, so
      // a gated post is indistinguishable from one that doesn't exist -- no separate 403/teaser
      // response that would itself leak "a post exists at this slug, but you can't read it."
      if (!allowed) {
        throw new PostNotFoundError(`post '${slug}' was not found`);
      }

      // SECURITY FIX (2026-09-05, Gemini audit finding #7): this response depends on the caller's
      // OWN member session cookie (the gate decision above is per-visitor), so a shared cache in
      // front of the origin must never store and replay it to a later, different caller. Matches
      // the convention every other gated route in this codebase already uses for exactly this
      // reason -- `routes/site/pages.ts`'s `CACHE_CONTROL_PRIVATE_MEMBER_RESPONSE` and
      // `routes/site/media-rendition.ts`'s gated branch both send the identical `private, no-store`.
      return ok({ value: routeReply({ status: 200, body: toContentPostResponse({ post, activeThemeId: settings.activeThemeId }), headers: { "Cache-Control": "private, no-store" } }) });
    } catch (err) {
      if (err instanceof PostNotFoundError || err instanceof PresentationSettingsNotFoundError) return rejectRoute({ status: 404, error: err.message });
      throw err;
    }
  },
});
