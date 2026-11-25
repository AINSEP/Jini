import type { JsonRouteAuthorize, RawRouteInputContext } from "@jini-ai/core/contracts/server";
import type { JsonObject } from "@jini-ai/core/primitives";

/**
 * @file Template-preview fix (2026-08-11, extended 2026-08-12) — `ADS-memory/reports/implementation/
 * 2026-08-11-template-preview-render-bug.md` has the original root-cause writeup. Short version: both
 * editors' Preview tab shows the real published page/post (`siteUrl`, full theme CSS/nav/footer) only
 * when `status === "published" && !dirty`; picking a DIFFERENT template than the one already saved
 * marks the row dirty (by design — it is an unsaved change), which used to fall the preview all the
 * way back to the raw, unstyled body with no template applied at all. That fallback also does not
 * read `templateChoice`, so switching between templates while dirty rendered byte-identical output —
 * "it doesn't re-render" was a symptom of the SAME cause as "it renders with no CSS", not two bugs.
 *
 * This route lets the editor preview the row through a PENDING (possibly unsaved) template choice AND
 * a PENDING body, reusing the exact render pipeline the public site uses (`renderViaTemplate`) rather
 * than a second, drift-prone implementation — the one thing it does differently from a normal page
 * load is override `templateChoice`/`bodyJson` on an in-memory clone of the fetched record before
 * rendering; nothing is written back to storage. Looked up by id via `getAdminPostByIdOrSlug` (any
 * status, unlike the public `getPublishedPostBySlug` the live-site iframe branch uses) rather than by
 * public slug — but the editors deliberately only ROUTE a `status === "published"` row through this
 * endpoint (see `PagePreview`/`PostPreview`'s own doc comments): a draft's own `{"type":"content"}`
 * slot still resolves through `resolveHtmlPageEmbeds`'s visibility-filtered "content" resolver
 * (`resolver-service.ts`'s guard 2), which returns nothing for an unpublished row, so a `GET`-only
 * request for a draft (no pending body attached — still all either editor currently sends for one,
 * as of this paragraph) shows styled chrome around an EMPTY body — confirmed live in this route's own
 * integration test (`admin-post-template-preview.test.ts`'s draft case). The id-based lookup stays
 * status-agnostic at THIS layer regardless: **a `POST` carrying the matching pending body (`bodyJson`
 * or, as of 2026-09-09, `bodyHtml` — see that paragraph below) bypasses this SAME visibility guard for
 * exactly that one already-authorized id**, which is what actually lets a draft preview its real,
 * unsaved content once a caller sends one — the admin UI widening to send one for a draft is tracked
 * separately from this route's own capability.
 *
 * **Pending body (2026-08-12)**: the owner's own reported bug — any content edit (not just a
 * template-picker change) sets `contentDirty`, which used to drop the preview all the way to the raw
 * `SrcDocSandbox` fallback with no theme CSS, because the DIRTY case had no way to hand this route the
 * operator's UNSAVED `bodyJson`. The naive alternative (point the dirty case at this route with only
 * `templateChoice` threaded, as originally built) renders the last-SAVED body — silently stale, worse
 * than the honest unstyled fallback it would replace. Fixed by accepting an optional `bodyJson` on
 * `POST` (see the handler below) and threading it through as
 * `ResolveHtmlPageEmbedsDeps.pendingContentOverride` (`Jini/packages/cms/src/widgets/resolver-service.ts`) — the ONE place
 * the current entity's own `{"type":"content"}` slot re-fetches by id
 * (`findPublishedPostById`/`features/post/post.ts`), silently discarding any in-memory-only override
 * that never reached that call. `GET` (unchanged, still template-choice-only) and `POST` (new, also
 * accepts a pending body) share this same handler — a `GET` request's `req.body` is always empty, so
 * `pendingBodyJson` is `undefined` on every pre-existing caller and that path is byte-for-byte
 * unchanged.
 *
 * **`bodyHtml` (2026-09-09, the `"html"`-format half of the same pending-body fix)**: `bodyJson` only
 * ever helps a `"doc"`-format post/Post — a Page written through the Pages admin editor is
 * `bodyFormat: "html"` and stores `bodyHtml`, not `bodyJson` (`features/post/post.ts`'s
 * `resolveUpdateBodyFields`, `repo.sqlite.ts`'s `toRecord`/inverse-column mapping). Overriding
 * `bodyJson` for an html-format row would do nothing — `renderViaTemplate`'s render path never reads
 * `bodyJson` for an html-format entity's own body (see `resolveHtmlFormatContentMarkers`'s own doc).
 * So this route ALSO accepts an optional `bodyHtml` form/JSON field, extracted by
 * {@link extractPendingBodyHtml} (a plain string — no `JSON.parse` needed, unlike `bodyJson`'s
 * TipTap-document shape) and threaded through as `renderViaTemplate`'s own `pendingBodyHtml`
 * parameter, which that function forwards to {@link resolveHtmlFormatContentMarkers}'s
 * `pendingHtmlOverride` — the equivalent bypass of that function's OWN `findPublishedPostById`
 * visibility guard, for the exact same reason and under the exact same "matches only the one id this
 * caller already fetched and authorized" scoping `pendingContentOverride` already uses for `bodyJson`.
 * The extracted renderer only builds this override when the FETCHED row's own `bodyFormat` is
 * `"html"` — an `bodyHtml` field sent for a `"doc"`-format post is ignored, never applied, since that
 * row has no `bodyHtml` column to preview in the first place.
 *
 * `POST`, not a widened `GET` query string, because a TipTap `bodyJson` document has no realistic
 * upper bound the way a `templateChoice` filename does. The admin client cannot simply point an
 * `<iframe src>` at a `POST` URL (this file's own `GET`-era doc, below, explains why the iframe needs
 * a REAL URL rather than `srcDoc` — root-relative `/theme-assets/...` paths); the real browser
 * mechanism for "POST a body, land on a real URL, inside a specific iframe" is a hidden `<form
 * method="post" target="{iframe name}">` submit — NOT `fetch()` (a `fetch` response is just a string in
 * JS; landing it in the iframe as a REAL document again means either `srcDoc` — the exact thing this
 * route exists to avoid — or a `blob:` URL, whose relative-URL resolution against `/theme-assets/...`
 * is unverified here and would need its own live check before relying on it).
 *
 * A plain HTML form POST always encodes as `application/x-www-form-urlencoded`, never
 * `application/json` — this route accepts BOTH: `app.ts`'s global `express.json({limit: "15mb"})`
 * handles a `fetch`-style JSON POST (if the admin-side implementation ever prefers that transport for
 * something other than the iframe itself), and this route ADDITIONALLY mounts its own
 * `express.urlencoded` on the `POST` registration only (scoped here, not globally in `app.ts`, since no
 * other route needs it) for the classic form-submit case — where `bodyJson` arrives as a
 * JSON-stringified STRING form field, not a parsed object, so {@link isJsonObject}'s check on the raw
 * value is followed by one `JSON.parse` attempt for exactly that shape (see the handler below).
 *
 * Mounted under `/api/admin/v1/workspaces/:workspaceId/posts/:postId/...`, the same URL family
 * `get-by-id.ts`/`update.ts` already use for both Posts and Pages (`PostEditor.tsx`'s own header:
 * "Shared between posts and pages via the same `/admin/posts/{id}` route") — `getAdminPostByIdOrSlug`
 * is kind-blind, so one route serves both editors' Preview tabs. Gated by the same global
 * `requireAdminSession` mount every other `/api/admin/*` route relies on (`app.ts`), so no extra
 * auth wiring is needed here beyond calling `getAuthedPrincipal` the same way `get-by-id.ts` does.
 *
 * Returns `text/html` directly rather than JSON — the client points an `<iframe src>`/form-target
 * straight at this URL (same reasoning `middleware/theme-page-preview.ts` gives for why a themed
 * preview has to be a real URL rather than posted into a `srcDoc` sandbox: the rendered HTML's asset
 * paths are root-relative to `/theme-assets/{themeId}/...`, which only resolves correctly when the
 * browser believes it's looking at a real page, not an inline document).
 */

/** Same minimal "is this a JSON object, not an array/primitive/null" shape check
 * `features/post/post.ts`'s own private `isJsonObject` and `Jini/packages/cms/src/widgets/resolver-service.ts`'s
 * `isPlainObject` use — kept as a separate local copy rather than importing either (neither is
 * exported, and this module already avoids reaching into `features/post`'s internals beyond its
 * published surface). Guards the POST body's `bodyJson` field: a malformed value (string, array,
 * `null`) is rejected here rather than handed to `renderViaTemplate`/`renderDocNode`, which expect an
 * actual TipTap document shape — same defensive shape check `updatePost`'s own `isJsonObject` applies
 * to a SAVED body, just re-applied here for a PENDING one (never persisted either way). */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extracts a validated pending-body override from `req.body.bodyJson`, accepting it in either shape a
 * real caller can produce (see this file's header for why both transports are supported): already a
 * parsed object (`express.json()` — a `fetch`-style JSON POST), or a JSON-stringified STRING
 * (`express.urlencoded()` — a classic `<form>` submit, where every field is a string regardless of
 * what it encodes). A `JSON.parse` failure on the string form, or any other shape (number, boolean,
 * array, already-invalid parsed object), returns `undefined` — the same "malformed input degrades to
 * the saved-body render, never a 400/crash" contract this file's read-only-preview reasoning states
 * elsewhere, since this endpoint has nothing to reject a bad request FOR (it writes nothing).
 */
function extractPendingBodyJson({ body }: { body: unknown }, _options: Record<string, never> = {}): JsonObject | undefined {
  if (!isJsonObject(body)) return undefined;
  const raw = body.bodyJson;
  if (isJsonObject(raw)) return raw;
  if (typeof raw === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    return isJsonObject(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Extracts a validated pending-body override from `req.body.bodyHtml` — the `"html"`-format
 * counterpart to {@link extractPendingBodyJson}, above. Simpler than that one: a plain HTML string
 * arrives identically from either transport (`express.json()`'s parsed field or
 * `express.urlencoded()`'s form field are both already strings here — there is no JSON-stringified
 * intermediate shape to `JSON.parse`, unlike a TipTap document). Any non-string value (missing,
 * number, object, array) returns `undefined` — the same "malformed input degrades to the saved-body
 * render, never a 400/crash" contract {@link extractPendingBodyJson} follows, since this endpoint
 * writes nothing and so has nothing to reject a bad request FOR.
 */
function extractPendingBodyHtml({ body }: { body: unknown }, _options: Record<string, never> = {}): string | undefined {
  if (!isJsonObject(body)) return undefined;
  const raw = body.bodyHtml;
  return typeof raw === "string" ? raw : undefined;
}

/**
 * Tri-state query contract, matching `templateChoice`'s own tri-state (see `resolveTemplate`'s
 * doc): the key absent entirely means "never chosen" (`null`), present but empty
 * (`?templateChoice=`) means the explicit "No template chosen" opt-out (`""`), present with a
 * value means that template filename. The admin client always sends one of the first two shapes
 * explicitly — see `templatePreviewUrl` in `apps/admin/src/lib/api.ts`.
 *
 * @complexity O(1).
 */
function resolveOverrideTemplateChoice({ rawTemplateChoice }: { rawTemplateChoice: unknown }, _options: Record<string, never> = {}): string | null {
  return rawTemplateChoice === undefined ? null : String(rawTemplateChoice);
}

/** The preview is author-controlled HTML served from the admin origin. The editors' iframe already
 *  sandboxes it (`PAGE_PREVIEW_IFRAME_SANDBOX`, `apps/admin/src/features/pages/rules.ts`); this header
 *  applies the same flags when the URL is opened on its own, as a top-level tab. Never
 *  `allow-same-origin`: with it, a preview's script could call admin APIs with the session cookie. */
const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-popups";

/** What the host injects. Methods, so the host binds its own post and renderer types; the render-error classes stay
 *  host-side (the renderer is host code), recognised through the two predicates. */
export interface TemplatePreviewRouteDeps<Post = unknown> {
  readonly workspaceId: string;
  /** Looks the row up by id, any status (the host's `getAdminPostByIdOrSlug`). */
  getPost(required: { workspaceId: string; idOrSlug: string }): Promise<{ post: Post }>;
  /** Renders `post` through the pending template choice and pending body (the host's `renderPostPreview`); nothing is persisted. */
  renderPreview(required: { post: Post; templateChoice: string | null; bodyJson: JsonObject | undefined; bodyHtml: string | undefined }): Promise<{ html: string }>;
  /** The host's render failure, with the status and plain-words message it answers; `undefined` for any other error. */
  renderFailure(required: { error: unknown }): { status: number; message: string } | undefined;
  /** Whether `error` is the host's post-not-found error (answered 404 with its own message). */
  isNotFound(required: { error: unknown }): boolean;
}

type TemplatePreviewHandleArgs<Post> = { readonly raw: RawRouteInputContext; readonly deps: TemplatePreviewRouteDeps<Post>; readonly context: unknown; readonly authorize: JsonRouteAuthorize };

/** The server-neutral raw route (K1 §9.3), structurally an http-kit `RawRouteSpec`. */
export interface TemplatePreviewRoute {
  readonly method: "get" | "post";
  readonly path: string;
  readonly bufferedReply: true;
  handle(required: TemplatePreviewHandleArgs<unknown>, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

const PATH = "/api/admin/v1/workspaces/:workspaceId/posts/:postId/template-preview";
const PLAIN_TEXT = "text/plain; charset=utf-8";

/** A `text/plain` answer, as `res.status(s).type("text/plain").send(text)` wrote it. @complexity O(n) in the text. */
function plainText({ status, text }: { status: number; text: string }, _optional: Record<string, never> = {}): Response {
  return new Response(text, { status, headers: { "Content-Type": PLAIN_TEXT } });
}

/**
 * `GET`/`POST .../posts/:postId/template-preview`: `content.read` (guarded by the host mount), the row by id, then the
 * preview html. The host's render failure and not-found answer `text/plain`; anything else is rethrown to the host's
 * failure writer. One handler serves both verbs (a `GET` carries no body, so no pending body).
 * @complexity O(1) plus the lookup, the render and the body extraction.
 */
async function handlePreviewRequest(
  { raw, deps, authorize }: TemplatePreviewHandleArgs<unknown>,
  _optional: { readonly signal: AbortSignal },
): Promise<Response> {
  await authorize({ permission: "content.read" });
  try {
    const { post } = await deps.getPost({ workspaceId: deps.workspaceId, idOrSlug: String(raw.params.postId ?? "") });
    const overrideTemplateChoice = resolveOverrideTemplateChoice({ rawTemplateChoice: raw.query.templateChoice });
    // Pending body override (2026-08-12) — POST-only. `raw.body` is parsed by whichever of the host's JSON parser or
    // this route's own urlencoded parser matched the request's `Content-Type`; a `GET` request never carries a body,
    // so it is empty there and `pendingBodyJson` stays `undefined` — the exact "byte-identical to before this
    // existed" behavior this file's header promises for `GET`.
    const pendingBodyJson = extractPendingBodyJson({ body: raw.body });
    const pendingBodyHtml = extractPendingBodyHtml({ body: raw.body });
    const { html } = await deps.renderPreview({ post, templateChoice: overrideTemplateChoice, bodyJson: pendingBodyJson, bodyHtml: pendingBodyHtml });
    // Never cached: re-requested on every template selection, and a cached response would show
    // the operator a stale template and read as "the picker did nothing" — the exact bug this
    // route exists to fix (mirrors the theme page preview's identical no-store rule).
    return new Response(html, { status: 200, headers: { "Cache-Control": "no-store", "Content-Security-Policy": PREVIEW_CSP, "Content-Type": "text/html; charset=utf-8" } });
  } catch (error) {
    const failure = deps.renderFailure({ error });
    if (failure) return plainText({ status: failure.status, text: failure.message });
    if (deps.isNotFound({ error })) return plainText({ status: 404, text: (error as Error).message });
    throw error;
  }
}

// The two specs share one handle. `express.urlencoded` is scoped to the POST registration only (the host mount's
// `bodyParsers`) so a classic `<form method="post" target="{iframe}">` submit, which browsers always encode as
// `application/x-www-form-urlencoded`, populates the body too; a `fetch`-style JSON POST still works unchanged through
// the host's JSON parser. Express dispatches to whichever parser matches the request's actual `Content-Type`, so
// mounting both is additive, never a double-parse of the same request.
const handle = handlePreviewRequest;

/** `GET .../template-preview` — template-choice-only preview. */
export const templatePreviewGetRoute: TemplatePreviewRoute = { method: "get", path: PATH, bufferedReply: true, handle };

/** `POST .../template-preview` — preview through a pending template choice AND a pending body. */
export const templatePreviewPostRoute: TemplatePreviewRoute = { method: "post", path: PATH, bufferedReply: true, handle };
