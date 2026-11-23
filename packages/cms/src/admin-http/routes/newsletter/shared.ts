import { ToolInputError } from "@jini-ai/core";
import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute, RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { NewsletterEntityType, NewsletterErrorMapper } from "../../http/newsletter.js";

/**
 * @file Shared admission, parameter and error rules for the `newsletter` admin route specs.
 *
 * Every hand-written newsletter route had the same shape: permission check, `await
 * deps.newsletterReady`, the work, and one `catch` that sent typed domain errors through the
 * host's error table and everything else to the redacted 500. The specs keep that shape:
 * {@link admitNewsletterRequest} is the first two steps, {@link runNewsletterRoute} is the `catch`.
 */

/** The principal fields these routes read: only the id, as the actor of a campaign write. */
export interface NewsletterRoutePrincipal { id: string }

/** The fields every newsletter route reads besides its own collaborators. */
export interface NewsletterRouteBaseDeps {
  workspaceId: string;
  /** The host's boot promise for its newsletter tables; awaited after the permission check, never before. */
  newsletterReady: PromiseLike<unknown>;
  /** The host's typed-error table (see {@link NewsletterErrorMapper}). */
  mapNewsletterError: NewsletterErrorMapper;
}

/**
 * Asks the host for one `admin.newsletter.*` permission on a newsletter entity type. No
 * `entityId` is ever sent, even on by-id routes: the hand-written guard
 * (`requireNewsletterPermissionOrRespond`) never passed one, and adding it would change what the
 * host's authorizer decides on. A mount without an authorizer is a wiring bug, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeNewsletter(
  { authorize, permission, entityType }: { authorize: JsonRouteAuthorize | undefined; permission: string; entityType: NewsletterEntityType },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("newsletter admin route has no authorizer");
  await authorize({ permission, entityType });
}

/**
 * The permission check, then the boot-readiness wait — in that order, so a refused caller never
 * waits on (or learns about) the host's table migrations.
 * @complexity O(1) plus the injected authorizer and the readiness promise.
 */
export async function admitNewsletterRequest(
  { authorize, permission, entityType, deps }: {
    authorize: JsonRouteAuthorize | undefined; permission: string; entityType: NewsletterEntityType; deps: Pick<NewsletterRouteBaseDeps, "newsletterReady">;
  },
  _optional: Record<string, never> = {},
): Promise<void> {
  await authorizeNewsletter({ authorize, permission, entityType });
  await deps.newsletterReady;
}

/** The authenticated principal's id, recorded as a campaign write's actor. @complexity O(1). */
export function newsletterActorId({ context }: { context: NewsletterRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("newsletter admin route has no authenticated principal");
  return context.id;
}

/** The `:id` path segment. `String(...)` with no `?? ""`: the hand-written routes read
 *  `String(req.params.id)`, and Express always fills a declared segment. @complexity O(1). */
export function newsletterIdParam(params: Record<string, string | undefined>): string {
  return String(params.id);
}

/**
 * Refuses with the host mapper's exact status and body; anything the mapper does not own is
 * rethrown unchanged so the host's failure port answers it as an unexpected (redacted) failure.
 * A refusal the route already raised (the 403, a 404, a 400) is passed through untouched — it is
 * already the answer, and the host mapper must never get a chance to rewrite it.
 * @complexity O(1) plus the injected mapper.
 */
export function rejectNewsletterError({ err, mapError }: { err: unknown; mapError: NewsletterErrorMapper }, _optional: Record<string, never> = {}): never {
  if (err instanceof RouteRefusalError) throw err;
  const mapped = mapError({ err });
  if (!mapped) throw err;
  throw new RouteRefusalError({ status: mapped.status, body: mapped.body });
}

/**
 * Runs one route body under the newsletter `catch`. `listPaging` routes (list-campaigns,
 * list-send-log) also answered a malformed `limit`/`cursor` (`ToolInputError` from the shared
 * list-page helpers, or from a repo decoding the cursor) as their own 400; no other route did, so
 * for them it stays an unexpected failure.
 * @complexity O(1) around `run`.
 */
export async function runNewsletterRoute<T>(
  { mapError, run }: { mapError: NewsletterErrorMapper; run: () => Promise<T> },
  { listPaging = false }: { listPaging?: boolean } = {},
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (listPaging && err instanceof ToolInputError) rejectRoute({ status: 400, error: err.message, code: "VALIDATION_ERROR" });
    return rejectNewsletterError({ err, mapError });
  }
}
