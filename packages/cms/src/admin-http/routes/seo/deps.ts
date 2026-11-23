import { ok, type JsonRouteAuthorize, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { SeoEntryNotFoundError, type GetEntryMetaDeps } from "../../../seo/index.js";

/**
 * @file The deps and guards the SEO admin route specs share (SPEC-008 SEO).
 *
 * Each route names its own small deps type (`SeoGetEntryRouteDeps`, `SeoPutEntryRouteDeps`, …)
 * built from the bases below; the host builds that object from its own composition at
 * registration and never passes its whole route bag. Workspace scoping, the session principal,
 * the 403 body and the unexpected-failure 500 are host ports, not code here.
 */

/** The principal fields these routes read: only the id, as the write chokepoint's caller. */
export interface SeoRoutePrincipal { id: string }

/** Every SEO route awaits the host's SEO readiness (setting definitions registered) first. */
export interface SeoRouteBaseDeps {
  workspaceId: string;
  seoReady: PromiseLike<unknown>;
}

/** The entry read routes (get-entry, analyze) read one entry's meta through the host's SEO bindings. */
export interface SeoEntryReadRouteDeps extends SeoRouteBaseDeps {
  seoDeps: GetEntryMetaDeps;
}

/** The by-entry routes' input: the `:entryId` path segment. */
export interface SeoEntryRouteInput { entryId: string }

/**
 * Reads `:entryId`; a missing segment is the empty id, which no real entry has, so it surfaces
 * as the read's own 404 rather than a separate parse failure (same as before the move).
 * @complexity O(1).
 */
export function parseSeoEntryId(raw: RouteInputContext, _optional: Record<string, never> = {}) {
  return ok({ value: { entryId: String(raw.params.entryId ?? "") } satisfies SeoEntryRouteInput });
}

/**
 * Every SEO admin route is gated by `admin.seo.manage`. The host injects `authorize`; a mount
 * without one is a wiring bug, not a caller error. Entry routes pass the requested `entityId`
 * (even an empty one, as the hand-written routes did); the sitemap route acts on no single entry.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeSeoManage(
  { authorize, entityType }: { authorize: JsonRouteAuthorize | undefined; entityType: "seo-entry" | "seo-sitemap" },
  optional: { entityId?: string } = {},
): Promise<void> {
  if (!authorize) throw new Error("SEO admin route has no authorizer");
  const required = { permission: "admin.seo.manage", entityType };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/**
 * The authenticated principal's id, recorded as the SEO write's caller.
 * @complexity O(1).
 */
export function seoCallerId({ context }: { context: SeoRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("SEO admin route has no authenticated principal");
  return context.id;
}

/**
 * An unknown entry answers 404 `SEO_ENTRY_NOT_FOUND` with the error's own message; anything else is
 * rethrown unchanged so the host's error port answers it as an unexpected failure.
 * @complexity O(1).
 */
export function rejectSeoEntryNotFound({ err }: { err: unknown }, _optional: Record<string, never> = {}): never {
  if (err instanceof SeoEntryNotFoundError) rejectRoute({ status: 404, error: err.message, code: "SEO_ENTRY_NOT_FOUND" });
  throw err;
}
