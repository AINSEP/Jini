import type { AdminContentType, AdminEntry } from "../api/collections-api.types.js";

/**
 * @file What `use-collection-entry-editor.hooks.ts` needs from the outside world, as an interface
 * rather than a direct import of the host's API client. Follows the `useX(dependencies)` / `useWiredX()` pair
 * documented in the host's wired-hooks convention doc.
 */
export interface CollectionEntryEditorPort {
  listContentTypes(): Promise<{ items: AdminContentType[] }>;
  listEntries(options: { type?: string }, optional?: Record<string, never>): Promise<{ items: AdminEntry[] }>;
  updateEntry(
    required: { target: { id: string; expectedVersion: number }; patch: { title?: string; fieldsJson?: unknown; bodyJson?: unknown } },
    optional?: Record<string, never>
  ): Promise<{ entry: AdminEntry }>;
  createEntry(
    required: { input: { type: string; slug: string; title: string }; options: { fieldsJson?: unknown; bodyJson?: unknown } },
    optional?: Record<string, never>
  ): Promise<{ entry: AdminEntry }>;
  entryLifecycle(input: {
    id: string;
    op: "publish" | "unpublish";
    expectedVersion: number;
  }, optional?: Record<string, never>): Promise<{ entry: AdminEntry }>;
}
