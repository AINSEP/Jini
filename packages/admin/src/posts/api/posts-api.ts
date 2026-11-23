import type { AdminPost, AdminPostCreateInput } from "./posts-api.types.js";

/** The host's authenticated admin request — it owns the base URL, authentication, retries, error
 *  decoding and failure publishing (`options.failureEntry` names the entry a failure is reported
 *  under), so this client only names paths, methods and bodies. */
export type PostsRequestFn = <T>(
  required: { path: string },
  optional?: {
    init?: RequestInit;
    onOk?: ((required: { response: Response }, optional?: Record<string, never>) => void) | undefined;
    options?: { failureEntry?: "page" };
  }
) => Promise<T>;

/** What the host injects into {@link createPostsApi}. */
export interface PostsApiDeps {
  /** The host's authenticated admin request. */
  request: PostsRequestFn;
  /** The workspace every posts path is scoped under (`/workspaces/<id>/posts`). */
  workspaceId: string;
  /** The admin API base path `request` prefixes; only the template-preview URL, which is built
   *  rather than fetched, needs it spelled out. */
  base: string;
  /** Makes a host path absolute where the admin's own origin cannot serve it (a dev server), and is
   *  a no-op where admin, API and public site share one origin. */
  siteUrl: (required: { path: string }) => string;
  /** Whether a body fits under `fetch`'s keepalive ceiling. */
  bodyFitsKeepalive: (required: { body: string }) => boolean;
}

/** One standing draft as `putAutosave` sends it. */
export type PostAutosaveDraft = { bodyFormat: "doc"; bodyJson: Record<string, unknown>; title: string; slug: string; baseVersion: number } | {
  bodyFormat: "html";
  bodyHtml: string;
  title: string;
  slug: string;
  baseVersion: number;
};

/** The admin API calls of the posts feature, bound to the host's injected collaborators.
 *  @example const postsApi = createPostsApi({ request, workspaceId, base, siteUrl, bodyFitsKeepalive }); */
export function createPostsApi(deps: PostsApiDeps, _optional: Record<string, never> = {}) {
  return { ...postsCrudCalls(deps), ...postsTemplatePreviewCall(deps), ...postsAutosaveCalls(deps) };
}

function postsCrudCalls({ request, workspaceId }: PostsApiDeps) {
  return {
    listPosts: () =>
      request<{ posts: Array<{ post: AdminPost }> }>({ path: `/workspaces/${workspaceId}/posts` }),
    createPost: (input: AdminPostCreateInput, _options: Record<string, never> = {}) =>
      request<{ post: AdminPost }>({ path: `/workspaces/${workspaceId}/posts` }, { init: {
        method: "POST",
        body: JSON.stringify(input),
      } }),
    getPost: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ post: AdminPost }>({ path: `/workspaces/${workspaceId}/posts/${encodeURIComponent(id)}` }),
    // `expectedVersion` (2026-09-06) is the optimistic-concurrency basis, not a writable field —
    // the `AdminPost.version` the caller loaded, which the server compares and rejects with
    // `409 VERSION_CONFLICT` when a newer save has superseded it. Purely additive and optional: a
    // caller that omits it (every caller but the post editor today, the page editor included)
    // gets exactly the last-write-wins behavior this method has always had.
    updatePost: ({ id }: { id: string }, { options = {}, entry }: { options?: Partial<Pick<AdminPost, "title" | "slug" | "bodyJson" | "status" | "templateChoice" | "overridesThemePage" | "publishAt" | "featuredMediaId" | "author" | "showAuthor">> & {
        expectedVersion?: number;
        hideCoverImageInBody?: boolean;
        slugFromTitle?: boolean;
      }; entry?: "page" } = {}
    ) =>
      request<{ post: AdminPost }>({ path: `/workspaces/${workspaceId}/posts/${encodeURIComponent(id)}` }, { init: {
        method: "PUT",
        body: JSON.stringify(options),
      }, onOk: undefined, options: entry ? { failureEntry: entry } : {} }),
    // Soft delete (the host's posts delete route): trashes the row rather than removing it,
    // revertible server-side via POST /change-sets/:id/revert. Kind-blind like getPost/updatePost —
    // deletes whatever row has this id regardless of whether it is a post or a page, which is why
    // PostEditor (shared between both) calls this rather than deletePage.
    deletePost: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ post: AdminPost }>({ path: `/workspaces/${workspaceId}/posts/${encodeURIComponent(id)}` }, { init: {
        method: "DELETE",
      } }),
  };
}

function postsTemplatePreviewCall({ workspaceId, base, siteUrl }: PostsApiDeps) {
  return {
    // Template-preview fix (2026-08-11). Kind-blind like getPost/updatePost/deletePost — one
    // route serves both editors' Preview tabs (the host's template-preview route's own file
    // header explains why). NOT run through `request()`: the caller points an `<iframe src>` (or a
    // hidden form's `action`) directly at this URL rather than fetching+parsing JSON, so this only
    // builds the string.
    //
    // `templateChoice`'s tri-state (see `resolveTemplate`'s doc) is preserved through the query string:
    // `null` omits the param entirely ("never chosen" — the theme's page shell for a Page, or the
    // theme's first template for a Post), `""` sends `?templateChoice=` (a Post's diagnostic page;
    // since the bare-page ruling, 2026-09-23, a Page's explicit "No template" — bare, no theme styles/
    // scripts/header/footer), anything else sends that filename.
    //
    // `siteUrl(...)` wrapping (2026-08-12, owner-reported bug — mention links inside this preview
    // navigated to a blank dev-server error page): every OTHER `base`-prefixed path in this client
    // is fetched via `request()`, so staying relative and letting the admin dev server's `/api` proxy
    // forward the bytes is correct for those. This one is different — its caller loads the RESPONSE as
    // a real navigated HTML document (an `<iframe src>` or a form `target`ed at one), which makes this
    // URL's origin the document's own base URI for every relative link INSIDE it. A relative path here
    // resolves against the ADMIN dev server, which proxies only a small explicit allowlist (`/api`,
    // `/agent-icons`, `/theme-assets`) — so `/theme-assets/...` links in the rendered page happened to
    // keep working while a post/page mention's `<a href="/{slug}">` (the renderer's `"mention"` case)
    // did not: `/{slug}` isn't in that allowlist, so the dev server 404s it with its stock "did you
    // mean /admin/{slug}?" page instead of ever reaching this route. `siteUrl` (already used by the
    // live-site branch's own iframe `src` for exactly this "escape the admin origin in dev" reason)
    // makes this absolute in dev and a no-op in production, where the admin SPA, this API, and the
    // public site are already the same origin.
    templatePreviewUrl: ({ id, templateChoice }: { id: string; templateChoice: string | null }, _optional: Record<string, never> = {}) =>
      siteUrl(
        { path: `${base}/workspaces/${workspaceId}/posts/${encodeURIComponent(id)}/template-preview${
          templateChoice === null ? "" : `?templateChoice=${encodeURIComponent(templateChoice)}`
        }` }
      ),
  };
}

function postsAutosaveCalls({ request, workspaceId, bodyFitsKeepalive }: PostsApiDeps) {
  const autosavePath = (id: string) => `/workspaces/${workspaceId}/posts/${encodeURIComponent(id)}/autosave`;
  return {
    // Standing-draft autosave (2026-09-06) — kind-blind like getPost/updatePost/deletePost, one
    // route serves both editors (the host's autosave route's own file header explains why there
    // is no parallel `/pages/.../autosave`).
    //
    // `applied: false` is an ORDINARY outcome, not a thrown error: it means the row's `version` moved
    // (a real Save/Publish happened) since `baseVersion` was captured, so the caller's own in-memory
    // edit is no longer the current basis and this tick was correctly dropped rather than clobbering
    // the newer save.
    //
    // `options.keepalive` (2026-09-07) is the UNLOAD-SAFE transport, requested only by the autosave
    // hook's exit flush (`pagehide` / `visibilitychange`→hidden). An ordinary `fetch` started from
    // one of those events is cancelled when the browser tears the document down, so the newest edit
    // — the one still sitting in the debounce window, which is exactly what those listeners exist to
    // rescue — was the one most likely to be dropped. It is opt-in rather than always-on because
    // `keepalive` carries a 64 KiB body ceiling an ordinary request does not; see the injected
    // {@link PostsApiDeps.bodyFitsKeepalive} for what happens to a body over it.
    putAutosave: ({ id, draft }: { id: string; draft: PostAutosaveDraft }, options: { keepalive?: boolean } = {}) => {
      const body = JSON.stringify(draft);
      return request<{ applied: boolean }>({ path: autosavePath(id) }, { init: {
        method: "PUT",
        body,
        // Silently dropped rather than sent for an oversized body: `fetch` REJECTS outright when a
        // keepalive body exceeds the ceiling, which would turn a request that had at least a chance
        // of completing into one that provably never leaves. A plain fetch on the way out is the
        // pre-2026-09-07 behavior, i.e. no worse than before for the pages this cannot cover.
        ...(options.keepalive === true && bodyFitsKeepalive({ body }) ? { keepalive: true } : {}),
      } });
    },
    // The recovery-banner check on editor mount — reads whatever standing draft is currently parked,
    // or `null` when there is nothing to offer.
    getAutosave: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{
        autosave: {
          bodyFormat: "doc" | "html";
          bodyJson?: Record<string, unknown>;
          bodyHtml?: string;
          title: string;
          slug: string;
          baseVersion: number;
          savedAt: string;
          savedByPrincipalId: string;
        } | null;
      }>({ path: autosavePath(id) }),
    // Clears the standing draft — called after a real Save/Publish succeeds, and on an explicit
    // operator Discard. Unconditional: there is no stale basis to guard against when the intent is
    // simply "there is no longer a draft to offer".
    discardAutosave: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ ok: boolean }>({ path: autosavePath(id) }, { init: {
        method: "DELETE",
      } }),
  };
}

/** The bound client's shape, for hosts and ports that type against it. */
export type PostsApi = ReturnType<typeof createPostsApi>;
