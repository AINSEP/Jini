import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { importRedirects, type CreateRedirectInput, type RedirectsWriteDeps } from "../../../redirects/index.js";
import { toAdminRedirectImportResponse, type AdminRedirectImportResponse } from "../../http/redirects.js";
import { authorizeRedirectsManage, redirectActorId, type RedirectRoutePrincipal } from "./shared.js";

const MAX_IMPORT_BATCH_SIZE = 500;

/** The deps this route reads. */
export interface RedirectImportRouteDeps {
  workspaceId: string;
  redirectsWriteDeps: RedirectsWriteDeps;
}

/**
 * POST a batch of redirect rules through the standard chokepoint
 * (api.spec.md `IMPORT_REDIRECTS`, REQ-26). Always 207 Multi-Status — a
 * per-item failure never aborts the batch (each item goes through the same
 * `createRedirect` validation individually, EC-08). A malformed top-level
 * batch shape (not an array, or outside 1-500 items) is the only case that
 * gets a top-level 400 `VALIDATION_ERROR`. Gated by `admin.redirects.manage`.
 */
export const redirectImportRoute = defineJsonRoute<{ rules: unknown[] }, AdminRedirectImportResponse, RedirectImportRouteDeps, RedirectRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/redirects/import",
  parse: (raw) => {
    const rules = (raw.body as { rules?: unknown } | undefined)?.rules;
    if (!Array.isArray(rules) || rules.length < 1 || rules.length > MAX_IMPORT_BATCH_SIZE) {
      rejectRoute({ status: 400, error: `rules must be an array of 1-${MAX_IMPORT_BATCH_SIZE} items`, code: "VALIDATION_ERROR" });
    }
    return ok({ value: { rules } });
  },
  handle: async ({ input, deps, context, authorize }) => {
    const actorId = redirectActorId({ context });
    await authorizeRedirectsManage({ authorize });
    // Each item is validated by the chokepoint itself (EC-08), so the untyped body items pass through as-is.
    const result = await importRedirects({
      deps: deps.redirectsWriteDeps,
      input: { workspaceId: deps.workspaceId, actorId, rules: input.rules as CreateRedirectInput[] },
    });
    return ok({ value: toAdminRedirectImportResponse(result) });
  },
}, { successStatus: 207 });
