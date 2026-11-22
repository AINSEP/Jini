import type { EntryRecord } from "./types.js";

/** An entry plus its Trash marker, as the Trash's record-store adapter sees it. */
export type TrashableEntryRecord = EntryRecord & { deletedAt: string | null };

/** Publish-content's entry read (`publish-content.ts`): the row plus its Trash marker, trashed rows
 *  included, so a precheck refuses a trashed destination instead of planning a create that `save`
 *  would then silently skip. */
export interface EntryPublishReadPort {
  findAnyById(params: { workspaceId: string; id: string }): Promise<TrashableEntryRecord | null>;
  /** The `(type, slug)` holder, trashed or not: the slug index spans the Trash, so a trashed holder
   *  still blocks a create and precheck must see it. */
  findAnyBySlug(params: { workspaceId: string; type: string; slug: string }): Promise<TrashableEntryRecord | null>;
}
