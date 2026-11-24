import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminSeoEntryMetaEnvelope } from "@jini-ai/core/contracts/site/cms-seo";
import { parseExpectedVersion } from "@jini-ai/core/optimistic-concurrency";

import { getEntryMeta, type GetEntryMetaDeps } from "../../../seo/seo.js";
import { setEntrySeoOverrides, type SetEntrySeoOverridesDeps } from "../../../seo/write-service.js";
import type { SeoExtFieldsPatch } from "../../../seo/types.js";
import { withContentImageSource, withCoverReadDeps } from "../../../seo/cover-image.js";
import {
  authorizeSeo, rejectSeoError, SEO_CONCURRENT_WRITE, SEO_ENTRY_NOT_FOUND, SEO_FIELD_VALIDATION, SEO_INVALID_CANONICAL, SEO_NOT_LIVE,
  SEO_TOOL_INPUT, seoActorId, seoEntryIdParam, type SeoRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: the write chokepoint's collaborators plus the cover-aware read deps. */
export interface SeoPutEntryRouteDeps extends Pick<SetEntrySeoOverridesDeps, "clock" | "invalidateSitemapCache"> {
  workspaceId: string;
  seoReady: PromiseLike<unknown>;
  /** The read deps (and, through `postRepo`/`media`, the chokepoint's write ports). */
  seoDeps: GetEntryMetaDeps & Pick<SetEntrySeoOverridesDeps, "postRepo" | "media">;
  /**
   * The chokepoint's own authorizer. It re-checks inside the write, so it is the host's RBAC
   * authorizer itself, never the route's mount-time authorize port.
   */
  entryAuthorize: SetEntrySeoOverridesDeps["authorize"];
}

/** The PUT body: an optional `expectedVersion` beside the partial override patch. */
export interface SeoPutEntryInput { entryId: string; rawExpectedVersion: unknown; patch: SeoExtFieldsPatch }

/**
 * The ladder, in the hand-written order. A version conflict answers right after the generic
 * `ToolInputError` rung (`versionConflictAfter`), before the SEO-specific 400s.
 */
const SEO_PUT_ENTRY_ERRORS = [SEO_NOT_LIVE, SEO_TOOL_INPUT, SEO_FIELD_VALIDATION, SEO_INVALID_CANONICAL, SEO_ENTRY_NOT_FOUND, SEO_CONCURRENT_WRITE] as const;

/**
 * PUT (partial) SEO overrides for an entry (SPEC-008 `SEO_PUT_ENTRY_META`). `setEntrySeoOverrides`
 * is its own chokepoint (it authorizes again); this route still authorizes first, so a caller
 * lacking the permission never reaches it (fail-closed). `expectedVersion` is read after
 * authorization, as the host did, so a malformed one is a 400 only for an authorized caller.
 */
export const seoPutEntryRoute = defineJsonRoute<SeoPutEntryInput, AdminSeoEntryMetaEnvelope, SeoPutEntryRouteDeps, SeoRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId",
  parse: (raw) => {
    const { expectedVersion: rawExpectedVersion, ...patch } = (raw.body ?? {}) as Record<string, unknown>;
    return ok({ value: { entryId: seoEntryIdParam({ params: raw.params }), rawExpectedVersion, patch: patch as SeoExtFieldsPatch } });
  },
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeSeo({ authorize, ready: deps.seoReady, entityType: "seo-entry" }, { entityId: input.entryId });
    const callerPrincipalId = seoActorId({ context });
    try {
      const expectedVersion = parseExpectedVersion({ value: input.rawExpectedVersion });
      await setEntrySeoOverrides({
        deps: { postRepo: deps.seoDeps.postRepo, authorize: deps.entryAuthorize, invalidateSitemapCache: deps.invalidateSitemapCache, clock: deps.clock, media: deps.seoDeps.media },
        input: { workspaceId: deps.workspaceId, entryId: input.entryId, patch: input.patch, callerPrincipalId },
      }, expectedVersion === undefined ? {} : { expectedVersion });
      const read = await withCoverReadDeps({ deps: deps.seoDeps, workspaceId: deps.workspaceId, entryId: input.entryId });
      const meta = await getEntryMeta({ deps: read.deps, input: { workspaceId: deps.workspaceId, entryId: input.entryId } }, {});
      return ok({ value: { data: withContentImageSource({ meta, rawPost: read.rawPost }) } });
    } catch (err) {
      return rejectSeoError({ err, mappings: SEO_PUT_ENTRY_ERRORS }, { versionConflictAfter: SEO_TOOL_INPUT });
    }
  },
});
