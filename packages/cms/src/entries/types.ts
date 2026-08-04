import type { ContentTypeFieldDef, ContentTypeStatus } from "../content-types/types.js";

/**
 * @file Shared vocabulary for the `entries` package.
 *
 * Purpose:
 * The `EntryRecord` shape (the universal columns + the namespaced `fields.ext.{owner}.*`
 * bag) and the read-only slice of a content type this package needs (`fields`/`status`/
 * `workspaceId`) — imported by type only from `features/content-types`, never a runtime value, so
 * this package never calls into content-types' write path directly.
 *
 * Architectural role:
 * `features/entries` domain vocabulary. Type-only dependency on `features/content-types/types`.
 */

export type EntryStatus = "draft" | "published" | "unpublished";

/** The validated, namespaced field-extension envelope: `{ ext: { site: {...} } }`. */
export interface EntryFieldsJson {
  ext: { site: Record<string, unknown> };
}

export interface EntryRecord {
  id: string;
  workspaceId: string;
  type: string;
  slug: string;
  status: EntryStatus;
  title: string;
  bodyJson: unknown | null;
  fieldsJson: unknown;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** The read-only slice of a `content_types` row entries need — never entries' own write authority. */
export interface OwningContentType {
  workspaceId: string;
  key: string;
  status: ContentTypeStatus;
  fields: ContentTypeFieldDef[];
}

export interface ActorIdentityInput {
  actorId: string;
  principalKind?: "user" | "agent" | "api_key";
  delegatedByWorkspaceId?: string | null;
  delegatedById?: string | null;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
