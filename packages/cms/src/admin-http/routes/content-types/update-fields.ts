import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  contentTypeWriteErrorStatus, parseContentTypeFieldDefs,
  type UpdateContentTypeFieldsRequired, type updateContentTypeFields,
} from "../../../content-types/index.js";
import { authorizeCollections, collectionsBody, collectionsPrincipal, rejectValidation, rejectWriteFailure, type CollectionsRouteBody, type CollectionsRoutePrincipal, type OkValue } from "./collections-route.js";
import { contentTypeWriteDeps, type ContentTypeWriteRouteDeps } from "./shared.js";

/** The deps this route reads. */
export interface ContentTypeUpdateFieldsRouteDeps extends ContentTypeWriteRouteDeps {
  /** The host's field-schema writer (the shared write service, or a host wrapper around it). */
  updateContentTypeFields: (required: UpdateContentTypeFieldsRequired) => ReturnType<typeof updateContentTypeFields>;
}

/** The content type's key plus the untyped PUT body. */
export interface ContentTypeUpdateFieldsInput extends CollectionsRouteBody { key: string }

/** What a successful update answers. */
export type ContentTypeUpdateFieldsOutput = OkValue<Awaited<ReturnType<typeof updateContentTypeFields>>>;

/**
 * design-spec.md §1.9 — `PUT /api/admin/v1/content-types/:key/fields` (full-replace of a
 * content type's field schema, REQ-26/ADR-043 §4). Gated by `admin.collections.manage`.
 */
export const contentTypeUpdateFieldsRoute = defineJsonRoute<ContentTypeUpdateFieldsInput, ContentTypeUpdateFieldsOutput, ContentTypeUpdateFieldsRouteDeps, CollectionsRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/content-types/:key/fields",
  parse: (raw) => ok({ value: { key: String(raw.params.key), body: collectionsBody({ raw }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = collectionsPrincipal({ context });
    await authorizeCollections({ authorize, permission: "admin.collections.manage", entityType: "content-type" });

    const body = input.body;
    if (typeof body.expectedVersion !== "number") rejectValidation({ error: "'expectedVersion' (number) is required" });
    // Shape-validated here rather than cast: an `Array.isArray` check alone let a non-boolean
    // `required`/`queryable` persist verbatim and let a non-object element throw a TypeError
    // inside the domain's field-name grammar guard. Shared with the agent-tool path so the two
    // boundaries cannot drift. Domain rules (grammar, kind enum, queryable cap) stay in
    // `write-service.ts`'s CIC U-002-B1 chain — see `field-defs.ts`'s header.
    const fields = parseContentTypeFieldDefs({ value: body.fields });
    if (!fields.ok) rejectWriteFailure({ error: fields.error, statusOf: contentTypeWriteErrorStatus });

    const result = await deps.updateContentTypeFields({
      deps: contentTypeWriteDeps({ deps }),
      input: {
        actorId: principal.id,
        principalKind: principal.kind,
        workspaceId: deps.workspaceId,
        key: input.key,
        fields: fields.value,
        expectedVersion: body.expectedVersion,
      },
    });
    if (!result.ok) rejectWriteFailure({ error: result.error, statusOf: contentTypeWriteErrorStatus });
    return ok({ value: result.value });
  },
});
