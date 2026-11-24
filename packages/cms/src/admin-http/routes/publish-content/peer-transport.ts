import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { authorizePublishContent, routeParam, type PublishRoutePrincipal } from "./transport-shared.js";

/**
 * @file Task 10 of the publish-content (Publish Content) feature — the PULL half of the operator-facing
 * peer transport: `POST /api/admin/v1/workspaces/:workspaceId/publish-content/peers/:peerId/pull`
 * fetches the peer's export and stages it HERE, answering a local `bundleId` that this instance's own
 * `/import/plan|confirm|execute` then drives. One importer, two directions.
 *
 * The route takes a `peerId`, never a raw URL and never a credential: the host resolves both from the
 * peer row for the lifetime of one request (`pullAndStage`). On a PULL the safety properties live
 * HERE, in the existing `/import/*` ceremony — which is exactly why this route stops at staging
 * rather than planning: a second entry point into the planner would be a second place the gate could
 * be forgotten. The host injects the pull-and-stage work and its typed-error mapping
 * (`peerActionRefusal`); this spec owns the authorization, the refusal mapping and the 201.
 */

const PEER_ENTITY_TYPE = "publish-content-peer";

/** The status-and-body pair the host maps one of its typed peer-action errors to. */
export interface PeerActionRouteRefusal { status: number; body: Record<string, unknown> }

/** The host's typed-error mapping; `undefined` leaves the error to the mount's redacted 500. */
export type PeerActionRefusalFn = (required: { error: unknown }) => PeerActionRouteRefusal | undefined;

/** The pull spec's deps. */
export interface PeerPullRouteDeps {
  workspaceId: string;
  peerActionRefusal: PeerActionRefusalFn;
  /** Opens the peer's credential, fetches its export and stages it as a local bundle. */
  pullAndStage(required: { peerId: string; principalId: string }): Promise<unknown>;
}

/** The principal, or a fail-closed wiring error. @complexity O(1). */
function principalOf({ context }: { context: PublishRoutePrincipal | undefined }, _optional: Record<string, never> = {}): PublishRoutePrincipal {
  if (!context) throw new Error("publish-content admin route has no authenticated principal");
  return context;
}

/** Runs `work`, turning a host-mapped typed error into its refusal; anything else is rethrown. @complexity O(1). */
async function mapPeerActionErrors<T>({ deps, work }: { deps: Pick<PeerPullRouteDeps, "peerActionRefusal">; work: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RouteRefusalError) throw error;
    const refusal = deps.peerActionRefusal({ error });
    if (refusal) throw new RouteRefusalError(refusal);
    throw error;
  }
}

/** `POST .../peers/:peerId/pull` — stages the peer's export here (201). */
export const peerPullRoute = defineJsonRoute<{ peerId: string }, unknown, PeerPullRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/publish-content/peers/:peerId/pull",
  parse: (raw) => ok({ value: { peerId: routeParam({ params: raw.params, name: "peerId" }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = principalOf({ context });
    await authorizePublishContent({ authorize, permission: "publish_content.apply", entityType: PEER_ENTITY_TYPE });
    const staged = await mapPeerActionErrors({ deps, work: () => deps.pullAndStage({ peerId: input.peerId, principalId: principal.id }) });
    return ok({ value: staged });
  },
}, { successStatus: 201 });
