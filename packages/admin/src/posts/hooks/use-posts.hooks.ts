import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { FetchQueryAdapter, MutationResult } from "@jini-ai/core/fetch";
import type { AdminPost } from "../api/posts-api.types.js";
import type { PostsListPort } from "./posts-list-port.hooks.js";

/**
 * @file Everything the Posts LIST does, so `Posts.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error strings. The point of
 * pulling it out is not to change behaviour but to make the behaviour testable without rendering a
 * `DataTable`: `Posts.tsx` has no unit test today (`PostEditor` has seven), and a screen whose whole
 * job is five pieces of interdependent async state is the wrong shape to leave untested. A hook is
 * reachable from `renderHook` with no table, no `RowMenu`, and no portal.
 *
 * The doc comments below moved WITH the functions they describe. Several are decision records —
 * why the delete copy says what it says, why the Publish/Unpublish toggle is not gated behind a
 * confirm — and a comment separated from its code stops being read.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts` and `hooks/use-dirty-guard.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/posts` needs it; promote
 * to `src/hooks/` only when a second feature actually does.
 *
 * `port`/`navigate` are injected — see `posts-list-port.hooks.ts` — rather than reaching `lib/api`/
 * `lib/router` directly, so a test can describe load/create/publish-toggle/delete outcomes against
 * `createFakePostsListPort` instead of stubbing global `fetch`. `useWiredPosts` below is the
 * zero-argument pair `Posts.tsx` actually mounts. It resolves the operator locale for fallback
 * errors through the existing Posts translator; API error messages retain their own details. Named
 * `posts-list-*` (not `posts-*`) to avoid colliding with `use-post-editor.hooks.ts`'s own
 * `post-editor-port.hooks.ts` — this is a deliberately separate hook for a deliberately separate
 * screen, per that file's own header.
 *
 * `load` (staleness-bug generalization pass — see `use-content-refresh-subscription.hooks.ts`'s own
 * header): pulled out of the mount effect into a `useCallback` so the same function can also be
 * handed to `useContentRefreshSubscription`, which re-runs it whenever `content_post_create`/
 * `_update`/`_delete` (`host src/features/post/agent-tools.ts`) write a post from an
 * assistant run this screen otherwise has no way to learn about — the exact bug this pass was
 * dispatched to fix, reported against this exact screen (an operator asked the assistant to
 * translate-and-publish a post; the write landed, this list did not move until a manual reload).
 * `setPosts` on success rather than resetting to `null` first, unchanged from before this pass, is
 * what keeps the table rendered across a background refresh instead of flashing back to a loading
 * state on every agent write.
 *
 * `settlement` (2026-09-07 fix, `useSettlementGeneration` — same shape `use-pages.hooks.ts`'s twin
 * `load` got the same day, and `use-sites.hooks.ts`'s `activate`/`use-themes.hooks.ts`'s
 * `activate`/`download` before it): giving `load` a SECOND trigger (the content-refresh
 * subscription, above) means two `listPosts()` calls can be in flight at once with no ordering
 * guarantee on their responses — two assistant writes landing back to back each publish their own
 * refresh notification. Without this guard, whichever request happened to resolve LAST won
 * regardless of which one was issued last, so a slower, earlier (now-stale) response could
 * overwrite the newer list an operator is already looking at. Minted synchronously at the top of
 * `load`, before the request starts, so two calls issued in the same tick each observe the other's
 * claim; checked before `setPosts` so a superseded response is dropped instead of applied.
 */

export interface PostsController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  posts: AdminPost[] | null;
  error: string | null;
  creating: boolean;
  /** In-flight row action (Publish/Unpublish, or the confirmed Delete) — one at a time. */
  rowSavingId: string | null;
  /** The post a `RowMenu` "Delete" selection is asking to confirm; `null` when the dialog is shut. */
  pendingDelete: AdminPost | null;
  setPendingDelete: (post: AdminPost | null) => void;
  createPost: () => Promise<void>;
  togglePostPublish: (post: AdminPost) => Promise<void>;
  removePost: () => Promise<void>;
  /** Row-menu `agentHandle` lookup, keyed by post id rather than render position — see
   *  {@link usePostRowMenuHandleMap}'s own doc for why. */
  rowMenuHandleById: Map<string, string>;
}

/**
 * `DataTable` sorts internally from `sort` + each column's own comparator — `posts` is passed
 * through unsorted, and only `DataTable`'s own render order changes as `sort` changes. Handles are
 * built once from `posts`' own stable order and looked up BY ID in each cell, rather than by render
 * position: `buildPostRowMenuHandleMap`'s own contract derives a handle from each id's slug, not its
 * position, specifically so "the same control keeps the same handle even if rows are later
 * reordered" (its own doc) — which is exactly what re-sorting the table does. Memoized on `posts`
 * alone so re-sorting or any other unrelated re-render (`sort`, `locale`) does not rebuild this map
 * and hand `RowMenu` a new handle-string identity every time.
 */
export function usePostRowMenuHandleMap({ posts, deps }: { posts: AdminPost[] | null; deps: Pick<Parameters<typeof usePosts>[0]["deps"], "buildPostRowMenuHandleMap"> }, _options: Record<string, never> = {}): Map<string, string> {
  return useMemo(() => deps.buildPostRowMenuHandleMap({ posts: posts }), [posts]);
}

export function usePosts({ deps, hooks, locale }: {
  locale: string;
  deps: {
    port: PostsListPort; navigate: (path: string) => void;
    createRoutePath: string; resource: string;
    translate: (required: { locale: string; key: string }) => string;
    buildPostRowMenuHandleMap: (required: { posts: AdminPost[] | null }) => Map<string, string>;
  };
  hooks: Pick<FetchQueryAdapter, "useFetchQuery" | "useFetchMutation" | "useCachedLoader" | "useInvalidate"> & {
    useContentRefreshSubscription: (required: { resource: string; onRefresh: () => void }) => void;
  };
}, _optional = {}): PostsController {
  const { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useContentRefreshSubscription } = hooks;
  const { translate } = deps;
  const { port } = deps;
  const t = useCallback((key: string) => translate({ locale, key }), [locale]);
  const key = useMemo(() => ["posts", "list"] as const, []);
  const fetchList = useCallback(async () => {
    try { return (await port.listPosts()).posts.map(entry => entry.post); }
    catch (error) { throw new Error(error instanceof Error ? error.message : t("failed to load posts")); }
  }, [port, t]);
  // Mount reads and content-refresh invalidations can overlap. The shared cache revokes the
  // older request's ownership before starting the newer read, so a late success or failure
  // cannot replace the latest list. Background reads retain the rendered table.
  const query = useFetchQuery({ key, fetch: fetchList }, { staleTime: 0 });
  const loader = useCachedLoader({ key, fetch: fetchList }, { staleTime: 0 });
  const posts = query.data ?? null;
  function setPosts({ update }: { update: (current: AdminPost[] | null) => AdminPost[] | null }, _options: Record<string, never> = {}) {
    const next = update(loader.peek() ?? null);
    if (next !== null) loader.replace({ value: next });
  }
  const invalidate = useInvalidate();
  const write = useFetchMutation({ run: ({ input }: { input: () => Promise<unknown> }) => input() }, { invalidates: [["posts"]] });
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? query.error?.message ?? null;
  const creating = false;
  // In-flight row action (Publish/Unpublish or the confirmed Delete) — one at a time, same `rowSavingId`
  // convention `Roles.tsx`'s `onDeleteRole` already uses, per `ConfirmButton`'s own doc comment.
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);
  // The post a `RowMenu` "Delete" selection is asking to confirm — `null` when the dialog is
  // closed. `ConfirmDialog` stays mounted unconditionally in the view (see its own doc comment on
  // why); this is what drives its `open` prop.
  const [pendingDelete, setPendingDelete] = useState<AdminPost | null>(null);

  // Query ownership replaces the latest-wins read guard described above; background
  // refreshes keep the table and cache replacements protect newer mutation responses.
  const load = useCallback(() => invalidate({ key: ["posts"] }), [invalidate]);
  useContentRefreshSubscription({ resource: deps.resource, onRefresh: load });

  const rowMenuHandleById = usePostRowMenuHandleMap({ posts: posts, deps });

  return {
    posts,
    error,
    creating,
    rowSavingId,
    pendingDelete,
    setPendingDelete,
    createPost: () => createPost({ deps }),
    togglePostPublish: post => togglePostPublish({ post, deps, write, setPosts, setRowSavingId, setError, t }),
    removePost: () => removePost({ pendingDelete, deps, write, setPosts, setRowSavingId, setError, t, setPendingDelete }),
    rowMenuHandleById,
  };
}


/** Opens a local working copy. The editor owns creation on the first Save/Publish. */
async function createPost({ deps }: { deps: Parameters<typeof usePosts>[0]["deps"] }, _optional = {}) {
  deps.navigate(deps.createRoutePath);
}

/** Flips a row's publish status — Unpublish (-> draft) for a published row, Publish (-> published)
 *  for a draft, matching `postRowMenuItems`'s own label for whichever direction applies. A
 *  reversible, access-affecting action (not destructive: no `ConfirmDialog`, matching
 *  `ConfirmButton`'s own warning-vs-destructive distinction).
 *
 * Owner rename (2026-09-22) from the old `disablePost`, which only ever flipped published ->
 * draft (`RowMenu`'s item list omitted "Disable" entirely for an already-draft row, rather than
 * rendering it disabled) — a draft post had no way to publish from this list at all, only from
 * the full editor.
 *
 * Sends the row's own `title`/`slug`/`bodyJson` alongside the flipped `status` and
 * `expectedVersion` — `PUT /posts/:id`'s `validateUpdatePostInput` (`features/post/post.ts`)
 * treats a missing `title`/`slug` as `""` and rejects the request with "title is required" before
 * ever reaching the version check, and requires `bodyJson` to be a JSON object (a Post is always
 * `bodyFormat: "doc"` — see this file's own header). That is exactly what the OLD
 * `{ status, expectedVersion }`-only payload hit (owner screenshot, 2026-09-22): every click
 * 500'd on that validation, regardless of the row's status, and never reached the version guard
 * at all. Round-tripping the row's own already-loaded fields here is safe specifically because
 * they are read from the SAME `post` this call's `expectedVersion` is about to check — a stale
 * basis fails that compare-and-set before any of these fields would actually be written back, so
 * this can never silently overwrite a concurrent edit to title/slug/body.
 *
 * `expectedVersion: post.version` (2026-09-18, multi-author hardening, Task 14a) — this row's
 * `version` as THIS LIST last loaded it. Before that fix, the request carried no basis at all, so
 * a concurrent save elsewhere (the full editor, or another operator's own list) was silently
 * overwritten by whichever request landed last, with no error and no trace — this action always
 * won regardless of the row's real current state. Now it races the same shared post exactly as
 * `usePostEditor.save()` already does, and a stale basis surfaces as the same `409
 * VERSION_CONFLICT` (caught below, same as any other failure) instead of a silent overwrite. */
async function togglePostPublish({ post, deps, write, setPosts, setRowSavingId, setError, t }: { post: AdminPost; deps: Parameters<typeof usePosts>[0]["deps"]; write: MutationResult<() => Promise<unknown>, unknown>;
  setPosts: (required: { update: (current: AdminPost[] | null) => AdminPost[] | null }) => void;
  setRowSavingId: Dispatch<SetStateAction<string | null>>; setError: Dispatch<SetStateAction<string | null>>;
  t: (key: string) => string; }, _optional = {}) {
  const { port } = deps;
  const nextStatus: AdminPost["status"] = post.status === "published" ? "draft" : "published";
  setRowSavingId(post.id);
  setError(null);
  try {
    const { post: updated } = await write.mutate({ input: () => port.updatePost({ target: { id: post.id }, patch: { title: post.title, slug: post.slug, bodyJson: post.bodyJson, status: nextStatus, expectedVersion: post.version } }
    ) }) as Awaited<ReturnType<typeof port.updatePost>>;
    setPosts({ update: (prev) => (prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev) });
  } catch (e) {
    setError(e instanceof Error ? e.message : t(nextStatus === "published" ? "failed to publish post" : "failed to unpublish post"));
  } finally {
    // Only clear THIS row's lock — `rowSavingId` is shared with `removePost`'s delete-in-flight
    // lock (2026-09-20, S4b hardening). An unconditional `setRowSavingId(null)` here would wipe a
    // DIFFERENT row's delete lock if that row's `ConfirmDialog` confirm landed while this toggle
    // was still in flight, making the dialog read as settled (dismissable, re-confirmable) while
    // the delete is still on the wire.
    setRowSavingId((cur) => (cur === post.id ? null : cur));
  }
}

/** Soft delete — see `features/pages/hooks/use-pages.hooks.ts`'s `removePage` (the twin of
 * this function) for the full
 * rationale behind the confirm copy: it states only the observable consequence and
 * deliberately does not claim recoverability, because no restore path is reachable from this
 * product today even though the underlying route is a genuine soft delete. Do not add
 * "recoverable"/"not permanent" (unreachable promise) or "permanently"/"cannot be undone"
 * (the opposite lie) without first changing what's actually true.
 *
 * Confirmation gates via a `ConfirmDialog` modal, reached through `RowMenu`'s "Delete" item,
 * rather than `ConfirmButton`'s in-place two-click control or `window.confirm` — a further
 * upgrade over MSG-03's `ConfirmButton` pass: that component was itself chosen at the time
 * because `styles.css` was locked to a concurrently-editing agent and a modal needed new markup/
 * CSS this pass could not add (see `ConfirmButton.tsx`'s own file header). Neither constraint
 * holds any more, and a modal disclosure ("Move "X" to trash? It will disappear from the site and
 * from this list.") reads as a deliberate decision point rather than a label change on a button
 * already sitting in a menu the operator just opened. */
async function removePost({ pendingDelete, deps, write, setPosts, setRowSavingId, setError, t, setPendingDelete }: { pendingDelete: AdminPost | null; setPendingDelete: Dispatch<SetStateAction<AdminPost | null>>; deps: Parameters<typeof usePosts>[0]["deps"]; write: MutationResult<() => Promise<unknown>, unknown>;
  setPosts: (required: { update: (current: AdminPost[] | null) => AdminPost[] | null }) => void;
  setRowSavingId: Dispatch<SetStateAction<string | null>>; setError: Dispatch<SetStateAction<string | null>>;
  t: (key: string) => string; }, _optional = {}) {
  const { port } = deps;
  if (!pendingDelete) return;
  const post = pendingDelete;
  setRowSavingId(post.id);
  setError(null);
  try {
    await write.mutate({ input: () => port.deletePost({ id: post.id }) });
    setPosts({ update: (prev) => (prev ? prev.filter((p) => p.id !== post.id) : prev) });
  } catch (e) {
    setError(e instanceof Error ? e.message : t("failed to delete post"));
  } finally {
    // Symmetric guard to `togglePostPublish`'s — see its comment. Keeps this correct regardless of
    // which of the two in-flight actions settles first.
    setRowSavingId((cur) => (cur === post.id ? null : cur));
    setPendingDelete(null);
  }
}


export function bindPostsHooks({ hooks, deps }: {
  hooks: Parameters<typeof usePosts>[0]["hooks"] & { useLocaleHook: () => string };
  deps: Parameters<typeof usePosts>[0]["deps"];
}, _optional = {}) {
  return function useBoundPosts(_required: Record<string, never>, _optional = {}): PostsController {
    const locale = hooks.useLocaleHook();
    return usePosts({ deps, hooks, locale });
  };
}
