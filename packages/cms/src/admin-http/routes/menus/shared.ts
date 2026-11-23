import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { EntityNotLiveError } from "../../../core/entity-liveness.js";
import {
  isMenuHtmlAuthoring, MenuConflictError, MenuNotFoundError, MenuValidationError, MenuVersionConflictError,
  type MenuHtmlAuthoring,
} from "../../../navigation/index.js";

/**
 * @file Shared guards and error mapping for the `menus` admin route specs.
 *
 * Each hand-written menus route had its own `if (err instanceof X) res.status(...)` ladder. The
 * specs keep each route's exact ladder as a small mapping table (a route maps only the classes it
 * always mapped — e.g. `create` never mapped a trashed menu), and the host's `onError` port writes
 * the thrown refusal flat, so every body stays byte-identical to what the admin client reads.
 */

/** The principal fields these routes read: only the id, as the trash move's actor. */
export interface MenuRoutePrincipal { id: string }

/** One `catch` rung: which thrown error maps to which status, and whether the body carries a code. */
export interface MenuErrorMapping {
  readonly matches: (required: { err: unknown }, optional?: Record<string, never>) => boolean;
  readonly status: number;
  /** A fixed code, or `"own"` for the error's own `code` field (the trashed/tombstoned pair). */
  readonly code?: string | "own";
}

/** A trashed or tombstoned menu: 409 with the liveness error's own code (`entityNotLiveResponse`'s rule). */
export const MENU_NOT_LIVE: MenuErrorMapping = { matches: ({ err }, _o = {}) => err instanceof EntityNotLiveError, status: 409, code: "own" };
export const MENU_VALIDATION: MenuErrorMapping = { matches: ({ err }, _o = {}) => err instanceof MenuValidationError, status: 400 };
/** Before {@link MENU_CONFLICT}: the compare-and-set loss extends `MenuConflictError` and must keep its code. */
export const MENU_VERSION_CONFLICT: MenuErrorMapping = { matches: ({ err }, _o = {}) => err instanceof MenuVersionConflictError, status: 409, code: "VERSION_CONFLICT" };
export const MENU_CONFLICT: MenuErrorMapping = { matches: ({ err }, _o = {}) => err instanceof MenuConflictError, status: 409 };
export const MENU_NOT_FOUND: MenuErrorMapping = { matches: ({ err }, _o = {}) => err instanceof MenuNotFoundError, status: 404 };

/**
 * Refuses with the first matching rung's status and the error's own message; anything unmapped is
 * rethrown unchanged so the host's error port answers it as an unexpected (redacted) failure.
 * @complexity O(n) in the mapping table length, a small fixed list per route.
 */
export function rejectMenuError({ err, mappings }: { err: unknown; mappings: readonly MenuErrorMapping[] }, _optional: Record<string, never> = {}): never {
  const mapping = mappings.find((candidate) => candidate.matches({ err }));
  if (!mapping) throw err;
  const error = err instanceof Error ? err.message : String(err);
  const code = mapping.code === "own" ? (err as { code?: string }).code : mapping.code;
  rejectRoute(code === undefined ? { status: mapping.status, error } : { status: mapping.status, error, code });
}

/**
 * Asks the host for one `admin.menus.*` permission on the `menu` entity type. By-id routes pass the
 * requested `entityId` so the host decides for that menu; list and create act on no single menu.
 * A mount without an authorizer is a wiring bug, not a caller error, so it fails closed.
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
 * Menu HTML is trusted raw markup, so a write carrying it also needs the host's raw-HTML permission
 * (injected: which permission guards raw HTML is the host's policy, not the engine's). Switching
 * back to items authors nothing and passes without asking.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeMenuHtml(
  { authorize, permission, authoring }: { authorize: JsonRouteAuthorize | undefined; permission: string; authoring: MenuHtmlAuthoring },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!isMenuHtmlAuthoring(authoring)) return;
  await authorizeMenus({ authorize, permission }, optional);
}

/** The authenticated principal's id, recorded as the actor of a trash move. @complexity O(1). */
export function menuActorId({ context }: { context: MenuRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("menus admin route has no authenticated principal");
  return context.id;
}

/** The `:menuId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function menuIdParam({ params }: { params: Record<string, string | undefined> }, _optional: Record<string, never> = {}): string {
  return String(params.menuId ?? "");
}
