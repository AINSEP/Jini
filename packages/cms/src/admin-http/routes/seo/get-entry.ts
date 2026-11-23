import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { getEntryMeta, type GetEntryMetaDeps } from "../../../seo/seo.js";
import type { SeoMeta } from "../../../seo/types.js";
import { withContentImageSource, withCoverReadDeps } from "../../../seo/cover-image.js";
import { authorizeSeo, rejectSeoError, SEO_ENTRY_NOT_FOUND, seoEntryIdParam, type SeoRoutePrincipal } from "./shared.js";

/** The deps this route reads: the workspace, the SEO readiness gate and the entry-meta read deps. */
export interface SeoGetEntryRouteDeps {
  workspaceId: string;
  /** Resolves once the host has seeded the SEO setting definitions; every SEO route waits on it. */
  seoReady: PromiseLike<unknown>;
  seoDeps: GetEntryMetaDeps;
}

/** The answered envelope: the entry's effective meta (with its version) under `data`. */
export interface SeoEntryMetaEnvelope { data: SeoMeta }

const SEO_GET_ENTRY_ERRORS = [SEO_ENTRY_NOT_FOUND] as const;

/**
 * GET an entry's effective SEO meta (SPEC-008 `SEO_GET_ENTRY_META`). Gated by `admin.seo.manage` on
 * that `seo-entry`. The cover image is resolved first so the preview shows the share image the live
 * render emits; a body image stays marked as content, not as a stored override.
 */
export const seoGetEntryRoute = defineJsonRoute<{ entryId: string }, SeoEntryMetaEnvelope, SeoGetEntryRouteDeps, SeoRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId",
  parse: (raw) => ok({ value: { entryId: seoEntryIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeSeo({ authorize, ready: deps.seoReady, entityType: "seo-entry" }, { entityId: input.entryId });
    try {
      const read = await withCoverReadDeps({ deps: deps.seoDeps, workspaceId: deps.workspaceId, entryId: input.entryId });
      const meta = await getEntryMeta({ deps: read.deps, input: { workspaceId: deps.workspaceId, entryId: input.entryId } }, {});
      return ok({ value: { data: withContentImageSource({ meta, rawPost: read.rawPost }) } });
    } catch (err) {
      return rejectSeoError({ err, mappings: SEO_GET_ENTRY_ERRORS });
    }
  },
});
