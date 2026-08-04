import type { ContentTypeRecord } from "./types.js";

/**
 * @file Admin-UI backend-gap closure (design-spec.md §1.9) — the `content_types` registry's
 * missing read side. `write-service.ts`/`lifecycle.ts` were fully built and tested with no way to
 * list what had been written; this is that read.
 *
 * Purpose:
 * `listContentTypes` mirrors `features/database/timeline.ts`'s `getTimeline` shape exactly: a thin
 * pass-through over an injected read port, no authorization/business logic of its own (the caller
 * route checks `admin.collections.read` before calling this, same division of labor
 * `routes/admin/database/timeline.ts` already established).
 *
 * How it relates to the project:
 * `ContentTypeListPort` is deliberately a NEW, narrower port — not an addition to
 * `write-service.ts`'s `ContentTypeRepoPort` — so a caller who only needs read access
 * (`routes/admin/content-types/list.ts`) can be typed against just this port, matching this
 * codebase's port-segregation convention (`LedgerReadPort` vs `BootLedgerPort` on the same
 * underlying table, `db/sqlite/database-journal-repo.ts`). The concrete adapter
 * (`repo.memory.ts`'s `InMemoryContentTypeRepo`) implements both this and `ContentTypeRepoPort`.
 *
 * Architectural role:
 * `features/content-types` domain logic. Depends only on this package's own `types.ts`.
 */

export interface ContentTypeListPort {
  /** Every content type registered for `workspaceId`, in no particular guaranteed order (the
   * route layer is free to sort for display; the original design does not specify a canonical list order). */
  listByWorkspace(params: { workspaceId: string }): Promise<ContentTypeRecord[]>;
}

/**
 * Lists every content type registered in `workspaceId`.
 *
 * @complexity O(1) plus one `ContentTypeListPort.listByWorkspace()` call (the port owns the actual
 * scan cost).
 * @overallScore 100
 */
export async function listContentTypes(
  required: { repo: ContentTypeListPort; workspaceId: string },
  _optional: Record<string, never> = {}
): Promise<{ items: ContentTypeRecord[] }> {
  const { repo, workspaceId } = required;
  const items = await repo.listByWorkspace({ workspaceId });
  return { items };
}
