import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";

/**
 * @file Shared guards for the `widgets` admin route specs.
 *
 * Most widgets routes get their `widgets.*` gate from the domain function they call
 * (`createWidgetInstance` et al. call `requireWidgetPermission` as their own first line — REQ-40
 * requires the SAME check whether the caller is a human route or an AI tool route), so those routes
 * only need the principal's id as the domain function's `actor`. The region read/bind routes have
 * no such domain-function wrapper and gate through the host's authorize port instead.
 */

/** The principal fields these routes read: only the id, as the domain functions' `actor`. */
export interface WidgetRoutePrincipal { id: string }

/**
 * The authenticated principal's id, passed to the domain function as `actor.principalId`.
 *
 * @complexity O(1).
 */
export function widgetActorId({ context }: { context: WidgetRoutePrincipal | undefined }, _options: Record<string, never> = {}): string {
  if (!context) throw new Error("widgets admin route has no authenticated principal");
  return context.id;
}

/**
 * REQ-40/41: the explicit `widgets.*` gate for routes that read straight off the binding/entry
 * repositories rather than through a permission-checking service function. The host injects
 * `authorize`; a mount without one is a wiring bug, not a caller error.
 *
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeWidgets({ authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string }, _options: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("widgets admin route has no authorizer");
  await authorize({ permission, entityType: "widget" });
}
