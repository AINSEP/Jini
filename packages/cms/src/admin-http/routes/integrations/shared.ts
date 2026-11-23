import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { RecordVersionConflictError, versionConflictBody } from "@jini-ai/core/optimistic-concurrency";

import type { WebhookDeliveryRow, WebhookSubscriptionRow } from "../../http/integrations.js";

/**
 * @file Shared guards, repo views and error mapping for the `integrations` admin route specs.
 *
 * The webhook feature (its write services, error classes and repos) lives in a package this one does
 * not depend on, so the routes see it only through what the host injects: the lifecycle services as
 * function-typed deps, the repos as the small read views below, and the feature's own failures as
 * matcher functions (`instanceof` against the host's classes). Each route keeps its exact `catch`
 * ladder as a small mapping table, and the host's `onError` port writes the thrown refusal flat.
 */

/** The read half of the host's subscription repo the routes use; the host's repo port is assignable. */
export interface WebhookSubscriptionReadPort {
  findById(required: { workspaceId: string; id: string }): Promise<WebhookSubscriptionRow | null>;
  listByWorkspace(required: { workspaceId: string }): Promise<WebhookSubscriptionRow[]>;
}

/** The read half of the host's delivery repo the routes use; the host's repo port is assignable. */
export interface WebhookDeliveryReadPort {
  listBySubscription(required: { workspaceId: string; subscriptionId: string; limit: number }): Promise<WebhookDeliveryRow[]>;
}

/**
 * Tells one of the host service's anticipated failures from any other throw, so a route can map it
 * to a status without importing the host's error class.
 */
export type WebhookFailureMatcher = (required: { err: unknown }, optional?: Record<string, never>) => boolean;

/** One `catch` rung: which thrown error maps to which status and wire body. */
export interface WebhookErrorMapping {
  readonly matches: WebhookFailureMatcher;
  readonly status: number;
  readonly body: (required: { err: unknown }, optional?: Record<string, never>) => unknown;
}

/** A host-owned failure answered as `{ error: <its own message> }` — no code, as the hand-written route sent. */
export function webhookMessageMapping({ matches, status }: { matches: WebhookFailureMatcher; status: number }, _optional: Record<string, never> = {}): WebhookErrorMapping {
  return { matches, status, body: ({ err }, _o = {}) => ({ error: err instanceof Error ? err.message : String(err) }) };
}

/**
 * A lost compare-and-set: 409 with core's shared version-conflict body, `details` included, the
 * shape every optimistic-concurrency surface answers so the admin client reads one contract.
 */
export const WEBHOOK_VERSION_CONFLICT: WebhookErrorMapping = {
  matches: ({ err }, _o = {}) => err instanceof RecordVersionConflictError,
  status: 409,
  body: ({ err }, _o = {}) => versionConflictBody({ error: err as RecordVersionConflictError }),
};

/**
 * Refuses with the first matching rung's status and body; anything unmapped is rethrown unchanged
 * so the host's error port answers it as an unexpected (redacted) failure.
 * @complexity O(n) in the mapping table length, a small fixed list per route.
 */
export function rejectWebhookError({ err, mappings }: { err: unknown; mappings: readonly WebhookErrorMapping[] }, _optional: Record<string, never> = {}): never {
  const mapping = mappings.find((candidate) => candidate.matches({ err }));
  if (!mapping) throw err;
  // `rejectRoute` only carries the permission-shaped `details`; the version-conflict body needs its own, so the
  // refusal is thrown directly — the host's error port writes `body` verbatim either way.
  throw new RouteRefusalError({ status: mapping.status, body: mapping.body({ err }) });
}

/**
 * Every integrations admin route is gated by `admin.integrations.manage` (registered in
 * `packages/user-management/src/core/builtin-permissions.ts`) on the `webhook_subscription` entity
 * type — no dedicated read permission exists for the domain, so the one permission that gates
 * subscription mutations also gates the reads, as `member.manage` covers its whole domain. By-id routes
 * pass the requested `entityId` so the host decides for that subscription; list and create act on no
 * single subscription and stay id-free. A mount without an authorizer is a wiring bug, not a caller error.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeIntegrations({ authorize }: { authorize: JsonRouteAuthorize | undefined }, optional: JsonRouteAuthorizeScope = {}): Promise<void> {
  if (!authorize) throw new Error("integrations admin route has no authorizer");
  const required = { permission: "admin.integrations.manage", entityType: "webhook_subscription" };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/** The `:subscriptionId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function subscriptionIdParam(params: Record<string, string | undefined>): string {
  return String(params.subscriptionId ?? "");
}
