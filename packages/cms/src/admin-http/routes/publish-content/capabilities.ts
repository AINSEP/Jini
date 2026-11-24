import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { PublishRoutePrincipal } from "./transport-shared.js";

/**
 * @file S-F1 of `ADS-memory/.local-artifacts/publish-files-plan-2026-09-24.md` §5/§6.
 *
 * `GET /api/admin/v1/workspaces/:workspaceId/publish-content/capabilities` — what THIS instance can
 * accept, asked BEFORE a peer stages a single entity. Without it, `bundle-create.ts` refuses the
 * WHOLE bundle the moment it carries any entity type outside the caller's grant (§5), which turns
 * every new type this codebase ever adds into a hard publish failure against an older destination
 * until that destination is redeployed. `peer-transport.ts`'s `pushBundleToPeer` calls this route
 * first, drops the types it names as unsupported, and reports them back as `notSupportedByLive`
 * instead — nothing is refused, and no blob is wasted uploading an entity that will not be sent.
 *
 * `entityTypes` is the intersection of two independent facts, both already checked separately
 * elsewhere in this directory and joined here into one answer:
 * - Every type THIS instance has a registered handler for (`buildPublishContentCatalog` — the same
 *   allowlist `export.ts`/`bundle-create.ts` already enforce).
 * - Every type the CALLING principal's publishing grant permits, when it authenticated through one
 *   (`getPublishTrustContext`). An explicitly-configured peer API key carries no such grant — the
 *   same "no grant present, so the allowlist check does not run" reading `bundle-create.ts` already
 *   gives that credential kind — so a caller of that kind sees every registered type unfiltered.
 *
 * A peer that predates this route answers the GET with an ordinary 404 from Express's own router;
 * nothing here has to special-case that absence. `peer-transport.ts`'s own probe reads a 404 as
 * "legacy `{post,page,media}`", the fixed set every pre-S-F1 destination accepted.
 *
 * The host injects its handler registry, its grant reader and its manual-send (backstop) rules.
 */

/** The publishing grant fields this route reads; the host's grant passes through whole. */
export interface CapabilitiesGrant { readonly entityTypes: readonly string[] }

/** One registered handler, as the catalog answers it. */
export interface CapabilitiesHandler { readonly entityType: string; readonly schemaVersion: number }

/** The capabilities answer. */
export interface CapabilitiesResponse {
  entityTypes: string[];
  schemaVersions: Record<string, number>;
  features: string[];
}

/** The deps this route reads. Functions are methods so a host may bind ones typed against its full grant. */
export interface CapabilitiesRouteDeps {
  workspaceId: string;
  /** Every registered handler, read per request (contributors register at boot and in tests). */
  handlers(): readonly CapabilitiesHandler[];
  /** This request's publishing grant, or `null` (no publishing credential — an explicitly configured peer key). */
  publishTrust(required: { context: PublishRoutePrincipal | undefined }): CapabilitiesGrant | null;
  isBackstopEntityType(required: { entityType: string }): boolean;
  backstopGrantAllows(required: { grant: CapabilitiesGrant | null; entityType: string }): boolean;
}

/** The registered types this caller may send: raw (backstop) types by the backstop rule, the rest by the grant. @complexity O(n · t). */
function grantedTypes(
  { deps, handlers, trust }: { deps: CapabilitiesRouteDeps; handlers: readonly CapabilitiesHandler[]; trust: CapabilitiesGrant | null },
  _optional: Record<string, never> = {},
): string[] {
  // `null` (no publishing grant on this request — an explicitly-configured peer key) means
  // "every registered type", matching `bundle-create.ts`'s own reading of the same absence.
  const granted = trust?.entityTypes ?? null;
  return handlers
    .map((handler) => handler.entityType)
    .filter((entityType) => deps.isBackstopEntityType({ entityType })
      ? deps.backstopGrantAllows({ grant: trust, entityType })
      : granted === null || granted.includes(entityType));
}

/** `GET .../publish-content/capabilities` — `publish_content.apply` (guarded, no entity type), then the answer. */
export const capabilitiesRoute = defineJsonRoute<Record<string, never>, CapabilitiesResponse, CapabilitiesRouteDeps, PublishRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/publish-content/capabilities",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context, authorize }) => {
    if (!authorize) throw new Error("publish-content admin route has no authorizer");
    await authorize({ permission: "publish_content.apply" });
    const handlers = deps.handlers();
    const entityTypes = grantedTypes({ deps, handlers, trust: deps.publishTrust({ context }) });
    const schemaVersions: Record<string, number> = {};
    for (const handler of handlers) {
      if (entityTypes.includes(handler.entityType)) schemaVersions[handler.entityType] = handler.schemaVersion;
    }
    // publish-overwrite-live-plan §4/S6 — unconditional, unlike `entityTypes`: it names a CODE
    // capability of this instance's import ceremony (whether `forcedEntityKeys`/`retires` are
    // understood at all), not a per-caller content-type grant, so no credential or handler
    // narrows it. `peer-transport.ts`'s probe (S7) reads its absence as `liveCanOverwrite: false`
    // — the same "older peer answers without a field it doesn't know" reading `entityTypes` itself
    // already relies on for a pre-S-F1 destination's plain 404.
    return ok({ value: { entityTypes, schemaVersions, features: ["overwrite-live"] } });
  },
});
