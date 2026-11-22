import type { AdminContentType, ContentTypeLifecycleOp } from "../api/collections-api.types.js";

/**
 * @file What `use-collections.hooks.ts` needs from the outside world, as an interface rather than a
 * direct import of the host's API client. Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * the host's wired-hooks convention doc.
 */
export interface CollectionsPort {
  listContentTypes(): Promise<{ items: AdminContentType[] }>;
  contentTypeLifecycle(input: {
    key: string;
    op: ContentTypeLifecycleOp;
    expectedVersion: number;
  }, optional?: Record<string, never>): Promise<{ contentType: AdminContentType }>;
}
