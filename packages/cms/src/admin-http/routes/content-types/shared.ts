import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { Clock } from "@jini-ai/core/primitives";

import type { KernelOutboxAdapterDeps } from "../../../core/kernel-outbox.js";
import { adaptLegacyAuthorize } from "../../../core/tools/index.js";
import { toContentTypeOutbox, type ActorPrincipalKind, type ContentTypeRepoPort, type IndexProvisionerPort } from "../../../content-types/index.js";

/**
 * @file Helpers shared by the Collections admin route specs (content-types + entries, ADR-043).
 * Server-neutral: refusals are thrown as `rejectRoute` bodies; anything unmapped is rethrown to the
 * host's error port, which answers it as the redacted 500.
 */

/** The session principal these routes read: its id, and for content-type writes its kind. */
export interface CollectionsRoutePrincipal { id: string; kind: ActorPrincipalKind }

/** The untyped request body, read once by `parse`; each route validates it after authorizing. */
export interface CollectionsRouteBody { body: Record<string, unknown> }

/** The success value of a write service's `Result`. */
export type OkValue<T> = T extends { ok: true; value: infer V } ? V : never;

/** The deps every content-type write route reads (register, update-fields, lifecycle). */
export interface ContentTypeWriteRouteDeps {
  workspaceId: string;
  /** The host's RBAC evaluator; the write services re-check the same permission through it. */
  authorize: AuthorizeFn;
  clock: Clock;
  idGen: KernelOutboxAdapterDeps["idGen"];
  outbox: KernelOutboxAdapterDeps["outbox"];
  contentTypeRepo: ContentTypeRepoPort;
  contentTypeIndexProvisioner: IndexProvisionerPort;
}

/** Drains the host outbox so a successful write's event reaches `bus.subscribe`d consumers before
 *  the response rather than on the background drainer's next pass. */
export interface OutboxDrainDeps { drainOutbox: () => Promise<unknown> }

/** The request body as an object (`{}` when absent), exactly as the hand-written routes read it.
 * @complexity O(1). */
export function collectionsBody({ raw }: { raw: { body: unknown } }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return (raw.body ?? {}) as Record<string, unknown>;
}

/** The authenticated principal; the host's authenticate port always supplies one.
 * @complexity O(1). */
export function collectionsPrincipal({ context }: { context: CollectionsRoutePrincipal | undefined }, _optional: Record<string, never> = {}): CollectionsRoutePrincipal {
  if (!context) throw new Error("collections admin route has no authenticated principal");
  return context;
}

/** The route's own pre-check: a fast, structured 403 before the body is read at all. These routes
 *  never named an entity id, so the scope stays id-free.
 * @complexity O(1) beyond the injected authorizer. */
export async function authorizeCollections(
  { authorize, permission, entityType }: { authorize: JsonRouteAuthorize | undefined; permission: string; entityType: "content-type" | "entry" },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("collections admin route has no authorizer");
  await authorize({ permission, entityType });
}

/** A body-shape refusal: `400 { error, code: "VALIDATION_ERROR" }`.
 * @complexity O(1). */
export function rejectValidation({ error }: { error: string }, _optional: Record<string, never> = {}): never {
  return rejectRoute({ status: 400, error, code: "VALIDATION_ERROR" });
}

/** A write failure the domain's status table maps answers `{ error: <message>, code }` at that
 *  status; an unmapped one (500) is rethrown so the host answers it as the redacted failure.
 * @complexity O(1) plus the status table's `instanceof` chain. */
export function rejectWriteFailure(
  { error, statusOf }: { error: Error; statusOf: (required: { error: Error }) => { status: number; code: string } },
  _optional: Record<string, never> = {},
): never {
  const { status, code } = statusOf({ error });
  if (status === 500) throw error;
  return rejectRoute({ status, error: error.message, code });
}

/** The content-type write-service deps built from the route deps.
 * @complexity O(1). */
export function contentTypeWriteDeps({ deps }: { deps: ContentTypeWriteRouteDeps }, _optional: Record<string, never> = {}) {
  return {
    repo: deps.contentTypeRepo,
    clock: deps.clock,
    ids: deps.idGen,
    // Jini passes entity scope separately; merge it into the host evaluator's request.
    authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
    indexProvisioner: deps.contentTypeIndexProvisioner,
    outbox: toContentTypeOutbox(deps),
  };
}
