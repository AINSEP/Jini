import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";

/**
 * @file `GET /api/admin/v1/workspaces/:workspaceId/commerce/status` — the authenticated,
 * workspace-scoped Commerce operational-status endpoint.
 *
 * The handler performs no payment operation and reads no credentials. Its only runtime query is the
 * narrow provider catalog the host's status reader exposes. The reader is injected: the Commerce
 * runtime is an opt-in capability this package does not depend on, and which payment runtime (if
 * any) is composed for the workspace is the host's decision.
 */

/**
 * The host's status read, already bound to whichever payment runtime it composed (or none, which it
 * reports as an unavailable runtime rather than an error). Sync and side-effect free; it answers
 * the JSON body the route sends.
 */
export type CommerceStatusReadFn = (required: { workspaceId: string }, optional?: Record<string, never>) => object;

/** The deps this route reads: the workspace it serves and the host's bound status read. */
export interface CommerceStatusRouteDeps {
  workspaceId: string;
  readCommerceStatus: CommerceStatusReadFn;
}

/** Whatever the host's session resolves to: this route never reads the principal, only authorizes it. */
type CommerceStatusContext = unknown;

/**
 * Asks the host for `admin.integrations.manage` on the `integration` entity type. The status acts on
 * no single integration, so no entity id is sent. A mount without an authorizer is a wiring bug, not
 * a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
async function authorizeCommerceStatus({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("commerce admin route has no authorizer");
  await authorize({ permission: "admin.integrations.manage", entityType: "integration" });
}

/**
 * Reads the Commerce operational status for the served workspace.
 *
 * @complexity Per request, whatever the injected read costs (O(p + c) for p providers and c declared
 * capabilities in the host's reader); no external I/O happens here.
 */
export const commerceStatusRoute = defineJsonRoute<Record<string, never>, object, CommerceStatusRouteDeps, CommerceStatusContext>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/commerce/status",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeCommerceStatus({ authorize });
    // Adapter exceptions may contain secrets; return only the fixed error response.
    // (A reader failure is therefore not caught here: it reaches the host's error port, which answers only that redacted failure.)
    return ok({ value: deps.readCommerceStatus({ workspaceId: deps.workspaceId }) });
  },
});
