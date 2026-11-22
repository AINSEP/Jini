import type { AdminContentType, ContentTypeFieldDef } from "../api/collections-api.types.js";

/**
 * @file What `use-edit-fields-dialog.hooks.ts` needs from the outside world, as an interface rather
 * than a direct import of the host's API client. Follows the `useX(dependencies)` / `useWiredX()` pair documented
 * in the host's wired-hooks convention doc.
 *
 * `describeEditFieldsError` (this hook's error-message rule) is deliberately NOT part of this port
 * — it is a pure, no-I/O function, injected the way `assistant-chats-port.hooks.ts`'s own
 * `persistableMessages` is not: imported directly.
 */
export interface EditFieldsDialogPort {
  updateContentTypeFields(input: {
    key: string;
    fields: ContentTypeFieldDef[];
    expectedVersion: number;
  }, optional?: Record<string, never>): Promise<{ contentType: AdminContentType }>;
}
