import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { listEntries, type EntryListPort } from "../../../entries/index.js";
import { authorizeCollections, type CollectionsRoutePrincipal } from "../content-types/shared.js";

/** The deps this route reads. */
export interface EntryListRouteDeps {
  workspaceId: string;
  entryRepo: EntryListPort;
}

/** The optional `?type=` filter (only a string is kept). */
export interface EntryListQuery { type: string | undefined }

/**
 * design-spec.md §1.4/§1.9 — `GET /api/admin/v1/entries?type=` (a Collection's entry list,
 * ADR-022/ADR-043). Gated by `admin.collections.read`.
 */
export const entryListRoute = defineJsonRoute<EntryListQuery, Awaited<ReturnType<typeof listEntries>>, EntryListRouteDeps, CollectionsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/entries",
  parse: (raw) => ok({ value: { type: typeof raw.query.type === "string" ? raw.query.type : undefined } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeCollections({ authorize, permission: "admin.collections.read", entityType: "entry" });
    return ok({ value: await listEntries({ repo: deps.entryRepo, workspaceId: deps.workspaceId }, { type: input.type }) });
  },
});
