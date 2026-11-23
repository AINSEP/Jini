import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { RedirectNotFoundError, updateRedirect, type RedirectsWriteDeps, type UpdateRedirectInput } from "../../../redirects/index.js";
import { toAdminRedirectResponse, type AdminRedirectResponse } from "../../http/redirects.js";
import {
  authorizeRedirectsManage, redirectActorId, rejectRedirectError, REDIRECT_WRITE_ERROR_MAPPINGS,
  type RedirectErrorMapping, type RedirectRoutePrincipal,
} from "./shared.js";

const REDIRECT_UPDATE_ERROR_MAPPINGS: readonly RedirectErrorMapping[] = [
  { matches: ({ err }, _options = {}) => err instanceof RedirectNotFoundError, status: 404, code: "REDIRECT_NOT_FOUND" },
  ...REDIRECT_WRITE_ERROR_MAPPINGS,
];

/** The deps this route reads. */
export interface RedirectUpdateRouteDeps {
  workspaceId: string;
  redirectsWriteDeps: RedirectsWriteDeps;
}

/** The rule id plus the untyped PATCH body; the chokepoint validates each field it is handed. */
export interface RedirectUpdateInput { id: string; body: Record<string, unknown> }

/**
 * The PATCH body's fields as the chokepoint input; `override`/`priority` are kept only when they
 * carry the right primitive type.
 *
 * @complexity O(1).
 */
function updateInputFrom({ workspaceId, input, actorId }: { workspaceId: string; input: RedirectUpdateInput; actorId: string }, _options: Record<string, never> = {}): UpdateRedirectInput {
  const body = input.body;
  return {
    workspaceId,
    id: input.id,
    matchType: body.matchType as UpdateRedirectInput["matchType"],
    fromPattern: body.fromPattern as UpdateRedirectInput["fromPattern"],
    toTarget: body.toTarget as UpdateRedirectInput["toTarget"],
    statusCode: body.statusCode as UpdateRedirectInput["statusCode"],
    status: body.status as UpdateRedirectInput["status"],
    override: typeof body.override === "boolean" ? body.override : undefined,
    priority: typeof body.priority === "number" ? body.priority : undefined,
    actorId,
  };
}

/**
 * PATCH mutable fields on an existing redirect rule (api.spec.md
 * `UPDATE_REDIRECT`). All body fields optional. Gated by `admin.redirects.manage`.
 */
export const redirectUpdateRoute = defineJsonRoute<RedirectUpdateInput, AdminRedirectResponse, RedirectUpdateRouteDeps, RedirectRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/redirects/:id",
  parse: (raw) => ok({ value: { id: String(raw.params.id ?? ""), body: (raw.body ?? {}) as Record<string, unknown> } }),
  handle: async ({ input, deps, context, authorize }) => {
    const actorId = redirectActorId({ context });
    await authorizeRedirectsManage({ authorize }, { entityId: input.id });
    try {
      const { record } = await updateRedirect({ deps: deps.redirectsWriteDeps, input: updateInputFrom({ workspaceId: deps.workspaceId, input, actorId }) });
      return ok({ value: toAdminRedirectResponse(record) });
    } catch (err) {
      return rejectRedirectError({ err, mappings: REDIRECT_UPDATE_ERROR_MAPPINGS });
    }
  },
});
