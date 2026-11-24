import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { createRedirect, type RedirectMatchType, type RedirectStatusCode, type RedirectsWriteDeps } from "../../../redirects/index.js";
import { toAdminRedirectResponse, type AdminRedirectResponse } from "../../http/redirects.js";
import {
  authorizeRedirectsManage, redirectActorId, rejectRedirectError, REDIRECT_WRITE_ERROR_MAPPINGS,
  type RedirectRoutePrincipal,
} from "./shared.js";

const VALID_MATCH_TYPES: ReadonlySet<string> = new Set(["exact", "prefix", "wildcard", "regex"]);
const VALID_STATUS_CODES: ReadonlySet<number> = new Set([301, 302, 307, 308]);

/** The deps this route reads. */
export interface RedirectCreateRouteDeps {
  workspaceId: string;
  redirectsWriteDeps: RedirectsWriteDeps;
}

/** This route's five body fields, validated and typed. */
export interface RedirectCreateInput {
  matchType: RedirectMatchType;
  fromPattern: string;
  toTarget: string;
  statusCode: RedirectStatusCode;
  override: boolean | undefined;
  priority: number | undefined;
}

/** Refuses with the 400 message for the first body violation, before any authorization, as the
 *  hand-written route did. @complexity O(1). */
function assertCreateBody({ body }: { body: Record<string, unknown> }, _options: Record<string, never> = {}): void {
  const refuse = (error: string): never => rejectRoute({ status: 400, error, code: "VALIDATION_ERROR" });
  if (!VALID_MATCH_TYPES.has(body.matchType as string)) refuse("matchType must be one of exact/prefix/wildcard/regex");
  if (typeof body.fromPattern !== "string" || typeof body.toTarget !== "string") refuse("fromPattern and toTarget are required strings");
  if (!VALID_STATUS_CODES.has(body.statusCode as number)) refuse("statusCode must be one of 301/302/307/308");
}

/** Reads the five body fields off an already-validated body; `override`/`priority` are kept only
 *  when they carry the right primitive type. @complexity O(1). */
function createInputFrom({ body }: { body: Record<string, unknown> }, _options: Record<string, never> = {}): RedirectCreateInput {
  return {
    matchType: body.matchType as RedirectMatchType,
    fromPattern: body.fromPattern as string,
    toTarget: body.toTarget as string,
    statusCode: body.statusCode as RedirectStatusCode,
    override: typeof body.override === "boolean" ? body.override : undefined,
    priority: typeof body.priority === "number" ? body.priority : undefined,
  };
}

/**
 * POST a new manual redirect rule (api.spec.md `CREATE_REDIRECT`). Gated by
 * `admin.redirects.manage`. `matchType:'regex'` is a valid request shape per
 * api.spec.md but is always rejected by the chokepoint (REQ-22) — mapped to
 * `REDIRECT_VALIDATION_ERROR` here, same as any other chokepoint validation
 * failure, not a route-level shape rejection.
 */
export const redirectCreateRoute = defineJsonRoute<RedirectCreateInput, AdminRedirectResponse, RedirectCreateRouteDeps, RedirectRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/redirects",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    assertCreateBody({ body });
    return ok({ value: createInputFrom({ body }) });
  },
  handle: async ({ input, deps, context, authorize }) => {
    const actorId = redirectActorId({ context });
    await authorizeRedirectsManage({ authorize });
    try {
      const { record } = await createRedirect({ deps: deps.redirectsWriteDeps, input: { workspaceId: deps.workspaceId, ...input, actorId } });
      return ok({ value: toAdminRedirectResponse(record) });
    } catch (err) {
      return rejectRedirectError({ err, mappings: REDIRECT_WRITE_ERROR_MAPPINGS });
    }
  },
}, { successStatus: 201 });
