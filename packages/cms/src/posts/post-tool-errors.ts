import { ForbiddenError } from "../core/index.js";
import { forbiddenRule, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import { PostValidationError, PostVersionConflictError, PostConflictError, PostNotFoundError } from "./post.js";
import { VERSION_CONFLICT_CODE } from "./expected-version.js";

/**
 * The only Posts/Pages rejection worth decorating with the published schema: `bodyJson`/`title`/
 * `slug`/`status` SHAPE problems (`PostValidationError`). A `PostNotFoundError` (including the
 * disclosed kind-mismatch 404) or a `PostConflictError` (slug taken) is not a shape problem —
 * retrying the SAME input would never resolve either.
 */
export function isPostShapeRejection({ error }: { error: unknown }, _optional: Record<string, never> = {}): boolean {
  return error instanceof PostValidationError;
}

/** Appended to a version conflict so the model knows the write did NOT happen and what to do next —
 *  a bare "expected version 1, current version 2" reads as an internal detail, not an instruction. */
const VERSION_CONFLICT_GUIDANCE =
  "Someone else saved this post after you read it, so your edit was NOT applied and nothing was overwritten. " +
  "Re-read the post with content_post_get, reapply your change on top of the body you get back, and resend with " +
  "that row's `version` as `expectedVersion`. Do not resend this call unchanged.";

/**
 * The Posts/Pages errors that reach the model with their real reason instead of a redacted
 * `INTERNAL_ERROR` — see `contracts/core/model-facing-tool-errors.ts` for the mechanism, for why a
 * whole-map wrap is used rather than a per-call-site reshape, and for why this list is an
 * ALLOWLIST: anything unlisted is returned unchanged and stays redacted.
 *
 * This replaces a `toModelFacingUpdateError` helper that handled exactly one class and was wired at
 * exactly one of six handlers — the correct-primitive/unwired-call-site shape this codebase keeps
 * reproducing. `content_post_delete`'s own version re-check threw the SAME class through an
 * unwrapped arm, so the identical conflict was actionable from update and a bare 500 from delete.
 *
 * ORDER IS LOAD-BEARING. `PostVersionConflictError extends PostConflictError` (deliberately — see
 * `post.ts`'s class doc for why that subclassing made the optimistic-concurrency guard additive at
 * every existing 409 call site), and `reclassifyToolError` takes the FIRST `instanceof` match.
 * Listed the other way round, every version conflict would be answered by the generic
 * slug-conflict arm and would lose the one thing the model most needs to hear — that its edit did
 * NOT land and that re-reading the row fixes it. Pinned directly by
 * `__tests__/tool-registrations.model-facing-errors.test.ts`'s ordering case.
 *
 * `VERSION_CONFLICT` keeps its bare, un-prefixed code on purpose: it is the shared discriminator
 * `entries/` and `content-types/` already publish for the identical condition
 * (`expected-version.ts`), a client branches on it, and
 * `__tests__/tool-registrations.optimistic-concurrency.test.ts` pins the exact wire message
 * byte-for-byte. The rest take a `CONTENT_POST_` prefix rather than `POST_` so the token names the
 * tool family the model actually calls (`content_post_update`, `content_read.content_post`) instead
 * of reading as the HTTP verb.
 *
 * `PostValidationError` is listed even though `content_post_search`/`_create`/`_update` already
 * convert it into a schema-decorated `ToolInputError` via `withSchemaOnRejection`: that decoration
 * covers three of the six handlers, and `reclassifyToolError` returns an already-`ToolInputError`
 * rejection untouched, so listing it here adds the real reason to the other three WITHOUT touching
 * the decorated ones or double-prefixing them.
 *
 * On disclosure: every message these classes carry is built from the caller's own input and this
 * domain's own vocabulary — an id or slug the caller itself sent, a field name, two version
 * integers, a reserved slug, or (for `ForbiddenError`) the permission string plus the `authorize()`
 * reason. Checked at each construction site rather than assumed (`post.ts` 473 / 720-766 / 825 /
 * 898-932 / 952 / 1003-1004 / 1055 / 1220-1294, `search.ts` 247 & 253, `expected-version.ts` 52,
 * and this file's own four throws): none interpolates post body content, a member or subscriber
 * email, a token, a SQL fragment, or an internal filesystem path.
 */
export const POST_MODEL_FACING_ERRORS: readonly ModelFacingErrorRule[] = [
  // FIRST, and it must stay first — the subclass ahead of its superclass. See this list's doc.
  { error: PostVersionConflictError, code: VERSION_CONFLICT_CODE, guidance: VERSION_CONFLICT_GUIDANCE },
  { error: PostConflictError, code: "CONTENT_POST_CONFLICT" },
  { error: PostNotFoundError, code: "CONTENT_POST_NOT_FOUND" },
  { error: PostValidationError, code: "CONTENT_POST_VALIDATION_FAILED" },
  forbiddenRule({ domainPrefix: "CONTENT_POST", error: ForbiddenError }),
];
