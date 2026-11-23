import { defineJsonRoute, ok, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file design-spec.md §4.5/§4.8 — `POST /api/admin/v1/recovery/deep-link` (re-resolves a
 * `DatabaseContextEnvelope` server-side on arrival, INV-04, ADR-041 §7 / ADR-045 §5). Gated by
 * `backup.read`.
 */

/** The one collaborator this route calls: the database package's deep-link re-resolution, bound by
 * the host to its restore-point lookup (read per request). The host adds its workspace/authorize fields. */
export interface RecoveryDeepLinkRouteDeps {
  resolveDeepLinkContext: (input: { principalId: string; principalKind: "user"; envelope: object }) => Promise<unknown>;
}

/** The principal fields this route reads: the id it re-resolves the envelope for. */
export interface RecoveryDeepLinkPrincipal { id: string }

/** The raw JSON body; validated in `handle`, after authorization, as the hand-written route did. */
export type RecoveryDeepLinkInput = RouteInputContext["body"];

/** Framework-neutral spec; the host mounts it with direct (non-publish-credential) authorization. */
export const recoveryDeepLinkRoute = defineJsonRoute<RecoveryDeepLinkInput, unknown, RecoveryDeepLinkRouteDeps, RecoveryDeepLinkPrincipal>({
  method: "post",
  path: "/api/admin/v1/recovery/deep-link",
  // Total: an unauthorized caller must see 403 before any 400 about its body.
  parse: (raw) => ok({ value: raw.body }),
  handle: async ({ input, deps, context, authorize }) => {
    if (!context) throw new Error("recovery deep-link route has no authenticated principal");
    if (!authorize) throw new Error("recovery deep-link route authorizer is required");
    await authorize({ permission: "backup.read", entityType: "restore-point" });

    const body = (input ?? {}) as { envelope?: unknown };
    const envelope = body.envelope as object | undefined;
    if (!envelope || typeof envelope !== "object") {
      rejectRoute({ status: 400, error: "'envelope' (object) is required", code: "VALIDATION_ERROR" });
    }

    const result = await deps.resolveDeepLinkContext({ principalId: context.id, principalKind: "user", envelope });
    return ok({ value: result });
  },
});
