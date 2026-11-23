import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  CONTENT_TYPE_LIFECYCLE_OPS, contentTypeWriteErrorStatus, parseContentTypeLifecycleOp,
  type ContentTypeLifecycleOp, type IndexProvisionerPort, type TeardownIndexProvisionerPort,
} from "../../../content-types/index.js";
import { authorizeCollections, collectionsBody, collectionsPrincipal, rejectValidation, rejectWriteFailure, type CollectionsOutwardErrorDeps, type CollectionsRouteBody, type CollectionsRoutePrincipal, type OkValue, type OutboxDrainDeps } from "./collections-route.js";
import { contentTypeWriteDeps, type ContentTypeWriteRouteDeps } from "./shared.js";

/** The deps this route reads. */
export interface ContentTypeLifecycleRouteDeps extends ContentTypeWriteRouteDeps, OutboxDrainDeps, CollectionsOutwardErrorDeps {
  /** Tombstone tears the content type's queryable-field indexes down. */
  contentTypeIndexProvisioner: IndexProvisionerPort & TeardownIndexProvisionerPort;
}

/** The content type's key plus the untyped POST body. */
export interface ContentTypeLifecycleInput extends CollectionsRouteBody { key: string }

/** What a successful transition answers. */
export type ContentTypeLifecycleOutput = OkValue<Awaited<ReturnType<(typeof CONTENT_TYPE_LIFECYCLE_OPS)[ContentTypeLifecycleOp]>>>;

/**
 * design-spec.md §1.3/§1.9 — `POST /api/admin/v1/content-types/:key/lifecycle` (Deprecate /
 * Reactivate / Tombstone, ADR-043 §4/§6). Gated by `admin.collections.manage`.
 *
 * ADR-042 convention: the request body's `op` field is untrusted input routing to one of three
 * write-service functions — narrowed via `parseContentTypeLifecycleOp` to the closed
 * `ContentTypeLifecycleOp` union BEFORE any dispatch-table lookup, never a raw
 * `Record<string, Handler>` keyed by the unparsed request value (mirrors the settings
 * register-definitions route's identical `NON_REGISTER_DEFINITION_OPS` shape).
 */
export const contentTypeLifecycleRoute = defineJsonRoute<ContentTypeLifecycleInput, ContentTypeLifecycleOutput, ContentTypeLifecycleRouteDeps, CollectionsRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/content-types/:key/lifecycle",
  parse: (raw) => ok({ value: { key: String(raw.params.key), body: collectionsBody({ raw }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = collectionsPrincipal({ context });
    await authorizeCollections({ authorize, permission: "admin.collections.manage", entityType: "content-type" });

    const body = input.body;
    const op = parseContentTypeLifecycleOp({ op: body.op });
    if (!op) rejectValidation({ error: "'op' must be one of 'deprecate', 'reactivate', 'tombstone'" });
    if (typeof body.expectedVersion !== "number") rejectValidation({ error: "'expectedVersion' (number) is required" });

    const handler = CONTENT_TYPE_LIFECYCLE_OPS[op];
    const result = await handler({
      deps: { ...contentTypeWriteDeps({ deps }), indexProvisioner: deps.contentTypeIndexProvisioner },
      input: {
        workspaceId: deps.workspaceId,
        actorId: principal.id,
        principalKind: principal.kind,
        key: input.key,
        expectedVersion: body.expectedVersion,
      },
    });
    if (!result.ok) rejectWriteFailure({ error: result.error, statusOf: contentTypeWriteErrorStatus, outwardErrorMessage: deps.outwardErrorMessage });

    // 2026-09-03 outbox-drain audit fix — drains the outbox so a successful `deprecate`/
    // `tombstone` transition's `content_type.deprecated`/`content_type.tombstoned` event
    // reaches `bus.subscribe`d consumers before the response rather than on the background
    // drainer's next pass (mirrors the posts update route's identical inline
    // drain). `reactivate` enqueues nothing, so this call is a
    // harmless no-op drain on that branch — `@jini-ai/cms/content-types`'s `lifecycle.ts` file
    // header explains why `reactivateContentType` never accepted an `outbox` dep at all.
    await deps.drainOutbox();
    return ok({ value: result.value });
  },
});
