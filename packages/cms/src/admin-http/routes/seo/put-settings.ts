import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminSeoSettingsEnvelope } from "@jini-ai/core/contracts/site/cms-seo";

import type { SeoSettings } from "../../../seo/types.js";
import { authorizeSeo, rejectSeoError, SEO_SETTINGS_VALIDATION, seoActorId, type SeoRoutePrincipal } from "./shared.js";

/**
 * Validates and writes a partial `seo.*` settings patch, then answers the settings as stored.
 * Injected: the settings ledger, its per-key authorization and the sitemap invalidation are the
 * host's. Throws `SeoSettingsValidationError` for a refused patch.
 */
export type SeoSettingsWriteFn = (required: { workspaceId: string; patch: unknown; callerPrincipalId: string }) => Promise<SeoSettings>;

/** The deps this route reads. */
export interface SeoPutSettingsRouteDeps {
  workspaceId: string;
  seoReady: PromiseLike<unknown>;
  writeSeoSettings: SeoSettingsWriteFn;
}

const SEO_PUT_SETTINGS_ERRORS = [SEO_SETTINGS_VALIDATION] as const;

/** PUT a partial workspace-level `seo.*` settings patch (SPEC-008 `SEO_PUT_SETTINGS`). The body is validated by the writer, after authorization. */
export const seoPutSettingsRoute = defineJsonRoute<{ patch: unknown }, AdminSeoSettingsEnvelope, SeoPutSettingsRouteDeps, SeoRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/settings",
  parse: (raw) => ok({ value: { patch: raw.body ?? {} } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeSeo({ authorize, ready: deps.seoReady, entityType: "seo-settings" });
    const callerPrincipalId = seoActorId({ context });
    try {
      return ok({ value: { data: await deps.writeSeoSettings({ workspaceId: deps.workspaceId, patch: input.patch, callerPrincipalId }) } });
    } catch (err) {
      return rejectSeoError({ err, mappings: SEO_PUT_SETTINGS_ERRORS });
    }
  },
});
