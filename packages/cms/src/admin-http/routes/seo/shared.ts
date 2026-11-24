import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import { ToolInputError } from "@jini-ai/core";
import { RecordVersionConflictError, versionConflictBody } from "@jini-ai/core/optimistic-concurrency";
import { RouteRefusalError, rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { EntityNotLiveError } from "../../../core/entity-liveness.js";
import {
  SeoConcurrentWriteError, SeoEntryNotFoundError, SeoFieldValidationError, SeoInvalidCanonicalUrlError, SeoSettingsValidationError,
} from "../../../seo/errors.js";

/**
 * @file Shared guards and error mapping for the `seo` admin route specs.
 *
 * Every hand-written SEO route awaited the host's SEO readiness gate, then asked for
 * `admin.seo.manage` on one `seo-*` entity type, then mapped a short `instanceof` ladder. The specs
 * keep each route's exact ladder as a mapping table; unmapped errors are rethrown so the host's error
 * port answers its per-operation 500 copy, byte-identical to before.
 */

/** The principal fields these routes read: only the id, as the write chokepoints' caller. */
export interface SeoRoutePrincipal { id: string }

/** The one permission every SEO admin route asks for. */
export const SEO_MANAGE_PERMISSION = "admin.seo.manage";

/** One `catch` rung: which thrown error maps to which status and body. */
export interface SeoErrorMapping {
  readonly matches: (required: { err: unknown }, optional?: Record<string, never>) => boolean;
  readonly status: number;
  /** A fixed code, or `"own"` for the error's own `code` field (the trashed/tombstoned pair). */
  readonly code: string | "own";
}

/** Before {@link SEO_TOOL_INPUT}: `EntityNotLiveError` extends `ToolInputError`, so the generic 400 would swallow a trashed entry's 409. */
export const SEO_NOT_LIVE: SeoErrorMapping = { matches: ({ err }, _o = {}) => err instanceof EntityNotLiveError, status: 409, code: "own" };
export const SEO_TOOL_INPUT: SeoErrorMapping = { matches: ({ err }, _o = {}) => err instanceof ToolInputError, status: 400, code: "VALIDATION_ERROR" };
export const SEO_FIELD_VALIDATION: SeoErrorMapping = { matches: ({ err }, _o = {}) => err instanceof SeoFieldValidationError, status: 400, code: "SEO_FIELD_VALIDATION_ERROR" };
export const SEO_INVALID_CANONICAL: SeoErrorMapping = { matches: ({ err }, _o = {}) => err instanceof SeoInvalidCanonicalUrlError, status: 400, code: "SEO_INVALID_CANONICAL_URL" };
export const SEO_ENTRY_NOT_FOUND: SeoErrorMapping = { matches: ({ err }, _o = {}) => err instanceof SeoEntryNotFoundError, status: 404, code: "SEO_ENTRY_NOT_FOUND" };
// 409, not the generic 500: the request was well-formed and authorized, it simply lost the row to
// another writer three times running. Resending it is the correct next move, which is the one thing
// a 500 would not tell the caller (2026-09-07, fable bugs audit SEO-01).
export const SEO_CONCURRENT_WRITE: SeoErrorMapping = { matches: ({ err }, _o = {}) => err instanceof SeoConcurrentWriteError, status: 409, code: "SEO_CONCURRENT_WRITE" };
export const SEO_SETTINGS_VALIDATION: SeoErrorMapping = { matches: ({ err }, _o = {}) => err instanceof SeoSettingsValidationError, status: 400, code: "SEO_SETTINGS_VALIDATION_ERROR" };

/**
 * Refuses with the first matching rung's status and its message — always the host's required
 * `outwardErrorMessage` copy, so stored error text never leaves through engine code. A lost compare-and-set (`RecordVersionConflictError`) answers core's 409
 * version-conflict body when the route lists it in `versionConflict`; anything unmapped is rethrown unchanged for the host's 500.
 * @complexity O(n) in the mapping table length, a small fixed list per route.
 */
export function rejectSeoError(
  { err, mappings, outwardErrorMessage }: { err: unknown; mappings: readonly SeoErrorMapping[]; outwardErrorMessage: OutwardErrorMessage },
  optional: { versionConflictAfter?: SeoErrorMapping } = {},
): never {
  for (const mapping of mappings) {
    if (mapping.matches({ err })) {
      const code = mapping.code === "own" ? String((err as { code?: string }).code) : mapping.code;
      rejectRoute({ status: mapping.status, error: outwardErrorMessage({ error: err as Error }), code });
    }
    // The hand-written ladder checked the version conflict right after this rung; its body carries
    // the versions as `details`, which `rejectRoute`'s permission-shaped details cannot hold.
    if (mapping === optional.versionConflictAfter && err instanceof RecordVersionConflictError) {
      throw new RouteRefusalError({ status: 409, body: versionConflictBody({ error: err }) });
    }
  }
  throw err;
}

/**
 * Waits for the host's SEO readiness gate, then asks for `admin.seo.manage` on one `seo-*` entity
 * type. By-entry routes pass `entityId`; the settings and sitemap routes act on no single entity.
 * A mount without an authorizer is a wiring bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the readiness gate and the injected authorizer.
 */
export async function authorizeSeo(
  { authorize, ready, entityType }: { authorize: JsonRouteAuthorize | undefined; ready: PromiseLike<unknown>; entityType: string },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  // The hand-written routes awaited readiness before reading the session, so a request that
  // arrives during boot waits instead of being authorized against half-seeded settings.
  await ready;
  if (!authorize) throw new Error("seo admin route has no authorizer");
  const required = { permission: SEO_MANAGE_PERMISSION, entityType };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/** The authenticated principal's id, passed to the write chokepoints as their caller. @complexity O(1). */
export function seoActorId({ context }: { context: SeoRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("seo admin route has no authenticated principal");
  return context.id;
}

/** The `:entryId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function seoEntryIdParam({ params }: { params: Record<string, string | undefined> }, _optional: Record<string, never> = {}): string {
  return String(params.entryId ?? "");
}
