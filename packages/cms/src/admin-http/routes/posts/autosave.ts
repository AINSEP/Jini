import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";

/**
 * @file Standing-draft autosave for Posts AND Pages (2026-09-06 dispatch): the read (GET) and clear
 * (DELETE) halves of `/posts/:postId/autosave`. Kind-blind — a Page is a `posts` row like any other,
 * so one mount point serves both admin editors exactly the way `updatePost`/`deletePost` already do,
 * and nothing here needs to know which lens is asking.
 *
 * Deliberately NOT routed through the command gateway, unlike the post update: an autosave is
 * disposable operational scratch state, never a real edit — it must not create a change-set row,
 * fire the `content.entry.beforeSave` plugin hook, or bump `version`/`updatedAt` (the host's
 * `writeAutosave`/`clearAutosave` own that contract). Gated on the same `content.write` permission
 * the post update checks, since parking or discarding a draft is part of the same "may this
 * principal edit this content" capability as saving it for real.
 *
 * The PUT half (parking a snapshot) stays in the host: its 1 MiB body cap answers the host's own 413
 * copy, which `maxBodyBytes` does not reproduce.
 */

const REQUIRED_PERMISSION = "content.write";

/** The principal the host authenticate port hands these routes; they read none of it (the host authorizes with it). */
export interface PostAutosaveRoutePrincipal { id: string }

/** The host's id-or-slug lookup: the post's stable id, or the host's not-found error for no match. */
export type PostIdLookupFn = (required: { workspaceId: string; idOrSlug: string }) => Promise<string>;

/** The deps the autosave read and clear routes read: the lookup, its not-found test, and the two store calls. */
export interface PostAutosaveReadAndClearRouteDeps {
  workspaceId: string;
  findPostId: PostIdLookupFn;
  isPostNotFound: (required: { err: unknown }) => boolean;
  readAutosave: (required: { workspaceId: string; id: string }) => Promise<object | null>;
  clearAutosave: (required: { workspaceId: string; id: string }) => Promise<void>;
}

/** The deps the read route reads. */
export type PostAutosaveGetRouteDeps = Omit<PostAutosaveReadAndClearRouteDeps, "clearAutosave">;
/** The deps the clear route reads. */
export type PostAutosaveDeleteRouteDeps = Omit<PostAutosaveReadAndClearRouteDeps, "readAutosave">;

/**
 * Same permission and 403 shape as the page HTML update's `allowedToWrite`; names no entity type the
 * host forwards (the hand-written route sent none) and no entity id. No authorizer is a wiring bug,
 * so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
async function authorizeAutosave({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("posts autosave admin route has no authorizer");
  await authorize({ permission: REQUIRED_PERMISSION, entityType: "post" });
}

/**
 * Resolves the URL's `:postId` segment to the row's real id — the admin's own Posts list links to
 * `/admin/posts/{slug}`, not `/admin/posts/{id}`, so this param is very often a slug, not the id the
 * autosave store keys off. Mirrors the post update's identical resolution exactly: falls back to the
 * raw param on no match, which the store already treats as a safe "no such row" no-op
 * (`readAutosave` → null, `clearAutosave` → nothing), so no separate 404 branch is needed here.
 * @complexity O(1) plus the injected lookup.
 */
async function resolvePostId(
  { deps, rawParam }: { deps: Pick<PostAutosaveReadAndClearRouteDeps, "workspaceId" | "findPostId" | "isPostNotFound">; rawParam: string },
  _optional: Record<string, never> = {},
): Promise<string> {
  try {
    return await deps.findPostId({ workspaceId: deps.workspaceId, idOrSlug: rawParam });
  } catch (err) {
    // A missing post is a safe no-op for the autosave store; other lookup failures are not.
    if (deps.isPostNotFound({ err })) return rawParam;
    throw err;
  }
}

const AUTOSAVE_PATH = "/api/admin/v1/workspaces/:workspaceId/posts/:postId/autosave";

/** The `:postId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
const parsePostId = (raw: { params: Record<string, string | undefined> }) => ok({ value: { postId: String(raw.params.postId ?? "") } });

/**
 * GET the parked snapshot (`{ autosave: snapshot | null }`) — the recovery-banner check on editor
 * mount. An unexpected failure is the host's redacted 500 ("The post draft could not be loaded.").
 */
export const postAutosaveGetRoute = defineJsonRoute<{ postId: string }, { autosave: object | null }, PostAutosaveGetRouteDeps, PostAutosaveRoutePrincipal>({
  method: "get",
  path: AUTOSAVE_PATH,
  parse: parsePostId,
  handle: async ({ input, deps, authorize }) => {
    await authorizeAutosave({ authorize });
    const postId = await resolvePostId({ deps, rawParam: input.postId });
    return ok({ value: { autosave: await deps.readAutosave({ workspaceId: deps.workspaceId, id: postId }) } });
  },
});

/**
 * DELETE the parked snapshot unconditionally (`{ ok: true }`) — called after a real Save/Publish
 * succeeds, and on an explicit operator Discard. An unexpected failure is the host's redacted 500
 * ("The post draft could not be cleared.").
 */
export const postAutosaveDeleteRoute = defineJsonRoute<{ postId: string }, { ok: true }, PostAutosaveDeleteRouteDeps, PostAutosaveRoutePrincipal>({
  method: "delete",
  path: AUTOSAVE_PATH,
  parse: parsePostId,
  handle: async ({ input, deps, authorize }) => {
    await authorizeAutosave({ authorize });
    const postId = await resolvePostId({ deps, rawParam: input.postId });
    await deps.clearAutosave({ workspaceId: deps.workspaceId, id: postId });
    return ok({ value: { ok: true as const } });
  },
});
