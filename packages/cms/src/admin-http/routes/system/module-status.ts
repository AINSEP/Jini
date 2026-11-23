import { defineJsonRoute, ok, type JsonRouteAuthorize } from '@jini-ai/core/contracts/server';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

/**
 * @file ADR-046 Phase 2 (SPEC-030 REQ-10) — admin module-status view.
 *
 * `GET /api/admin/v1/workspaces/:workspaceId/system/module-status` — an authenticated,
 * `system.read`-gated read over the full boot lifecycle result (every attempted module's
 * name/owner/criticality/lifecycle status), for operators who need more than `/readyz`'s
 * deliberately minimized public-adjacent response. Mirrors the workspace-id 404 check → authorize
 * → 403-on-denial shape used throughout the admin routes; the 404 and 403 are the host ports'.
 */

/** The boot readiness snapshot; only `ok` is read, every other field is answered unchanged. */
export interface ModuleStatusSnapshot { readonly ok: boolean }

/** The one collaborator this route reads: the host's boot lifecycle snapshot. */
export interface AdminModuleStatusRouteDeps {
  getReadinessSnapshot: () => ModuleStatusSnapshot;
}

/** The fields of the authenticated principal this route's host ports read. */
export interface ModuleStatusPrincipal { id: string }

/** The handler's own authorizer; a spec mounted without one fails closed. */
function requireAuthorize(authorize: JsonRouteAuthorize | undefined): JsonRouteAuthorize {
  if (!authorize) throw new Error('module-status route has no authorizer');
  return authorize;
}

/** `GET .../system/module-status`: the full readiness snapshot, 503 when a critical module failed.
 * @complexity O(1) plus the injected snapshot read.
 */
export const moduleStatusRoute = defineJsonRoute<Record<string, never>, ModuleStatusSnapshot, AdminModuleStatusRouteDeps, ModuleStatusPrincipal>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/system/module-status',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await requireAuthorize(authorize)({ permission: 'system.read', entityType: 'boot-module' });
    // Mirrors `/readyz`'s status-code mapping (`ops/health.ts`'s `registerReadyzRoute`): `ok:false`
    // in the snapshot means a CRITICAL module actually failed to come up, which is a real failure
    // state for the caller to notice programmatically (a monitoring probe polling this route, not
    // just an operator reading the JSON by eye) — not something a 200 should paper over. The body is
    // unchanged either way; this route's whole reason to exist over `/readyz` is the full detail, and
    // that must stay readable exactly the same regardless of status code.
    const snapshot = deps.getReadinessSnapshot();
    // A spec has one success status, so the 503 leaves as a refusal carrying the same body verbatim.
    if (!snapshot.ok) throw new RouteRefusalError({ status: 503, body: snapshot });
    return ok({ value: snapshot });
  },
});
