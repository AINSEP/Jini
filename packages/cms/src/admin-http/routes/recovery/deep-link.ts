import { defineJsonRoute, ok, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import {
  resolveDeepLinkContext,
  type DatabaseContextEnvelope,
  type DeepLinkRestorePointLookupPort,
  type RecoveryContextResponse,
} from "@jini-ai/db/recovery/deep-link";

/**
 * @file design-spec.md §4.5/§4.8 — `POST /api/admin/v1/recovery/deep-link` (re-resolves a
 * `DatabaseContextEnvelope` server-side on arrival, INV-04, ADR-041 §7 / ADR-045 §5). Gated by
 * `backup.read`.
 */

/** The only deps field this route reads; the host adds its own workspace/authorize port fields. */
export interface RecoveryDeepLinkRouteDeps {
  deepLinkRestorePointLookup: DeepLinkRestorePointLookupPort;
}

/** The principal fields this route reads: the id it re-resolves the envelope for. */
export interface RecoveryDeepLinkPrincipal { id: string }

/** The raw JSON body; validated in `handle`, after authorization, as the hand-written route did. */
export type RecoveryDeepLinkInput = RouteInputContext["body"];

/** Framework-neutral spec; the host mounts it with direct (non-publish-credential) authorization. */
export const recoveryDeepLinkRoute = defineJsonRoute<RecoveryDeepLinkInput, RecoveryContextResponse, RecoveryDeepLinkRouteDeps, RecoveryDeepLinkPrincipal>({
  method: "post",
  path: "/api/admin/v1/recovery/deep-link",
  // Total: an unauthorized caller must see 403 before any 400 about its body.
  parse: (raw) => ok({ value: raw.body }),
  handle: async ({ input, deps, context, authorize }) => {
    if (!context) throw new Error("recovery deep-link route has no authenticated principal");
    if (!authorize) throw new Error("recovery deep-link route authorizer is required");
    await authorize({ permission: "backup.read", entityType: "restore-point" });

    const body = (input ?? {}) as { envelope?: unknown };
    const envelope = body.envelope as DatabaseContextEnvelope | undefined;
    if (!envelope || typeof envelope !== "object") {
      rejectRoute({ status: 400, error: "'envelope' (object) is required", code: "VALIDATION_ERROR" });
    }

    const result = await resolveDeepLinkContext({
      deps: { lookup: deps.deepLinkRestorePointLookup },
      input: { principalId: context.id, principalKind: "user", envelope },
    });
    return ok({ value: result });
  },
});
