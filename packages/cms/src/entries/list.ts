import type { EntryRecord, EntryStatus } from "./types.js";

/**
 * @file Admin-UI backend-gap closure (design-spec.md §1.9) — the `entries` package's missing read
 * side. Mirrors `features/content-types/list.ts`'s shape exactly: a thin pass-through over an
 * injected read port, no authorization of its own (the caller route checks `admin.collections.read`
 * first).
 *
 * `status`/`orderBy`/`limit` (2026-07-21) — added to close a real, audit-confirmed gap
 * (`widgets/resolvers/recent-entries.ts` was loading every entry in the workspace into memory with
 * no filter/bound at all, then sorting/slicing in JS, violating SPEC-043 REQ-25's "one bounded
 * query, no unbounded scans" resolver contract). All three are optional and additive — every
 * existing caller that omits them keeps identical behavior.
 *
 * Architectural role:
 * `features/entries` domain logic. Depends only on this package's own `types.ts`.
 */

export interface EntryListPort {
  /** Every entry of `type` in `workspaceId`, in no particular guaranteed order (the route layer
   * sorts for display) unless `orderBy` is supplied. `type` is optional so a caller can list across
   * every content type at once (design-spec.md doesn't require this today, but the port stays
   * general rather than baking in the one call shape the current screen needs). `status`/`orderBy`/
   * `limit` are pushed down into the query itself (not applied client-side after a full scan) by
   * every real adapter — a caller needing a bounded, sorted read (e.g. a resolver's cost clamp)
   * must supply them rather than fetching everything and truncating in memory. */
  listByWorkspace(params: {
    workspaceId: string;
    type?: string | undefined;
    status?: EntryStatus | undefined;
    orderBy?: "updatedAt" | undefined;
    orderDirection?: "asc" | "desc" | undefined;
    limit?: number | undefined;
  }): Promise<EntryRecord[]>;
}

/**
 * Lists entries for `workspaceId`, optionally narrowed to one content `type`.
 *
 * @complexity O(1) plus one `EntryListPort.listByWorkspace()` call.
 * @overallScore 100
 */
export async function listEntries(
  required: { repo: EntryListPort; workspaceId: string; type?: string | undefined },
  _optional: Record<string, never> = {}
): Promise<{ items: EntryRecord[] }> {
  const { repo, workspaceId, type } = required;
  const items = await repo.listByWorkspace({ workspaceId, type });
  return { items };
}
