import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  contentTypeWriteErrorStatus, parseContentTypeFieldDefs,
  type RegisterContentTypeRequired, type registerContentType,
} from "../../../content-types/index.js";
import {
  authorizeCollections, collectionsBody, collectionsPrincipal, contentTypeWriteDeps, rejectValidation, rejectWriteFailure,
  type CollectionsRouteBody, type CollectionsRoutePrincipal, type ContentTypeWriteRouteDeps, type OkValue,
} from "./shared.js";

/** The deps this route reads. */
export interface ContentTypeRegisterRouteDeps extends ContentTypeWriteRouteDeps {
  /** The host's registrar: the shared write service, with whatever host-reserved keys it pins. */
  registerContentType: (required: RegisterContentTypeRequired) => ReturnType<typeof registerContentType>;
}

/** What a successful register answers (201). */
export type ContentTypeRegisterOutput = OkValue<Awaited<ReturnType<typeof registerContentType>>>;

/**
 * design-spec.md §1.3/§1.9 — `POST /api/admin/v1/content-types` (creates a Collection's
 * content type, ADR-043 §4). Gated by `admin.collections.manage`; the write-service's own
 * `registerContentType` re-checks the same permission internally (chokepoint discipline) — this
 * route's own pre-check exists only for a fast, structured 403 before touching the body at all,
 * mirroring the settings register-definitions route's identical pattern.
 */
export const contentTypeRegisterRoute = defineJsonRoute<CollectionsRouteBody, ContentTypeRegisterOutput, ContentTypeRegisterRouteDeps, CollectionsRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/content-types",
  parse: (raw) => ok({ value: { body: collectionsBody({ raw }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = collectionsPrincipal({ context });
    await authorizeCollections({ authorize, permission: "admin.collections.manage", entityType: "content-type" });

    const body = input.body;
    if (typeof body.key !== "string" || typeof body.label !== "string") rejectValidation({ error: "'key' (string) and 'label' (string) are required" });
    // Shape-validated here rather than cast: an `Array.isArray` check alone let a non-boolean
    // `required`/`queryable` persist verbatim and let a non-object element throw a TypeError
    // inside the domain's field-name grammar guard. Shared with the agent-tool path so the two
    // boundaries cannot drift. Domain rules (grammar, reserved key, kind enum, queryable cap)
    // stay in `write-service.ts`'s CIC U-002-B1 chain — see `field-defs.ts`'s header.
    const fields = parseContentTypeFieldDefs({ value: body.fields });
    if (!fields.ok) rejectWriteFailure({ error: fields.error, statusOf: contentTypeWriteErrorStatus });

    const result = await deps.registerContentType({
      deps: contentTypeWriteDeps({ deps }),
      input: {
        actorId: principal.id,
        principalKind: principal.kind,
        workspaceId: deps.workspaceId,
        key: body.key,
        label: body.label,
        fields: fields.value,
      },
    });
    if (!result.ok) rejectWriteFailure({ error: result.error, statusOf: contentTypeWriteErrorStatus });
    return ok({ value: result.value });
  },
}, { successStatus: 201 });
