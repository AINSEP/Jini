import { EntityNotLiveError } from "../../core/index.js";
import type { OutwardErrorMessage } from "./outward-error-message.js";

/**
 * @file S4 (web-high fix plan, 2026-09-24) — the HTTP half of the generic entity-liveness guard.
 * Every admin-http route this plan touches (pages, SEO, redirects, media, content-types, taxonomy)
 * puts a call to {@link entityNotLiveResponse} first in its existing error ladder, so a writer's
 * `assertEntityLive` refusal (`@jini-ai/cms/core`) reaches the client as 409 `ENTITY_IN_TRASH` /
 * `ENTITY_TOMBSTONED` instead of falling through to a generic 500. Mirrors the `{status, body} |
 * null` shape `seoPutEntryErrorResponse` and friends already use, rather than writing to `res`
 * directly, so a route can call it first and fall through to its own remaining branches unchanged.
 */

/**
 * If `err` is an `EntityNotLiveError`, returns the 409 response envelope for it. Returns `null` for
 * any other error, so a route's own error mapper can call this first and keep going. The status and
 * `code` are the guard's classification; the outward `error` copy comes from the host's
 * `outwardErrorMessage` port, so the stored error text never leaves through engine code.
 * @complexity O(1).
 */
export function entityNotLiveResponse(
  { err, outwardErrorMessage }: { err: unknown; outwardErrorMessage: OutwardErrorMessage },
  _optional = {},
): { status: 409; body: { error: string; code: string } } | null {
  if (!(err instanceof EntityNotLiveError)) return null;
  return { status: 409, body: { error: outwardErrorMessage({ error: err }), code: err.code } };
}
