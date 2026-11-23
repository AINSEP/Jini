import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { EntityNotLiveError } from "../../../core/entity-liveness.js";
import { RedirectConflictError, RedirectLoopError, RedirectTargetNotAllowedError, RedirectValidationError } from "../../../redirects/index.js";

/**
 * @file Shared error-response mapping and guards for the `redirects` admin route specs.
 *
 * `create` and `update` each map the same four write-chokepoint error classes onto the same
 * status/code pairs, in their own repeated `if (err instanceof X) {...}` chain. Factored out once
 * both needed it; `update` also has `RedirectNotFoundError`, which it prepends itself since
 * `create` (there is no existing redirect yet) never throws it.
 */

/** The principal fields these routes read: only the id, as the write chokepoint's `actorId`. */
export interface RedirectRoutePrincipal { id: string }

/** One entry in a redirects route's `catch` block: which thrown error class maps to which HTTP
 *  status/code pair. */
export interface RedirectErrorMapping {
  readonly matches: (required: { err: unknown }, optional?: Record<string, never>) => boolean;
  readonly status: number;
  readonly code: string;
}

/**
 * The first matching mapping's status/code with the error's own message, or `undefined` when none
 * match (the caller then treats it as an unexpected failure).
 *
 * @complexity O(n) in the mapping table length, which is a small fixed list per caller.
 */
export function matchRedirectError(
  { err, mappings }: { err: unknown; mappings: readonly RedirectErrorMapping[] },
  _options: Record<string, never> = {},
): { status: number; error: string; code: string } | undefined {
  const mapping = mappings.find((candidate) => candidate.matches({ err }));
  if (!mapping) return undefined;
  return { status: mapping.status, error: err instanceof Error ? err.message : String(err), code: mapping.code };
}

/**
 * Refuses with the first matching mapping's `{ error, code }` at its status; anything unmapped is
 * rethrown unchanged so the host's error port answers it as an unexpected failure.
 *
 * @complexity O(n) in the mapping table length.
 */
export function rejectRedirectError({ err, mappings }: { err: unknown; mappings: readonly RedirectErrorMapping[] }, _options: Record<string, never> = {}): never {
  const refusal = matchRedirectError({ err, mappings });
  if (refusal) rejectRoute(refusal);
  throw err;
}

/** The write-chokepoint errors both `create` and `update` map identically. */
export const REDIRECT_WRITE_ERROR_MAPPINGS: readonly RedirectErrorMapping[] = [
  // S7 (web-high fix plan 2026-09-24) — first, ahead of the others: a rule in the Trash rejects
  // with a fixed code regardless of which OTHER field the caller tried to change. Redirects are
  // never tombstoned-state (only `EntityLiveness`'s "trashed"), so one fixed code is complete here.
  { matches: ({ err }, _options = {}) => err instanceof EntityNotLiveError, status: 409, code: "ENTITY_IN_TRASH" },
  { matches: ({ err }, _options = {}) => err instanceof RedirectValidationError, status: 400, code: "REDIRECT_VALIDATION_ERROR" },
  { matches: ({ err }, _options = {}) => err instanceof RedirectTargetNotAllowedError, status: 400, code: "REDIRECT_TARGET_NOT_ALLOWED" },
  { matches: ({ err }, _options = {}) => err instanceof RedirectConflictError, status: 409, code: "REDIRECT_CONFLICT" },
  { matches: ({ err }, _options = {}) => err instanceof RedirectLoopError, status: 409, code: "REDIRECT_LOOP_DETECTED" },
];

/**
 * Every redirects admin route is gated by `admin.redirects.manage` on the `redirect` entity type.
 * The host injects `authorize`; a mount without one is a wiring bug, not a caller error.
 * By-id routes (get, hits, update, tombstone) pass the requested `entityId` so the host's
 * authorizer decides for that rule; list and import act on no single rule and stay id-free.
 *
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeRedirectsManage({ authorize }: { authorize: JsonRouteAuthorize | undefined }, optional: JsonRouteAuthorizeScope = {}): Promise<void> {
  if (!authorize) throw new Error("redirects admin route has no authorizer");
  const required = { permission: "admin.redirects.manage", entityType: "redirect" };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/**
 * The authenticated principal's id, recorded as the write's `actorId`.
 *
 * @complexity O(1).
 */
export function redirectActorId({ context }: { context: RedirectRoutePrincipal | undefined }, _options: Record<string, never> = {}): string {
  if (!context) throw new Error("redirects admin route has no authenticated principal");
  return context.id;
}
