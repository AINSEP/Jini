import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { entityNotLiveResponse } from "../../http/entity-not-live.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";

/**
 * @file Shared guards and error-response mapping for the `menus` admin route specs.
 *
 * Each menus route maps the navigation service's thrown errors onto `{ error }` bodies (most
 * without a `code`) in its own `if (err instanceof X) {...}` chain; the chains differ per route,
 * so each route keeps its own ordered table and this file only runs it.
 */

/** The principal fields these routes read: only the id, as the trash move's actor. */
export interface MenuRoutePrincipal { id: string }

/** The refusal a matched error becomes: its status and the flat `{ error, code? }` body. */
export interface MenuErrorRefusal { status: number; error: string; code?: string }

/** One entry in a menus route's `catch` table: the refusal a thrown error maps to, or `null`. The
 *  table is module-level, so the host's `outwardErrorMessage` arrives at handling time. */
export type MenuErrorMapping = (required: { err: unknown; outwardErrorMessage: OutwardErrorMessage }, optional?: Record<string, never>) => MenuErrorRefusal | null;

/**
 * Maps one error class to a status (and optional code) carrying the host's outward message for it.
 *
 * @complexity O(1).
 */
export function mapMenuError(
  { errorClass, status, code }: { errorClass: abstract new (...args: never[]) => Error; status: number; code?: string },
  _options: Record<string, never> = {},
): MenuErrorMapping {
  return ({ err, outwardErrorMessage }) => (err instanceof errorClass ? { status, error: outwardErrorMessage({ error: err }), ...(code === undefined ? {} : { code }) } : null);
}

/** A trashed menu: the 409 `entityNotLiveResponse` writes, with the error's own code and the host's
 *  outward message. */
export const MENU_NOT_LIVE_MAPPING: MenuErrorMapping = ({ err, outwardErrorMessage }) => {
  const live = entityNotLiveResponse({ err, outwardErrorMessage });
  return live ? { status: live.status, ...live.body } : null;
};

/**
 * Refuses with the first matching mapping; anything unmapped is rethrown unchanged so the host's
 * error port answers it as an unexpected failure.
 *
 * @complexity O(n) in the mapping table length, a small fixed list per route.
 */
export function rejectMenuError(
  { err, mappings, outwardErrorMessage }: { err: unknown; mappings: readonly MenuErrorMapping[]; outwardErrorMessage: OutwardErrorMessage },
  _options: Record<string, never> = {},
): never {
  for (const mapping of mappings) {
    const refusal = mapping({ err, outwardErrorMessage });
    if (refusal) rejectRoute(refusal);
  }
  throw err;
}

/**
 * Every menus admin route is gated by one `admin.menus.*` permission on the `menu` entity type.
 * The host injects `authorize`; a mount without one is a wiring bug, not a caller error. By-id
 * routes pass the requested `entityId`; list and create act on no single menu and stay id-free.
 *
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeMenus(
  { authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("menus admin route has no authorizer");
  const required = { permission, entityType: "menu" };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/**
 * The authenticated principal's id, recorded as the write's actor.
 *
 * @complexity O(1).
 */
export function menuActorId({ context }: { context: MenuRoutePrincipal | undefined }, _options: Record<string, never> = {}): string {
  if (!context) throw new Error("menus admin route has no authenticated principal");
  return context.id;
}

/** The `:menuId` path param; `?? ""` keeps a hand-built request without it on the ordinary not-found. */
export function menuIdParam({ params }: { params: Record<string, string> }, _options: Record<string, never> = {}): string {
  return String(params.menuId ?? "");
}
