import { querySuffix } from "@jini-ai/core/admin-runtime";
import type { AdminTrashPageDto, AdminTrashPurgeReportDto, AdminTrashRestoreReportDto } from "@jini-ai/core/contracts/site/cms-trash";

/** What the host injects into {@link createTrashApi}. */
export interface TrashApiDeps {
  /** The host's `authenticatedAdminRequest`: it owns the base URL, authentication, retries and error decoding, so this client only names paths, methods and bodies. */
  authenticatedAdminRequest: <T>(required: { path: string; method: string; body?: unknown }) => Promise<T>;
  /** The workspace the paths are scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}

/** The admin API calls of the trash feature, bound to the host's injected collaborators.
 *  @example const trashApi = createTrashApi({ authenticatedAdminRequest, workspaceId }); */
export function createTrashApi({ authenticatedAdminRequest, workspaceId }: TrashApiDeps, _optional: Record<string, never> = {}) {
  return {
    // -------------------------------------------------------------------------
    // Trash — the cross-domain recycle bin (design:
    // `ADS-memory/reports/2026-09-20-trash-delete-architecture.md`). Keyset paging like
    // `listCommentsQueue` above. Restore names items by `{entityType, entityId}` and purge by trash
    // ROW id — that asymmetry is the server's, and it is deliberate: the purge endpoint resolves each
    // row's kind itself rather than trusting one the client sent, so it cannot be told that a post is
    // a comment.
    // -------------------------------------------------------------------------
    listTrash: (options: { cursor?: string; limit?: number; entityTypes?: string[] } = {}) => {
      const params = new URLSearchParams();
      if (options.cursor) params.set("cursor", options.cursor);
      if (options.limit) params.set("limit", String(options.limit));
      if (options.entityTypes?.length) params.set("entityTypes", options.entityTypes.join(","));
      const qs = params.toString();
      return authenticatedAdminRequest<AdminTrashPageDto>({ method: "GET", path: `/workspaces/${workspaceId}/trash${querySuffix({ query: qs })}` });
    },
    restoreTrashItems: ({ items }: { items: { entityType: string; entityId: string }[] }) =>
      authenticatedAdminRequest<AdminTrashRestoreReportDto>({ method: "POST", path: `/workspaces/${workspaceId}/trash/restore`, body: { items } }),
    purgeTrashItems: ({ ids }: { ids: string[] }) =>
      authenticatedAdminRequest<AdminTrashPurgeReportDto>({ method: "POST", path: `/workspaces/${workspaceId}/trash/purge`, body: { ids } }),
    /** The generic single-item trash endpoint (`POST /trash/items`): the way
     *  every OTHER admin feature's delete button (forms, widgets, menus, terms, taxonomies) moves one
     *  row to the Trash, instead of each domain keeping its own bespoke delete call. */
    trash: ({ type, id }: { type: string; id: string }) =>
      authenticatedAdminRequest<{ ok: true; version: number | null }>({ method: "POST", path: `/workspaces/${workspaceId}/trash/items`, body: { type, id } }),
  };
}
