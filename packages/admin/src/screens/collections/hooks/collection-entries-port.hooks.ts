import type { AdminContentType, AdminEntry } from "../api/collections-api.types.js";

/**
 * @file What `use-collection-entries.hooks.ts` needs from the outside world, as an interface rather
 * than a direct import of the host's API client. Follows the `useX(dependencies)` / `useWiredX()` pair documented
 * in the host's wired-hooks convention doc.
 */
export interface CollectionEntriesPort {
  listContentTypes(): Promise<{ items: AdminContentType[] }>;
  listEntries(options: { type?: string }, optional?: Record<string, never>): Promise<{ items: AdminEntry[] }>;
}
