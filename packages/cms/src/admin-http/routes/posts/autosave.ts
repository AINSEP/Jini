import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { JsonObject, UUID } from "@jini-ai/core/primitives";

/**
 * @file Standing-draft autosave for Posts AND Pages (2026-09-06 dispatch): the park (PUT), read
 * (GET) and clear (DELETE) halves of `/posts/:postId/autosave`. Kind-blind — a Page is a `posts` row like any other,
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
 * The PUT's 1 MiB body cap is the host's own Express binding in front of the mount, not
 * `maxBodyBytes`: it answers the host's own 413 copy, which the kit's refusal does not reproduce.
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

/** The two body formats a parked snapshot may carry (the host's `posts_body_format_shape` CHECK). */
export type PostAutosaveBodyFormat = "doc" | "html";

/** A validated autosave body: what the editor sent, before the route stamps who saved it and when. */
export interface PostAutosaveBody {
  readonly bodyFormat: PostAutosaveBodyFormat;
  readonly bodyJson?: JsonObject;
  readonly bodyHtml?: string;
  readonly title: string;
  readonly slug: string;
  readonly baseVersion: number;
  readonly author?: string | null;
  readonly showAuthor?: boolean;
}

/** The snapshot handed to the host's store: the body plus the stamp. */
export interface PostAutosaveSnapshot extends PostAutosaveBody {
  readonly savedAt: string;
  readonly savedByPrincipalId: UUID;
}

/** The deps the park route reads: the shared lookup, the host's byline normalizer, the clock and the store write. */
export interface PostAutosavePutRouteDeps extends Pick<PostAutosaveReadAndClearRouteDeps, "workspaceId" | "findPostId" | "isPostNotFound"> {
  /** The host's shared post-write author normalizer; throws the host's validation error on a bad byline. */
  normalizeAuthor: (required: { author: unknown }) => string | null;
  isPostValidation: (required: { err: unknown }) => boolean;
  nowIso: () => string;
  /** The host's conditional autosave write: `applied: false` when the row's version moved on or the row is gone. */
  writeAutosave: (required: { workspaceId: string; id: string; snapshot: PostAutosaveSnapshot }) => Promise<{ applied: boolean }>;
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

/** The fields common to both `bodyFormat` variants, validated but not yet paired with a payload. */
type AutosaveCommonFields = Pick<PostAutosaveBody, "bodyFormat" | "title" | "slug" | "baseVersion">;

/**
 * Validates the four fields every autosave body carries regardless of `bodyFormat`. Split out of
 * `parseAutosaveBody` (2026-09-16, source-complexity-drift ceiling) so the bodyFormat-specific
 * payload check below has its own name instead of sharing one function's cyclomatic budget.
 * @complexity O(1).
 */
function parseAutosaveCommonFields({ body }: { body: Record<string, unknown> }, _optional: Record<string, never> = {}): AutosaveCommonFields | null {
  const bodyFormat = body.bodyFormat;
  if (bodyFormat !== "doc" && bodyFormat !== "html") return null;
  if (typeof body.title !== "string") return null;
  if (typeof body.slug !== "string") return null;
  if (typeof body.baseVersion !== "number" || !Number.isFinite(body.baseVersion)) return null;
  return { bodyFormat, title: body.title, slug: body.slug, baseVersion: body.baseVersion };
}

/**
 * Validates and extracts the one payload field `bodyFormat` requires: `bodyJson` for `"doc"`,
 * `bodyHtml` for `"html"`. Returns `null` (never throws) on any shape the `posts_body_format_shape`
 * CHECK constraint would also reject, so the route can 400 before ever reaching the store.
 * @complexity O(1).
 */
function parseAutosaveContent({ body, bodyFormat }: { body: Record<string, unknown>; bodyFormat: PostAutosaveBodyFormat }, _optional: Record<string, never> = {}): Pick<PostAutosaveBody, "bodyJson" | "bodyHtml"> | null {
  if (bodyFormat === "doc") {
    if (typeof body.bodyJson !== "object" || body.bodyJson === null) return null;
    return { bodyJson: body.bodyJson as JsonObject };
  }
  if (typeof body.bodyHtml !== "string") return null;
  return { bodyHtml: body.bodyHtml };
}

/** Validates optional byline fields while preserving absent keys in the parked snapshot.
 * Author normalization remains owned by the host's shared post write validator. @complexity O(1) plus the normalizer. */
function parseAutosaveByline(
  { body, normalizeAuthor }: { body: Record<string, unknown>; normalizeAuthor: PostAutosavePutRouteDeps["normalizeAuthor"] },
  _optional: Record<string, never> = {},
): Pick<PostAutosaveBody, "author" | "showAuthor"> | null {
  if (body.author !== undefined && body.author !== null && typeof body.author !== "string") return null;
  if (body.showAuthor !== undefined && typeof body.showAuthor !== "boolean") return null;
  return {
    ...(body.author !== undefined ? { author: normalizeAuthor({ author: body.author }) } : {}),
    ...(body.showAuthor !== undefined ? { showAuthor: body.showAuthor as boolean } : {}),
  };
}

/** This route's writable PUT fields, read off an untyped body in one place — mirrors the post update's
 *  body parser. Returns `null` on any payload shape the `posts_body_format_shape` CHECK constraint
 *  would also reject; author validation throws the host's write error.
 *  @complexity O(1) plus the normalizer — delegates to the three field parsers above. */
function parseAutosaveBody({ rawBody, normalizeAuthor }: { rawBody: unknown; normalizeAuthor: PostAutosavePutRouteDeps["normalizeAuthor"] }, _optional: Record<string, never> = {}): PostAutosaveBody | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const common = parseAutosaveCommonFields({ body });
  if (!common) return null;
  const content = parseAutosaveContent({ body, bodyFormat: common.bodyFormat });
  if (!content) return null;
  const byline = parseAutosaveByline({ body, normalizeAuthor });
  if (!byline) return null;
  return { ...common, ...content, ...byline };
}

/**
 * The validated body, or the flat 400 refusal: the host's author validation error keeps its own
 * message, any other malformed shape answers "invalid autosave body". Other failures are rethrown.
 * @complexity O(1) plus the normalizer.
 */
function readAutosaveBody({ rawBody, deps }: { rawBody: unknown; deps: Pick<PostAutosavePutRouteDeps, "normalizeAuthor" | "isPostValidation"> }, _optional: Record<string, never> = {}): PostAutosaveBody {
  let parsed: PostAutosaveBody | null;
  try {
    parsed = parseAutosaveBody({ rawBody, normalizeAuthor: deps.normalizeAuthor });
  } catch (err) {
    if (!deps.isPostValidation({ err })) throw err;
    rejectRoute({ status: 400, error: err instanceof Error ? err.message : String(err), code: "VALIDATION_ERROR" });
  }
  if (!parsed) rejectRoute({ status: 400, error: "invalid autosave body", code: "VALIDATION_ERROR" });
  return parsed;
}

/** The principal who parked the snapshot. No principal is a wiring bug, so it fails closed. @complexity O(1). */
function autosaveActorId({ context }: { context: PostAutosaveRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("posts autosave admin route has no authenticated principal");
  return context.id;
}

/**
 * PUT `/api/admin/v1/workspaces/:workspaceId/posts/:postId/autosave` — parks a standing draft.
 *
 * Response is `{ applied: boolean }`, never a 409: `applied: false` (the row's `version` no longer
 * equals this snapshot's `baseVersion`, or the row is gone — the host's `writeAutosave` guard is a
 * single conditional UPDATE) is an ordinary, expected outcome for a background tick, not an error
 * the operator needs to see. Nothing was written, and nothing on this side changes as a result: a
 * client that keeps PUTting the same `baseVersion` will keep being refused, which is deterministic
 * rather than transient.
 *
 * Acting on the flag is therefore entirely the client's job: the admin's standing-draft autosave hook
 * stops scheduling further autosaves for that basis and surfaces a `staleBasis` state; it deliberately
 * does NOT drop the operator's in-memory text — that would discard the very work the refusal protects.
 *
 * The body is judged after authorization (`parse` passes it through), as the hand-written route did.
 * An unexpected failure is the host's redacted 500 ("The post draft could not be saved.").
 */
export const postAutosavePutRoute = defineJsonRoute<{ postId: string; body: unknown }, { applied: boolean }, PostAutosavePutRouteDeps, PostAutosaveRoutePrincipal>({
  method: "put",
  path: AUTOSAVE_PATH,
  parse: (raw) => ok({ value: { postId: String(raw.params.postId ?? ""), body: raw.body } }),
  handle: async ({ input, deps, authorize, context }) => {
    await authorizeAutosave({ authorize });
    const parsed = readAutosaveBody({ rawBody: input.body, deps });
    const snapshot: PostAutosaveSnapshot = { ...parsed, savedAt: deps.nowIso(), savedByPrincipalId: autosaveActorId({ context }) };
    const postId = await resolvePostId({ deps, rawParam: input.postId });
    return ok({ value: await deps.writeAutosave({ workspaceId: deps.workspaceId, id: postId, snapshot }) });
  },
});
