import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { listContentTypes, type ContentTypeListPort, type ContentTypeRecord } from "../../../content-types/index.js";
import { authorizeCollections, type CollectionsRoutePrincipal } from "./collections-route.js";

/** The deps this route reads. */
export interface ContentTypeListRouteDeps {
  workspaceId: string;
  contentTypeRepo: ContentTypeListPort;
}

/**
 * design-spec.md §1.9 — `GET /api/admin/v1/content-types` (Collections' content-type
 * registry list, ADR-022/ADR-043). Gated by `admin.collections.read` (ADR-043 §permissions).
 *
 * Follows `../database/timeline.ts`'s exact shape: authenticated principal ->
 * authorize -> 403 on denial -> call the domain read function -> the list.
 */
export const contentTypeListRoute = defineJsonRoute<Record<string, never>, { items: ContentTypeRecord[] }, ContentTypeListRouteDeps, CollectionsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/content-types",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeCollections({ authorize, permission: "admin.collections.read", entityType: "content-type" });
    return ok({ value: await listContentTypes({ repo: deps.contentTypeRepo, workspaceId: deps.workspaceId }) });
  },
});
