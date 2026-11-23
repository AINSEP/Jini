import { defineJsonRoute, ok, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { computeDisclosure, type DisclosureResult, type DisclosureWatermarkSourcePort } from "@jini-ai/db/recovery/disclosure";

/** ADR-045 §3 Step 2 / `disclosure.ts`'s own file header — the versioned, single, auditable list
 * of write-path categories this disclosure may ever claim to cover. A category is added here only
 * once its own write path is confirmed watermark-stamped (not yet true for `entries`, taxonomy
 * writes, or sessions — see `disclosure.ts`'s header for the full disclosed scope). */
const COVERED_CATEGORIES = ["posts_pages", "plugin_table"] as const;

/**
 * @file design-spec.md §4.3/§4.8 — `POST /api/admin/v1/recovery/disclosure` (the discarded-write-
 * window disclosure, Step 2 of the restore ceremony, REQ-09-REQ-11/INV-05). Gated by `backup.read`
 * (a read-only computation, never itself a restore action).
 *
 * Backed by `AlwaysUnavailableWatermarkSource` (`@jini-ai/db/recovery/lookup-adapters`) — see that
 * class's own doc comment for why reporting the baseline as unavailable is the correct, safe
 * behavior right now rather than a corner cut: this route always renders `"unknown"` for every
 * covered category, never a fabricated `0`.
 */

/** The only deps field this route reads; the host adds its own workspace/authorize port fields. */
export interface RecoveryDisclosureRouteDeps {
  disclosureWatermarkSource: DisclosureWatermarkSourcePort;
}

/** The principal fields this route reads: only its presence (authorization keys on it). */
export interface RecoveryDisclosurePrincipal { id: string }

/** The raw JSON body; validated in `handle`, after authorization, as the hand-written route did. */
export type RecoveryDisclosureInput = RouteInputContext["body"];

/** Framework-neutral spec; the host mounts it with direct (non-publish-credential) authorization. */
export const recoveryDisclosureRoute = defineJsonRoute<RecoveryDisclosureInput, DisclosureResult, RecoveryDisclosureRouteDeps, RecoveryDisclosurePrincipal>({
  method: "post",
  path: "/api/admin/v1/recovery/disclosure",
  // Total: an unauthorized caller must see 403 before any 400 about its body.
  parse: (raw) => ok({ value: raw.body }),
  handle: async ({ input, deps, context, authorize }) => {
    if (!context) throw new Error("recovery disclosure route has no authenticated principal");
    if (!authorize) throw new Error("recovery disclosure route authorizer is required");
    await authorize({ permission: "backup.read", entityType: "restore-point" });

    const body = (input ?? {}) as { restorePointId?: unknown };
    if (typeof body.restorePointId !== "string") {
      rejectRoute({ status: 400, error: "'restorePointId' (string) is required", code: "VALIDATION_ERROR" });
    }

    const disclosure = await computeDisclosure({
      deps: { watermarkSource: deps.disclosureWatermarkSource, coveredCategories: COVERED_CATEGORIES },
      input: { restorePointId: body.restorePointId },
    });
    return ok({ value: disclosure });
  },
});
