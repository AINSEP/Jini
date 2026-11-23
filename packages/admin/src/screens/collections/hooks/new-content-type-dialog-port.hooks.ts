import type { AdminContentType, ContentTypeFieldDef } from "../api/collections-api.types.js";

/**
 * @file What `use-new-content-type-dialog.hooks.ts` needs from the outside world, as an interface
 * rather than a direct import of the host's API client. Follows the `useX(dependencies)` / `useWiredX()` pair
 * documented in the host's wired-hooks convention doc.
 */
export interface NewContentTypeDialogPort {
  createContentType(input: {
    key: string;
    label: string;
    fields: ContentTypeFieldDef[];
  }, optional?: Record<string, never>): Promise<{ contentType: AdminContentType }>;
}
