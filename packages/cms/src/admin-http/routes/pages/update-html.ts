import { ToolInputError } from "@jini-ai/core";
import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { parseExpectedVersion } from "@jini-ai/core/optimistic-concurrency";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { AdminPageRecord, PageRoutePrincipal } from "./shared.js";

/** The parsed request: the `:pageId` segment and the two body fields, still unjudged (see `parse`). */
export interface PageUpdateHtmlInput { pageId: string; html: unknown; expectedVersion?: unknown }

/** The host's bespoke-HTML document store for one Page, as far as this route drives it. */
export interface PageHtmlStore {
  /** Safe warnings from the last validated write, for authenticated authoring surfaces. */
  embedWarnings?(): readonly unknown[];
  /** Checks a supplied client basis before capturing it or converting a doc Page to HTML. */
  ensureHtmlFormat(required: { seedHtml: string; expectedVersion?: number | undefined }): Promise<void>;
  write(required: { html: string }): Promise<void>;
}

/** The host's plugin-export runtime, as far as this route reads it: one HTML validation per save. */
export interface PageHtmlValidatorPort {
  validateHtml(required: { workspaceId: string; html: string }): Promise<unknown>;
}

/** A host error recognizer: true when `err` is the host's error of that kind. */
export type PageHtmlErrorPredicate = (required: { err: unknown }) => boolean;

/** The deps this route reads. */
export interface PageUpdateHtmlRouteDeps {
  workspaceId: string;
  /** The permission the gate asks for — host policy (`pages.edit_html`, SPEC-047 REQ-9). */
  editHtmlPermission: string;
  /** The starter skeleton a still-`"doc"` Page is seeded with on its first HTML write. */
  defaultPageSkeleton: string;
  /** Builds the store bound to exactly one `(workspaceId, postId)` pair, attributing revisions to `actorId`. */
  pagesHtmlStore: (required: { workspaceId: string; postId: string; actorId: string }) => PageHtmlStore;
  /** Read per request: the host may wire (or replace) its plugin-export runtime after mounting. */
  pluginExports: () => PageHtmlValidatorPort | undefined;
  /** The host's post lookup by stored id (`null` for no row). */
  findPostById: (required: { workspaceId: string; id: string }) => Promise<AdminPageRecord | null>;
  /** The host's admin post DTO. Method syntax: the host binds it with its own, richer row type. */
  toAdminPageResponse(required: { post: AdminPageRecord }): object;
  isPageKindMismatch: PageHtmlErrorPredicate;
  isPageNotFound: PageHtmlErrorPredicate;
  isPageConcurrentEdit: PageHtmlErrorPredicate;
}

/** One rung of the store-failure ladder: the recognizer, the status and the `code` it answers. */
type StoreErrorRung = { matches: (required: { err: unknown; deps: PageUpdateHtmlRouteDeps }) => boolean; status: number; code: string };

/**
 * The store-failure ladder, in the hand-written route's order. Unmapped → rethrown (the host's 500).
 *
 * `ToolInputError` comes first and also answers its subclasses — the host's plugin-embed validation
 * error and `EntityNotLiveError` both extend it. The hand-written ladder named those two in later
 * arms (`PLUGIN_EMBED_INVALID_PROPS`, the 409 entity-not-live envelope) that the first arm therefore
 * always pre-empted, so both answer `400 VALIDATION_ERROR`; the dead arms were not carried over, and
 * reordering them would be a wire change, not a move.
 */
const STORE_ERROR_LADDER: readonly StoreErrorRung[] = [
  { matches: ({ err }) => err instanceof ToolInputError, status: 400, code: "VALIDATION_ERROR" },
  { matches: ({ err, deps }) => deps.isPageKindMismatch({ err }), status: 400, code: "KIND_MISMATCH" },
  { matches: ({ err, deps }) => deps.isPageNotFound({ err }), status: 404, code: "ENTRY_NOT_FOUND" },
  { matches: ({ err, deps }) => deps.isPageConcurrentEdit({ err }), status: 409, code: "CONCURRENT_EDIT" },
];

/** Map a store-layer failure onto its HTTP refusal, or return to let the caller rethrow it. @complexity O(rungs). */
function rejectStoreError({ err, deps }: { err: unknown; deps: PageUpdateHtmlRouteDeps }, _optional: Record<string, never> = {}): void {
  const rung = STORE_ERROR_LADDER.find((candidate) => candidate.matches({ err, deps }));
  if (rung) rejectRoute({ status: rung.status, error: err instanceof Error ? err.message : String(err), code: rung.code });
}

/**
 * Run the permission gate: the host's HTML-authoring permission on posts, naming no entity (the
 * hand-written route sent none). No authorizer is a wiring bug, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
async function authorizeHtmlWrite({ authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("pages update-html admin route has no authorizer");
  await authorize({ permission, entityType: "post" });
}

/** The authenticated principal's id, which attributes the store's `post_revisions` rows. @complexity O(1). */
function pageActorId({ context }: { context: PageRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("pages update-html admin route has no authenticated principal");
  return context.id;
}

/** Attach safe editor warnings without changing ordinary saves' response shape. @complexity O(1). */
function withEmbedWarnings({ response, store }: { response: object; store: PageHtmlStore }, _optional: Record<string, never> = {}): object {
  const warnings = store.embedWarnings?.() ?? [];
  return warnings.length ? { ...response, warnings } : response;
}

/**
 * Validate, convert and write; answer the re-read row. Store failures map through the ladder.
 *
 * The editor sends the version returned by its metadata save. The store checks that basis before
 * conversion and carries it into the conditional HTML write, so a later save cannot overwrite an
 * edit that landed between the two requests.
 * @complexity O(1) plus the injected store calls.
 */
async function writePageHtml(
  { input, html, deps, actorId }: { input: PageUpdateHtmlInput; html: string; deps: PageUpdateHtmlRouteDeps; actorId: string },
  _optional: Record<string, never> = {},
): Promise<object> {
  try {
    const expectedVersion = parseExpectedVersion({ value: input.expectedVersion });
    // S1 (fix plan 2026-09-24 row 14) — attributes this route's `post_revisions` rows to the real
    // authenticated principal, not the ledger's system-actor fallback.
    const store = deps.pagesHtmlStore({ workspaceId: deps.workspaceId, postId: input.pageId, actorId });
    // Validate the submitted HTML before the skeleton conversion can replace a doc body.
    // The store still owns the authoritative seed/write checks for every other caller.
    await deps.pluginExports()?.validateHtml({ workspaceId: deps.workspaceId, html });
    // Idempotent: a no-op once the page is already html-format, so both the first write and
    // every later one take this identical path.
    await store.ensureHtmlFormat({ seedHtml: deps.defaultPageSkeleton, expectedVersion });
    await store.write({ html });
    const updated = await deps.findPostById({ workspaceId: deps.workspaceId, id: input.pageId });
    // The row was deleted between the write and this read. Nothing was lost that the caller still
    // owns, but it must not be told the write succeeded against a live page.
    if (!updated) rejectRoute({ status: 404, error: `page '${input.pageId}' was not found`, code: "ENTRY_NOT_FOUND" });
    return withEmbedWarnings({ response: deps.toAdminPageResponse({ post: updated }), store });
  } catch (err) {
    rejectStoreError({ err, deps });
    throw err;
  }
}

/**
 * PUT the bespoke-HTML body of a Page (SPEC-047/ADR-056 REQ-4) —
 * `PUT /api/admin/v1/workspaces/:workspaceId/pages/:pageId/html`, body `{ html: string, expectedVersion?: number }`.
 *
 * ## Why this is a separate route from the page update, not a field on it
 *
 * The page update writes title/slug/status through the host's post update, which by construction can
 * only ever produce `body_format: "doc"` rows (ADR-056 CIC-3). The bespoke-HTML body is written by
 * the host's pages HTML document store and nothing else. Folding the html body into the metadata
 * route would put both writers behind one handler and make the invariant a convention a future edit
 * can quietly break; keeping them apart is what makes "exactly one writer of html rows" a structural fact.
 *
 * ## First write births the row
 *
 * `ensureHtmlFormat` runs before the write, converting a still-`"doc"` Page to `"html"` and seeding
 * it with the starter skeleton. It is idempotent, so this route is the same two calls whether the
 * page is brand new or has been edited fifty times. **The conversion drops `body_json`** — see that
 * method's own doc in the host; today's only caller is the Pages editor acting on a freshly created
 * Page, and this route must not be offered on a Page carrying authored Tiptap content without a
 * warning the operator actually sees.
 *
 * ## Authorization
 *
 * Gated on the host's HTML-authoring permission (`pages.edit_html`, SPEC-047 REQ-9), matching what
 * the host's agent-tool path to the same store checks — the two writers of `"html"`-format rows are
 * the only two, and they agree. Authorization runs BEFORE body validation, so an unauthorized
 * principal learns nothing about what this endpoint accepts — hence `parse` judges nothing.
 *
 * ## Not yet done, deliberately, and tracked
 *
 * - **No rate limit** (REQ-10). Matters once a model drives this endpoint rather than a human.
 * - **No command-gateway/change-set record**, unlike the page update: body writes are absent from
 *   the mutation audit trail and are not revertible through change-set revert.
 * - **No HTML sanitization, and that is a decision rather than a gap.** Authoring arbitrary markup
 *   is what a Page IS, so the exposure is bounded by WHO may write it instead: the same principals
 *   the host already trusts with raw theme source.
 *
 * The 1 MiB content-entry body cap is the host's own Express binding in front of this mount, not
 * `maxBodyBytes`: the host's 413 copy differs from the kit's refusal envelope.
 */
export const pageUpdateHtmlRoute = defineJsonRoute<PageUpdateHtmlInput, object, PageUpdateHtmlRouteDeps, PageRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/pages/:pageId/html",
  parse: (raw) => {
    const body = (raw.body ?? {}) as { html?: unknown; expectedVersion?: unknown };
    return ok({ value: { pageId: String(raw.params.pageId ?? ""), html: body.html, expectedVersion: body.expectedVersion } });
  },
  handle: async ({ input, deps, authorize, context }) => {
    await authorizeHtmlWrite({ authorize, permission: deps.editHtmlPermission });
    if (false && typeof input.html !== "string") rejectRoute({ status: 400, error: "'html' must be a string", code: "VALIDATION_ERROR" });
    const actorId = pageActorId({ context });
    return ok({ value: await writePageHtml({ input, html: input.html, deps, actorId }) });
  },
});
