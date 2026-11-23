import { ToolInputError } from "@jini-ai/core";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { parseExpectedVersion, RecordVersionConflictError, versionConflictBody } from "@jini-ai/core/optimistic-concurrency";

import {
  getEntryMeta,
  setEntrySeoOverrides,
  SeoConcurrentWriteError,
  SeoEntryNotFoundError,
  SeoFieldValidationError,
  SeoInvalidCanonicalUrlError,
  type createSitemapService,
  type GetEntryMetaDeps,
  type SeoExtFieldsPatch,
  type SeoMeta,
  type SetEntrySeoOverridesDeps,
} from "../../../seo/index.js";
import { withContentImageSource, withCoverReadDeps } from "../../../seo/cover-image.js";
import { entityNotLiveResponse } from "../../http/entity-not-live.js";
import { authorizeSeoManage, seoCallerId, type SeoRouteBaseDeps, type SeoRoutePrincipal } from "./deps.js";

/** The deps this route reads. `authorize` is the host's RBAC check the write chokepoint runs itself. */
export interface SeoPutEntryRouteDeps extends SeoRouteBaseDeps {
  authorize: SetEntrySeoOverridesDeps["authorize"];
  clock: SetEntrySeoOverridesDeps["clock"];
  seoDeps: GetEntryMetaDeps & Pick<SetEntrySeoOverridesDeps, "postRepo" | "media">;
  sitemapService: Pick<ReturnType<typeof createSitemapService>, "invalidateSitemapCache">;
}

/** `:entryId` plus the untouched request body (`expectedVersion` and the patch are read after authorization). */
export interface SeoPutEntryInput { entryId: string; body: unknown }

/** One refusal: the status and the flat `{ error, code, details? }` body the host writes unchanged. */
export type SeoPutEntryRefusal = { status: number; body: { error: string; code: string; details?: unknown } };

/** The SEO write's own domain errors, in the order the hand-written route checked them. */
const SEO_WRITE_ERRORS: ReadonlyArray<{ type: new (...args: never[]) => Error; status: number; code: string }> = [
  { type: SeoFieldValidationError, status: 400, code: "SEO_FIELD_VALIDATION_ERROR" },
  { type: SeoInvalidCanonicalUrlError, status: 400, code: "SEO_INVALID_CANONICAL_URL" },
  { type: SeoEntryNotFoundError, status: 404, code: "SEO_ENTRY_NOT_FOUND" },
  // 409, not the generic 500 below: the request was well-formed and authorized, it simply lost the
  // row to another writer three times running. Resending it is the correct next move, which is the
  // one thing a 500 would not tell the caller (2026-09-07, fable bugs audit SEO-01).
  { type: SeoConcurrentWriteError, status: 409, code: "SEO_CONCURRENT_WRITE" },
];

/** Maps `setEntrySeoOverrides`/`getEntryMeta`'s known thrown error types to this route's documented
 *  4xx response shapes; any other error (including a real bug) is `undefined`, a generic 500 from the host.
 *  @complexity O(1) over a fixed table.
 */
export function seoPutEntryRefusal({ err }: { err: unknown }, _optional: Record<string, never> = {}): SeoPutEntryRefusal | undefined {
  // Why first: Jini's EntityNotLiveError extends ToolInputError, so the generic 400 below would swallow a trashed entry's 409.
  const live = entityNotLiveResponse({ err });
  if (live) return live;
  if (err instanceof ToolInputError) return { status: 400, body: { error: err.message, code: "VALIDATION_ERROR" } };
  if (err instanceof RecordVersionConflictError) return { status: 409, body: versionConflictBody({ error: err }) };
  const known = SEO_WRITE_ERRORS.find(({ type }) => err instanceof type);
  return known && { status: known.status, body: { error: (err as Error).message, code: known.code } };
}

/**
 * PUT (partial) SEO overrides for an entry (SPEC-008 api.spec.md `SEO_PUT_ENTRY_META`, tasks.md T047).
 * `setEntrySeoOverrides` is its own chokepoint (does its own `authorize()` call) — this route still
 * does the route-layer authorize-then-403 dance first, matching every sibling admin route's shape,
 * so a caller lacking the permission never reaches the chokepoint at all (fail-closed, INV-07-style).
 */
export const seoPutEntryRoute = defineJsonRoute<SeoPutEntryInput, { data: SeoMeta }, SeoPutEntryRouteDeps, SeoRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId",
  parse: (raw) => ok({ value: { entryId: String(raw.params.entryId ?? ""), body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    await deps.seoReady;
    const { entryId } = input;
    const callerPrincipalId = seoCallerId({ context });
    await authorizeSeoManage({ authorize, entityType: "seo-entry" }, { entityId: entryId });
    try {
      return ok({ value: { data: await writeEntryOverrides({ deps, entryId, body: input.body, callerPrincipalId }) } });
    } catch (err) {
      const refusal = seoPutEntryRefusal({ err });
      // A domain refusal keeps its exact body (a version conflict carries its `details`).
      throw refusal ? new RouteRefusalError(refusal) : err;
    }
  },
});

/** Validate the basis, write through the chokepoint, then answer the entry's fresh meta.
 *  @complexity The chokepoint's merge retries plus one meta read.
 */
async function writeEntryOverrides(
  { deps, entryId, body, callerPrincipalId }: { deps: SeoPutEntryRouteDeps; entryId: string; body: unknown; callerPrincipalId: string },
  _optional: Record<string, never> = {},
): Promise<SeoMeta> {
  const { expectedVersion: rawExpectedVersion, ...patch } = (body ?? {}) as Record<string, unknown>;
  const expectedVersion = parseExpectedVersion({ value: rawExpectedVersion });

  await setEntrySeoOverrides({
    deps: {
      postRepo: deps.seoDeps.postRepo,
      authorize: deps.authorize,
      invalidateSitemapCache: deps.sitemapService.invalidateSitemapCache,
      clock: deps.clock,
      media: deps.seoDeps.media,
    },
    input: { workspaceId: deps.workspaceId, entryId, patch: patch as SeoExtFieldsPatch, callerPrincipalId },
  }, expectedVersion === undefined ? {} : { expectedVersion });

  const read = await withCoverReadDeps({ deps: deps.seoDeps, workspaceId: deps.workspaceId, entryId });
  const meta = await getEntryMeta({ deps: read.deps, input: { workspaceId: deps.workspaceId, entryId } }, {});
  return withContentImageSource({ meta, rawPost: read.rawPost });
}
