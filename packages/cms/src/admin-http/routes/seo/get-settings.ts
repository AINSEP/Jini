import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { SeoSettings } from "../../../seo/types.js";
import { authorizeSeo, type SeoRoutePrincipal } from "./shared.js";

/** Reads the workspace's `seo.*` settings. Injected: the settings ledger mapping is the host's. */
export type SeoSettingsReadFn = (required: { workspaceId: string }) => Promise<SeoSettings>;

/** The deps this route reads. */
export interface SeoGetSettingsRouteDeps {
  workspaceId: string;
  seoReady: PromiseLike<unknown>;
  readSeoSettings: SeoSettingsReadFn;
}

/** GET the workspace-level `seo.*` settings (SPEC-008 `SEO_GET_SETTINGS`); gated on `seo-settings`. */
export const seoGetSettingsRoute = defineJsonRoute<Record<string, never>, { data: SeoSettings }, SeoGetSettingsRouteDeps, SeoRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/settings",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeSeo({ authorize, ready: deps.seoReady, entityType: "seo-settings" });
    return ok({ value: { data: await deps.readSeoSettings({ workspaceId: deps.workspaceId }) } });
  },
});
